// Sets up the Express server, middleware, and routes
const express = require("express");
const cors = require("cors");
const projectRoutes = require("./routes/projects");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/projects", projectRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Server is running",
  });
});

module.exports = app;
