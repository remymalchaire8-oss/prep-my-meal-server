require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { downloadAndExtractFrames } = require("./tiktokDownload");
const { analyzeTikTokFrames, generateRecipesFromPantryItems } = require("./analyzeFood");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/analyze-tiktok", async (req, res) => {
  const { videoUrl, portions } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: "videoUrl est requis" });
  }
  const portionCount = Number(portions) > 0 ? Number(portions) : 1;

  try {
    const frames = await downloadAndExtractFrames(videoUrl);
    const result = await analyzeTikTokFrames(frames, portionCount);
    result.videoUrl = videoUrl;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate-recipe-from-pantry", async (req, res) => {
  const { items, portions, excludeTitles } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items (liste d'aliments) est requis" });
  }
  const portionCount = Number(portions) > 0 ? Number(portions) : 1;
  const exclude = Array.isArray(excludeTitles) ? excludeTitles : [];

  try {
    const recipes = await generateRecipesFromPantryItems(items, portionCount, 3, exclude);
    res.json({ recipes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Prep My Meal backend en écoute sur http://localhost:${PORT}`);
});
