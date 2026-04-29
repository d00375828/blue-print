// Routes for projects, creates, reads, updates, delets, and run agent actions. Backend endpoints

const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const { runAgentGraph } = require("../agent/graph");

const router = express.Router();

// Old nead to remove
function calculateHealthSummary(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return "Project timeline has not been generated yet.";
  }

  const completedTasks = tasks.filter((task) => task.status === "done").length;
  const completionPercent = Math.round((completedTasks / tasks.length) * 100);

  if (completionPercent === 100) {
    return "Project timeline is complete.";
  }

  if (completionPercent >= 75) {
    return "Project is in the final stretch with most timeline tasks complete.";
  }

  if (completionPercent >= 40) {
    return "Project is moving steadily through the timeline.";
  }

  if (completionPercent > 0) {
    return "Project has started and early timeline tasks are being completed.";
  }

  return "Project timeline is ready, but work has not started yet.";
}

// Old Need to remove
function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.map((task, index) => ({
    phase: task.phase || "Timeline",
    order: Number.isFinite(task.order) ? Number(task.order) : index + 1,
    title: task.title,
    status: task.status,
    priority: task.priority,
  }));
}

// Create a new project in Mongo

router.post("/", async (req, res) => {
  try {
    const { title, goal } = req.body;

    if (!title || !goal) {
      return res.status(400).json({ message: "Title and goal are required." });
    }

    const project = await Project.create({
      title,
      goal,
      tasks: [],
      healthSummary: "",
      nextActions: [],
    });

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: "Failed to create project." });
  }
});

// Get all projects, sort by createdAt(newest to oldest)

router.get("/", async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: "Failed to get projects." });
  }
});

// Update a project, can update just tasks or whole thing

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const updates = {
      title: req.body.title,
      goal: req.body.goal,
      tasks: req.body.tasks,
      healthSummary: req.body.healthSummary,
      nextActions: req.body.nextActions,
    };

    Object.keys(updates).forEach((key) => {
      if (updates[key] === undefined) {
        delete updates[key];
      }
    });

    if (updates.tasks) {
      updates.tasks = normalizeTasks(updates.tasks);
      updates.healthSummary = calculateHealthSummary(updates.tasks);
    }

    const project = await Project.findByIdAndUpdate(id, updates, {
      returnDocument: "after",
      runValidators: true,
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    res.json(project);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Invalid project data." });
    }

    res.status(500).json({ message: "Failed to update project." });
  }
});

// Delete a project

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const project = await Project.findByIdAndDelete(id);

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    res.json({ message: "Project deleted." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete project." });
  }
});

// Run "action" on a project (plan or analyze)

router.post("/:id/agent", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    if (action !== "generate-plan" && action !== "analyze") {
      return res.status(400).json({ message: "Invalid agent action." });
    }

    const project = await runAgentGraph(id, action);
    res.json(project);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    res.status(500).json({ message: "Agent action failed." });
  }
});

module.exports = router;
