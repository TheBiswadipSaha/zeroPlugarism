const axios = require("axios");
const nlp = require("compromise");

// ... paste all your helper functions from server.js here
// (killAICliches, replaceTransitions, rewriteText, etc.)

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { text, mode = "standard", intensity = 70 } = JSON.parse(event.body);

  if (!text) return { statusCode: 400, body: JSON.stringify({ error: "Missing text" }) };

  const result = await rewriteText(text, mode, intensity);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, ...result }),
  };
};