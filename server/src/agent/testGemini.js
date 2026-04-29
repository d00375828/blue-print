// Keeping this so I remember how to do it later. Initial set up how to hook up gemini api and test it out.

require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

async function testGemini() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents:
        "Tell me why Spiderman is the best super hero. Treat your answer like you have the knowledge of a superfan. Keep your answer to 1 paragraph.",
    });

    console.log("Gemini response:");
    console.log(response.text);
  } catch (error) {
    console.error("Gemini test failed:", error.message);
    process.exit(1);
  }
}

testGemini();
