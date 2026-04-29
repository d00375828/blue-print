// Langchain agent graph for projects,

require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Annotation, END, START, StateGraph } = require("@langchain/langgraph");
const Project = require("../models/Project");

// Schema setups

const taskSchema = z.object({
  phase: z.string(),
  order: z.number(),
  title: z.string(),
  status: z.enum(["todo", "done"]),
  priority: z.enum(["low", "medium", "high"]),
});

const generatePlanFormat = {
  tasks: [
    {
      phase: "Planning",
      order: 1,
      title: "Define project scope",
      status: "todo",
      priority: "high",
    },
  ],
};

const analyzeFormat = {
  healthSummary: "string",
  nextActions: ["string", "string", "string"],
};

const generateTasksToolSchema = z.object({
  title: z.string(),
  goal: z.string(),
});

const analyzeProjectToolSchema = z.object({
  title: z.string(),
  goal: z.string(),
  tasks: z.array(taskSchema),
});

const saveProjectUpdateToolSchema = z
  .object({
    projectId: z.string(),
    tasks: z.array(taskSchema).optional(),
    healthSummary: z.string().optional(),
    nextActions: z.array(z.string()).length(3).optional(),
  })
  .superRefine((value, ctx) => {
    const hasTasks = Array.isArray(value.tasks);
    const hasAnalysis =
      typeof value.healthSummary === "string" &&
      Array.isArray(value.nextActions);

    if (!hasTasks && !hasAnalysis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must provide tasks or analysis fields.",
      });
    }
  });

const generatePlanResponseSchema = z.object({
  tasks: z.array(taskSchema).min(1).max(15),
});

const analyzeResponseSchema = z.object({
  healthSummary: z.string(),
  nextActions: z.array(z.string()).length(3),
});

// Prompt builders for AI tools

function buildGeneratePlanPrompt(title, goal) {
  return `Create a complete project timeline from start to finish.

Return only valid JSON in this exact shape:
${JSON.stringify(generatePlanFormat, null, 2)}

You are an experienced project management assistant helping to create a detailed timeline for a project. You strive to develop step by step supoortive timelines that optimize for speed and simplicity.
Every task should be a specific actionable item that directly contributes to achieving the project goal. Avoid generic tasks that don't clearly move the project forward.
Responde like you are writing a task list for someone who is new to project management, so include all necessary details and avoid assuming any prior knowledge.
Return 12 to 25 tasks total.
Use the phase field to group tasks into timeline stages.
Use short phase names like Planning, Setup, Build, Testing, Launch.
Set status to "todo" for every task.
Set order to keep the timeline in start-to-finish order.
Make the tasks detailed and specific to the project goal, not generic.
Prioritize tasks as low, medium, or high based on their importance to project success.
High priority tasks block progress or core functionality, medium priority tasks are important but not critical, and low priority tasks are nice to have but not essential.

Project title: ${title}
Project goal: ${goal}`;
}

function buildAnalyzePrompt(title, goal, tasks) {
  return `Analyze this project.

Return only valid JSON in this exact shape:
${JSON.stringify(analyzeFormat, null, 2)}

You are an experienced project management assistant helping to analyze the health of a project based on its timeline and provide actionable next steps. 
Be honest and direct in your assessment, and provide clear recommendations for moving the project forward.
Prioritize the most important next steps that will have the biggest impact on project progress. Focus on providing actionable advice that directly addresses any issues in the timeline.
Each next action should be specific and actionable.
Avoid generic advice that doesn't clearly guide the project forward.
Write tasks that 1 person can complete in a reasonable timeframe, and avoid suggesting tasks that are too large or complex.


Project title: ${title}
Project goal: ${goal}
Project tasks: ${JSON.stringify(tasks)}`;
}

// Helper functions

function createError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getModel() {
  return new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0,
  });
}

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

// Cleanup to make data consistent

function normalizeTask(task) {
  const phase = typeof task.phase === "string" ? task.phase.trim() : "";
  const order = Number.isFinite(task.order) ? Number(task.order) : 0;
  const title = typeof task.title === "string" ? task.title.trim() : "";
  const status = task.status === "done" ? "done" : "todo";
  const allowedPriorities = ["low", "medium", "high"];
  const priority = allowedPriorities.includes(task.priority)
    ? task.priority
    : "medium";

  if (!phase || !title) {
    return null;
  }

  return {
    phase,
    order,
    title,
    status,
    priority,
  };
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks
    .map(normalizeTask)
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .slice(0, 25);
}

function normalizeNextActions(nextActions) {
  const actions = Array.isArray(nextActions)
    ? nextActions
        .map((action) => (typeof action === "string" ? action.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  while (actions.length < 3) {
    actions.push("Review the project timeline.");
  }

  return actions;
}

// AI tools

// Tool 1 - generates project tasks based on title and goal, returns tasks

async function generateTasksTool(input) {
  const parsedInput = generateTasksToolSchema.parse(input);
  const model = getModel().withStructuredOutput(generatePlanResponseSchema, {
    name: "GenerateTasks",
  });

  const result = await model.invoke(
    buildGeneratePlanPrompt(parsedInput.title, parsedInput.goal)
  );

  return {
    tasks: normalizeTasks(result.tasks),
  };
}

// Tool 2 - analyzes project based on title, goal, and tasks. Returns health summary and next actions.

async function analyzeProjectTool(input) {
  const parsedInput = analyzeProjectToolSchema.parse(input);
  const model = getModel().withStructuredOutput(analyzeResponseSchema, {
    name: "AnalyzeProject",
  });

  const result = await model.invoke(
    buildAnalyzePrompt(parsedInput.title, parsedInput.goal, parsedInput.tasks)
  );

  return {
    healthSummary: result.healthSummary.trim(),
    nextActions: normalizeNextActions(result.nextActions),
  };
}

// Tool 3 - saves project updates to mongo based on what was changed. Going to ese for both 2 calls to update project.

async function saveProjectUpdateTool(input) {
  const parsedInput = saveProjectUpdateToolSchema.parse(input);
  const updates = {};

  if (parsedInput.tasks) {
    updates.tasks = parsedInput.tasks;
    updates.healthSummary = calculateHealthSummary(parsedInput.tasks);
  }

  if (parsedInput.healthSummary && parsedInput.nextActions) {
    updates.healthSummary = parsedInput.healthSummary;
    updates.nextActions = parsedInput.nextActions;
  }

  const project = await Project.findByIdAndUpdate(
    parsedInput.projectId,
    updates,
    {
      returnDocument: "after", // Mongo DB behaviors
      runValidators: true,
    }
  );

  if (!project) {
    throw createError("Project not found.", 404);
  }

  return { project };
}

const AgentState = Annotation.Root({
  projectId: Annotation(), // Annotation is how langgraph knows data exists and how to pass it. It helps merge partial updates, without annotation every update will replace the whole state.
  action: Annotation(),
  project: Annotation(),
  tasks: Annotation(),
  healthSummary: Annotation(),
  nextActions: Annotation(),
  updatedProject: Annotation(),
});

// NODE 1 Loads the project from mongo

async function loadProject(state) {
  const project = await Project.findById(state.projectId);

  if (!project) {
    throw createError("Project not found.", 404);
  }

  return {
    projectId: state.projectId,
    action: state.action,
    project,
    tasks: [],
    healthSummary: "",
    nextActions: [],
    updatedProject: null,
  };
}

// NODE 2 Routes to either plan or analysis based on action

function routeAction(state) {
  if (state.action === "generate-plan") {
    return "generatePlan";
  }

  if (state.action === "analyze") {
    return "analyzeProject";
  }

  throw createError("Invalid agent action.", 400);
}

// NODE 3 Generates plan based on title and goal, returns tasks within the project. AI tool call 1

async function generatePlan(state) {
  const result = await generateTasksTool({
    title: state.project.title,
    goal: state.project.goal,
  });

  return {
    tasks: result.tasks,
  };
}

// NODE 4 Analyze project through title, goal, and tasks. Returns health summary and next actions. AI tool call 2

async function analyzeProject(state) {
  const result = await analyzeProjectTool({
    title: state.project.title,
    goal: state.project.goal,
    tasks: normalizeTasks(state.project.tasks || []),
  });

  return {
    healthSummary: result.healthSummary,
    nextActions: result.nextActions,
  };
}

// NODE 5 Saves updated project with new tasks and analysis.

async function saveProjectUpdate(state) {
  if (state.action === "generate-plan") {
    const result = await saveProjectUpdateTool({
      projectId: state.projectId,
      tasks: state.tasks || [],
    });

    return {
      updatedProject: result.project,
    };
  }

  const result = await saveProjectUpdateTool({
    projectId: state.projectId,
    healthSummary: state.healthSummary || "",
    nextActions: state.nextActions || [],
  });

  return {
    updatedProject: result.project,
  };
}

const graph = new StateGraph(AgentState)
  .addNode("loadProject", loadProject) // Node name, and name of funciton inside node
  .addNode("generatePlan", generatePlan)
  .addNode("analyzeProject", analyzeProject)
  .addNode("saveProjectUpdate", saveProjectUpdate)
  .addEdge(START, "loadProject") // How nodes connect together
  .addConditionalEdges("loadProject", routeAction, {
    // This is how it decides which node to go to based on the routing action
    generatePlan: "generatePlan",
    analyzeProject: "analyzeProject",
  })
  .addEdge("generatePlan", "saveProjectUpdate")
  .addEdge("analyzeProject", "saveProjectUpdate")
  .addEdge("saveProjectUpdate", END)
  .compile(); // Makes it ready to run using graph.invoke

async function runAgentGraph(projectId, action) {
  const result = await graph.invoke({
    projectId,
    action,
  });

  return result.updatedProject;
}

module.exports = {
  generatePlanFormat,
  analyzeFormat,
  buildGeneratePlanPrompt,
  buildAnalyzePrompt,
  calculateHealthSummary,
  generateTasksToolSchema,
  analyzeProjectToolSchema,
  saveProjectUpdateToolSchema,
  generateTasksTool,
  analyzeProjectTool,
  saveProjectUpdateTool,
  runAgentGraph,
};
