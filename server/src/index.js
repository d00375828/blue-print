// Starts server and connects to DB

require("dotenv").config();

const app = require("./app");
const connectDB = require("./db");

const PORT = process.env.PORT || 5001;

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
