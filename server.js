import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error("❌ GOOGLE_API_KEY missing");
  process.exit(1);
}

/* ✅ UPDATED MODEL QUEUE FOR DEC 2025 */
const MODEL_QUEUE = [
  "gemini-3-flash-preview", // 🥇 Fastest (Newest)
  "gemini-2.5-flash",         // 🥈 Stable Fallback
  "gemini-1.5-flash"          // 🥉 High-Availability Fallback
];

// Helper delay
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ✅ GENERATOR WITH AUTOMATIC FALLBACK & RETRY
async function generateContent(prompt, history, modelIndex = 0, retries = 2) {
  const model = MODEL_QUEUE[modelIndex] || MODEL_QUEUE[0];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const contents = [];
  if (Array.isArray(history)) {
    history.forEach(m => {
      if (!m.content) return;
      contents.push({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }]
      });
    });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents })
    });

    const data = await response.json();

    // 🚩 Handle Errors: Not Found (404), Overloaded (500), or Rate Limit (429)
    if (!response.ok) {
      if (response.status === 404 || response.status === 500 || response.status === 429) {
        // Switch to next model immediately for better speed
        if (modelIndex < MODEL_QUEUE.length - 1) {
          console.warn(`🔄 ${model} issue (${response.status}). Trying ${MODEL_QUEUE[modelIndex + 1]}...`);
          return generateContent(prompt, history, modelIndex + 1, retries);
        }
        
        // If we ran out of models, retry the whole cycle once after a delay
        if (retries > 0) {
          console.warn(`⚠️ All models busy. Waiting 1.5s...`);
          await wait(1500);
          return generateContent(prompt, history, 0, retries - 1);
        }
      }
      throw new Error(data.error?.message || `API Error ${response.status}`);
    }

    return { data, usedModel: model };
  } catch (err) {
    // Catch network-level errors and retry
    if (retries > 0) {
      await wait(1000);
      return generateContent(prompt, history, modelIndex, retries - 1);
    }
    throw err;
  }
}

// Text route
app.post("/generate", async (req, res) => {
  const { prompt, history } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt missing" });

  try {
    const result = await generateContent(prompt, history);

    const text =
      result.data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response";

    res.json({ response: text, model: result.usedModel });

  } catch (err) {
    console.error("🔥 Final Error:", err.message);
    res.status(500).json({
      error: err.message,
      response: "The AI is currently receiving too much traffic. Please try again in a moment."
    });
  }
});

// ✅ PDF Export Route
app.post("/exportPDF", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "No content provided" });

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const fontSize = 12;
    const maxWidth = 500;
    let y = 800;

    const lines = font.splitTextIntoLines(content, maxWidth);

    lines.forEach(line => {
      if (y < 40) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(line, {
        x: 50,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      y -= fontSize + 5;
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=export.pdf");
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`🤖 Using Model Queue: ${MODEL_QUEUE.join(", ")}`);
  });
}


export default app;