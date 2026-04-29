const { createApp } = Vue;

const API_BASE = "http://localhost:5001/api";

createApp({
  data() {
    return {
      projects: [],
      selectedProject: null,
      newProject: {
        title: "",
        goal: "",
      },
      loading: false,
      taskLoading: false,
      agentLoading: false,
      deleteLoading: false,
      error: "",
      message: "",
    };
  },
  // Group by phase and count completed tasks
  computed: {
    timelineGroups() {
      if (!this.selectedProject || !Array.isArray(this.selectedProject.tasks)) {
        return [];
      }

      const groups = [];
      const phaseMap = new Map();

      [...this.selectedProject.tasks]
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((task) => {
          const phase = task.phase || "Timeline";

          if (!phaseMap.has(phase)) {
            const group = {
              phase,
              tasks: [],
              completed: 0,
            };

            phaseMap.set(phase, group);
            groups.push(group);
          }

          phaseMap.get(phase).tasks.push(task);

          if (task.status === "done") {
            phaseMap.get(phase).completed += 1;
          }
        });

      return groups;
    },
    // calculates timeline %
    timelineProgress() {
      if (!this.selectedProject || !Array.isArray(this.selectedProject.tasks)) {
        return 0;
      }

      const total = this.selectedProject.tasks.length;
      if (total === 0) {
        return 0;
      }

      const completed = this.selectedProject.tasks.filter(
        (task) => task.status === "done"
      ).length;

      return Math.round((completed / total) * 100);
    },
  },
  // Ensure tasks have phases and order
  methods: {
    normalizeProject(project) {
      return {
        ...project,
        tasks: Array.isArray(project.tasks)
          ? project.tasks.map((task, index) => ({
              ...task,
              phase: task.phase || "Timeline",
              order: Number.isFinite(task.order)
                ? Number(task.order)
                : index + 1,
            }))
          : [],
      };
    },

    // Get all projects from server
    async getProjects() {
      const response = await fetch(`${API_BASE}/projects`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to load projects.");
      }

      return data;
    },

    // Send new project to server
    async createProjectRequest(projectData) {
      const response = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectData),
      });

      const data = await response.json();
      return { response, data };
    },

    // Send updated project with tasks
    async patchProject(id, updates) {
      const response = await fetch(`${API_BASE}/projects/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      const data = await response.json();
      return { response, data };
    },

    // Run agent action
    async runAgentRequest(id, action) {
      const response = await fetch(`${API_BASE}/projects/${id}/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();
      return { response, data };
    },

    // Delete a project
    async deleteProjectRequest(id) {
      const response = await fetch(`${API_BASE}/projects/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      return { response, data };
    },

    // Load projects into UI
    async fetchProjects() {
      this.loading = true;
      this.error = "";
      this.message = "";

      try {
        const data = await this.getProjects();
        this.projects = data.map((project) => this.normalizeProject(project));

        if (this.selectedProject) {
          const updatedSelected = this.projects.find(
            (project) => project._id === this.selectedProject._id
          );

          this.selectedProject = updatedSelected || null;
        }
      } catch (error) {
        this.error = "Failed to load projects.";
        console.error(error);
      } finally {
        this.loading = false;
      }
    },

    async createProject() {
      this.error = "";
      this.message = "";

      if (!this.newProject.title.trim() || !this.newProject.goal.trim()) {
        this.error = "Title and goal are required.";
        return;
      }

      try {
        const { response, data } = await this.createProjectRequest(
          this.newProject
        );

        if (!response.ok) {
          this.error = data.message || "Failed to create project.";
          return;
        }

        const project = this.normalizeProject(data);
        this.projects.unshift(project);
        this.selectedProject = project;

        this.newProject = {
          title: "",
          goal: "",
        };

        this.message = "Project created.";
      } catch (error) {
        this.error = "Failed to create project.";
        console.error(error);
      }
    },

    selectProject(project) {
      this.selectedProject = this.normalizeProject(
        JSON.parse(JSON.stringify(project))
      );
    },

    async updateTaskStatus() {
      if (!this.selectedProject || this.taskLoading) return;

      this.error = "";
      this.message = "";
      this.taskLoading = true;
      const previousTasks = JSON.parse(
        JSON.stringify(this.selectedProject.tasks)
      );

      try {
        const { response, data } = await this.patchProject(
          this.selectedProject._id,
          {
            tasks: this.selectedProject.tasks,
          }
        );

        if (!response.ok) {
          this.error = data.message || "Failed to update task.";
          this.selectedProject.tasks = previousTasks;
          return;
        }

        this.selectedProject = this.normalizeProject(data);
        await this.fetchProjects();
        this.message = "Task updated.";
      } catch (error) {
        this.error = "Failed to update task.";
        this.selectedProject.tasks = previousTasks;
        console.error(error);
      } finally {
        this.taskLoading = false;
      }
    },

    async runAgent(action) {
      if (!this.selectedProject || this.agentLoading) return;

      this.error = "";
      this.message = "";
      this.agentLoading = true;

      try {
        const { response, data } = await this.runAgentRequest(
          this.selectedProject._id,
          action
        );

        if (!response.ok) {
          this.error = data.message || "Agent action failed.";
          return;
        }

        this.selectedProject = this.normalizeProject(data);
        await this.fetchProjects();
        this.message =
          action === "generate-plan"
            ? "Timeline generated."
            : "Project analysis updated.";
      } catch (error) {
        this.error = "Agent action failed.";
        console.error(error);
      } finally {
        this.agentLoading = false;
      }
    },

    async deleteProject() {
      if (!this.selectedProject || this.deleteLoading) return;

      const confirmed = window.confirm("Delete this project?");
      if (!confirmed) return;

      this.error = "";
      this.message = "";
      this.deleteLoading = true;

      try {
        const projectId = this.selectedProject._id;
        const { response, data } = await this.deleteProjectRequest(projectId);

        if (!response.ok) {
          this.error = data.message || "Failed to delete project.";
          return;
        }

        this.projects = this.projects.filter(
          (project) => project._id !== projectId
        );
        this.selectedProject = null;
        this.message = data.message || "Project deleted.";
      } catch (error) {
        this.error = "Failed to delete project.";
        console.error(error);
      } finally {
        this.deleteLoading = false;
      }
    },
  },

  mounted() {
    this.fetchProjects();
  },
}).mount("#app");
