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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini gratuit renvoie parfois une erreur 503 "model overloaded" en cas de
// pic de demande — c'est temporaire côté Google. On réessaie automatiquement
// quelques fois avec un petit délai avant d'abandonner, au lieu de faire
// échouer directement toute l'analyse pour l'utilisateur.
async function callGemini(parts, attempt = 1) {
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
    const maxAttempts = 3;
    if ((response.status === 503 || response.status === 429) && attempt < maxAttempts) {
      const delayMs = attempt * 4000;
      console.warn(
        `[gemini] Erreur ${response.status} (surcharge), nouvelle tentative ${attempt + 1}/${maxAttempts} dans ${delayMs}ms`
      );
      await sleep(delayMs);
      return callGemini(parts, attempt + 1);
    }
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

  const prompt = `Du bist ein Ernährungsexperte. Diese Bilder sind mehrere Standbilder, die
GLEICHMÄSSIG ÜBER DIE GESAMTE DAUER eines TikTok-Kochvideos verteilt entnommen wurden (Anfang,
Mitte und Ende des Videos). Schau dir WIRKLICH JEDES einzelne Bild genau an, auch wenn eine
Zutat nur auf einem einzigen Bild kurz zu sehen ist (z.B. eine Zutat, die nur beim Einwiegen
oder Hinzufügen kurz gezeigt wird) — übernimm sie trotzdem in die Zutatenliste. Fasse ALLE über
die Bilder verteilt sichtbaren Zutaten zusammen, nicht nur die aus dem ersten Bild.

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

// Style-Vorgaben, um die parallel generierten Rezepte unterschiedlich zu
// halten (statt 3x das gleiche naheliegende Gericht zu bekommen).
const RECIPE_STYLE_HINTS = [
  "Mach es schnell und einfach (maximal 20 Minuten Zubereitung).",
  "Mach es klassisch/herzhaft, gerne mit warmer Zubereitung (Pfanne/Ofen).",
  "Sei kreativ mit einer ungewöhnlicheren Kombination oder einem anderen Küchenstil.",
];

async function generateSingleRecipe(items, portions, excludeTitles, styleHint) {
  const excludeNote =
    excludeTitles.length > 0
      ? `\nSchlage KEIN Rezept vor, das einem dieser Titel entspricht oder sehr ähnlich ist: ${excludeTitles.join(
          ", "
        )}. Denk dir wirklich etwas anderes aus.`
      : "";

  const prompt = `Hier sind die verfügbaren Lebensmittel eines Nutzers, der abnehmen möchte: ${items.join(
    ", "
  )}.
Schlage EIN Rezept vor, das hauptsächlich mit diesen Zutaten umsetzbar ist (du kannst 1-2
Grundzutaten wie Salz, Öl, Gewürze ergänzen, falls nötig). ${styleHint} Strenge Vorgaben:
- Eiweißreich (mindestens 30g Eiweiß pro Portion)
- Moderate Kohlenhydrate (maximal 50g pro Portion)
- Weniger als 700 kcal pro Portion
Das Rezept ist für ${portions} Portion(en) insgesamt (Zutatenmengen für ${portions} Portion(en),
aber "perPortion" gilt für EINE einzelne Portion).${excludeNote}

WICHTIG: Schreibe ALLE Texte (Titel, Zutatennamen, Zubereitungsschritte, Tags) auf DEUTSCH. Sei
prägnant: maximal 6 Zutaten und maximal 4 Zubereitungsschritte.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in dieser Form, ohne Text drumherum:
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
  return extractJson(text);
}

// Generiert mehrere eiweißreiche / kohlenhydratmoderate / <700 kcal Rezepte
// aus den vom Nutzer im Kühlschrank/Vorrat notierten Lebensmitteln. Die
// Rezepte werden PARALLEL angefragt (statt eins nach dem anderen), damit es
// spürbar schneller geht.
// excludeTitles: Titel, die NICHT nochmal vorgeschlagen werden sollen
// (z.B. wenn der Nutzer "andere Vorschläge" anfordert).
async function generateRecipesFromPantryItems(items, portions, count = 3, excludeTitles = []) {
  const hints = RECIPE_STYLE_HINTS.slice(0, count);
  while (hints.length < count) hints.push(RECIPE_STYLE_HINTS[hints.length % RECIPE_STYLE_HINTS.length]);

  const results = await Promise.all(
    hints.map((hint) => generateSingleRecipe(items, portions, excludeTitles, hint))
  );

  return results.map((r, idx) => ({
    ...r,
    id: r.id || `pantry-${Date.now()}-${idx}`,
    source: "pantry",
  }));
}

module.exports = { analyzeTikTokFrames, generateRecipesFromPantryItems };
