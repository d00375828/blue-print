// Mongoose model stuff with server validat

const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    phase: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["todo", "done"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    goal: {
      type: String,
      required: true,
      trim: true,
    },
    tasks: {
      type: [taskSchema],
      default: [],
    },
    healthSummary: {
      type: String,
      default: "",
    },
    nextActions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Project", projectSchema);
