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

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Réponse IA sans tableau JSON exploitable: " + text);
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

// Generiert mehrere eiweißreiche / kohlenhydratmoderate / <700 kcal Rezepte
// aus den vom Nutzer im Kühlschrank/Vorrat notierten Lebensmitteln.
// excludeTitles: Titel, die NICHT nochmal vorgeschlagen werden sollen
// (z.B. wenn der Nutzer "andere Vorschläge" anfordert).
async function generateRecipesFromPantryItems(items, portions, count = 3, excludeTitles = []) {
  const excludeNote =
    excludeTitles.length > 0
      ? `\nSchlage KEINE dieser bereits gezeigten Rezepte (oder sehr ähnliche) erneut vor: ${excludeTitles.join(
          ", "
        )}. Denk dir wirklich andere Gerichte aus.`
      : "";

  const prompt = `Hier sind die verfügbaren Lebensmittel eines Nutzers, der abnehmen möchte: ${items.join(
    ", "
  )}.
Schlage ${count} VERSCHIEDENE Rezepte vor, die hauptsächlich mit diesen Zutaten umsetzbar sind
(du kannst 1-2 Grundzutaten wie Salz, Öl, Gewürze pro Rezept ergänzen, falls nötig). Die ${count}
Rezepte sollen sich spürbar voneinander unterscheiden (unterschiedliche Zubereitungsart, Hauptzutat
oder Küchenstil). Strenge Vorgaben für JEDES Rezept:
- Eiweißreich (mindestens 30g Eiweiß pro Portion)
- Moderate Kohlenhydrate (maximal 50g pro Portion)
- Weniger als 700 kcal pro Portion
Jedes Rezept ist für ${portions} Portion(en) insgesamt (Zutatenmengen für ${portions} Portion(en),
aber "perPortion" gilt für EINE einzelne Portion).${excludeNote}

WICHTIG: Schreibe ALLE Texte (Titel, Zutatennamen, Zubereitungsschritte, Tags) auf DEUTSCH.

Antworte AUSSCHLIESSLICH mit einem JSON-ARRAY von ${count} Objekten in dieser Form, ohne Text
drumherum:
[
  {
    "id": "string-slug",
    "title": "string",
    "tags": ["Abnehmen", "eiweißreich"],
    "basePortions": ${portions},
    "prepMinutes": number,
    "ingredients": [{"name": "string", "quantity": number, "unit": "string"}],
    "steps": ["string", ...],
    "perPortion": {"kcal": number, "proteinG": number, "carbsG": number, "fatG": number}
  }
]`;

  const text = await callGemini([{ text: prompt }]);
  const parsed = extractJsonArray(text);
  return parsed.map((r, idx) => ({
    ...r,
    id: r.id || `pantry-${Date.now()}-${idx}`,
    source: "pantry",
  }));
}

module.exports = { analyzeTikTokFrames, generateRecipesFromPantryItems };
