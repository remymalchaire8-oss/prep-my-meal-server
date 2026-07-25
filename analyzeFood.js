// Utilise l'API Google Gemini (gratuite avec limites, via aistudio.google.com)
// pour l'analyse d'images et la génération de recettes. Utilise le "fetch"
// natif de Node.js (disponible depuis Node 18+), donc aucune librairie
// supplémentaire n'est nécessaire.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Réponse IA sans JSON exploitable: " + text);
  return JSON.parse(match[0]);
}

async function callGemini(parts) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY manquante. Ajoute-la dans server/.env (clé gratuite sur https://aistudio.google.com/apikey)."
    );
  }

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || JSON.stringify(data);
    throw new Error(`Gemini a renvoyé une erreur (${response.status}): ${message}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n");
  if (!text) {
    throw new Error("Réponse Gemini vide ou inattendue: " + JSON.stringify(data));
  }
  return text;
}

// Analyse une ou plusieurs frames extraites d'une vidéo TikTok et retourne
// une estimation des aliments, une recette possible et sa valeur nutritionnelle.
async function analyzeTikTokFrames(framesBase64, portions) {
  const imageParts = framesBase64.map((data) => ({
    inline_data: { mime_type: "image/jpeg", data },
  }));

  const prompt = `Du bist ein Ernährungsexperte. Diese Bilder stammen aus einem TikTok-Kochvideo.
Identifiziere die sichtbaren Gerichte/Lebensmittel, leite ein plausibles Rezept ab (Zutaten +
Zubereitungsschritte) und schätze die Nährwerte PRO PORTION (kcal, Eiweiß g, Kohlenhydrate g,
Fett g). Das Rezept soll für ${portions} Portion(en) insgesamt angepasst werden (gib die
Gesamtmengen der Zutaten für ${portions} Portion(en) an, aber die Nährwerte unter "perPortion"
gelten für EINE einzelne Portion).

WICHTIG: Schreibe ALLE Texte (Titel, Zutatennamen, Zubereitungsschritte) auf DEUTSCH.

Antworte AUSSCHLIESSLICH mit einem JSON in dieser Form, ohne Text drumherum:
{
  "detectedFoods": ["string", ...],
  "estimatedRecipeTitle": "string",
  "ingredients": [{"name": "string", "quantity": number, "unit": "string"}],
  "steps": ["string", ...],
  "perPortion": {"kcal": number, "proteinG": number, "carbsG": number, "fatG": number},
  "confidence": "low" | "medium" | "high"
}`;

  const text = await callGemini([...imageParts, { text: prompt }]);
  const parsed = extractJson(text);
  return { ...parsed, portions };
}

// Génère une recette high-protein / carb modéré / <700 kcal par portion à
// partir de la liste d'aliments notés par l'utilisateur dans son frigo/placard.
async function generateRecipeFromPantryItems(items, portions) {
  const prompt = `Hier sind die verfügbaren Lebensmittel eines Nutzers, der abnehmen möchte: ${items.join(
    ", "
  )}.
Schlage EIN Rezept vor, das hauptsächlich mit diesen Zutaten umsetzbar ist (du kannst 1-2
Grundzutaten wie Salz, Öl, Gewürze ergänzen, falls nötig). Strenge Vorgaben:
- Eiweißreich (mindestens 30g Eiweiß pro Portion)
- Moderate Kohlenhydrate (maximal 50g pro Portion)
- Weniger als 700 kcal pro Portion
Das Rezept ist für ${portions} Portion(en) insgesamt (Zutatenmengen für ${portions} Portion(en),
aber "perPortion" gilt für EINE einzelne Portion).

WICHTIG: Schreibe ALLE Texte (Titel, Zutatennamen, Zubereitungsschritte, Tags) auf DEUTSCH.

Antworte AUSSCHLIESSLICH mit einem JSON in dieser Form, ohne Text drumherum:
{
  "id": "string-slug",
  "title": "string",
  "tags": ["Abnehmen", "eiweißreich"],
  "basePortions": ${portions},
  "prepMinutes": number,
  "ingredients": [{"name": "string", "quantity": number, "unit": "string"}],
  "steps": ["string", ...],
  "perPortion": {"kcal": number, "proteinG": number, "carbsG": number, "fatG": number}
}`;

  const text = await callGemini([{ text: prompt }]);
  const parsed = extractJson(text);
  return { ...parsed, source: "pantry" };
}

module.exports = { analyzeTikTokFrames, generateRecipeFromPantryItems };
