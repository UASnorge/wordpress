// AI-assistert tolkning av Word-dokumenter som IKKE følger den faste malen
// (TITTEL:/INGRESS:/HOVEDTEKST:-etiketter). Brukes som fallback i parse-docx.js
// når parseArticlesFromStructured() ikke finner noen saker i det hele tatt.
//
// Strategi: Claude ser bare en NUMMERERT LISTE over avsnittene (med stil og
// bilde-markører, ikke selve bildedataen), og returnerer kun AVSNITTSNUMRE for
// hvert felt - ikke innholdet selv. Selve teksten hentes deretter mekanisk ut
// fra de originale avsnittene. Dette unngår at AI-en risikerer å omskrive eller
// forkorte tekst, og holder svaret lite uansett hvor lang saken er.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function buildParagraphListing(paragraphs) {
  return paragraphs
    .map((p, i) => {
      const styleTag = p.style ? `[${p.style}]` : "";
      const imgTag = p.imageIndexes.length ? ` {BILDE}` : "";
      const text = p.text ? ` ${p.text}` : "";
      return `${i}${styleTag}${imgTag}${text}`;
    })
    .join("\n");
}

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

// Returnerer en liste med { titleParagraph, ingressParagraph, bodyStartParagraph, bodyEndParagraph, heroImageParagraph }
async function aiIdentifyArticles(paragraphs) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY er ikke konfigurert på serveren.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const listing = buildParagraphListing(paragraphs);

  const prompt = [
    "Under er en nummerert liste over avsnittene i et Word-dokument, i dokumentrekkefølge.",
    "Format per linje: <nummer>[avsnittsstil] {BILDE hvis avsnittet inneholder et bilde} tekst",
    "",
    "Dokumentet følger IKKE en fast mal med TITTEL:/INGRESS:-etiketter, men inneholder likevel",
    "én eller flere nyhetssaker/artikler. Identifiser hver sak, og angi avsnittsnumrene som",
    "hører til hvert felt.",
    "",
    "Svar KUN med gyldig JSON på nøyaktig dette formatet, uten annen tekst før eller etter:",
    '{"articles": [{"titleParagraph": <nummer>, "ingressParagraph": <nummer eller null>, "bodyStartParagraph": <nummer>, "bodyEndParagraph": <nummer>, "heroImageParagraph": <nummer eller null>}]}',
    "",
    "Regler:",
    "- bodyStartParagraph til bodyEndParagraph skal dekke ALL brødtekst i saken (inkl. eventuelle",
    "  underoverskrifter inni teksten og en evt. avsluttende oppfordringssetning), men IKKE tittel,",
    "  ingress, eller neste sak sitt innhold.",
    "- heroImageParagraph: avsnittsnummeret til bildet som fungerer best som hovedbilde for saken",
    "  (velg det nærmest toppen av saken). Sett null hvis saken ikke har noe bilde.",
    "- Ikke bruk en tema-/kategorioverskrift som dekker flere saker som titleParagraph.",
    "- Hvis du er usikker på om noe er én eller flere saker, del det heller opp i flere - det er",
    "  bedre at brukeren slår sammen for mange enn at to saker blandes sammen.",
    "- Ikke inkluder tomme/uklare deler av dokumentet (forord, innholdsfortegnelse) som egne saker.",
    "",
    "--- AVSNITT ---",
    listing,
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const parsed = extractJson(textBlock ? textBlock.text : "{}");
  return Array.isArray(parsed.articles) ? parsed.articles : [];
}

// Bygger de samme feltene som parseArticlesFromStructured(), men ut fra
// AI-identifiserte avsnittsområder i stedet for ===/label-tolkning.
function buildArticlesFromRanges(paragraphs, specs) {
  return specs.map((spec, idx) => {
    const titlePara = paragraphs[spec.titleParagraph];
    const title = titlePara ? titlePara.text.trim() : "";

    const ingressPara = spec.ingressParagraph !== null && spec.ingressParagraph !== undefined ? paragraphs[spec.ingressParagraph] : null;
    const ingress = ingressPara ? ingressPara.text.trim() : "";

    let heroImage = null;
    if (spec.heroImageParagraph !== null && spec.heroImageParagraph !== undefined) {
      const heroPara = paragraphs[spec.heroImageParagraph];
      if (heroPara && heroPara.imageIndexes.length) {
        heroImage = heroPara.imageIndexes[0];
      }
    }

    const bodyLines = [];
    const inlineImages = [];
    const start = Math.max(0, spec.bodyStartParagraph ?? 0);
    const end = Math.min(paragraphs.length - 1, spec.bodyEndParagraph ?? -1);

    for (let i = start; i <= end; i++) {
      const para = paragraphs[i];
      if (!para) continue;
      if (para.text) bodyLines.push(para.text);
      for (const imgIdx of para.imageIndexes) {
        if (heroImage === null) {
          heroImage = imgIdx;
        } else if (imgIdx !== heroImage) {
          inlineImages.push(imgIdx);
          bodyLines.push(`[[BILDE:${imgIdx}]]`);
        }
      }
    }

    const body = bodyLines.join("\n\n");
    const warnings = ["AI-tolket - sjekk feltene nøye før innsending"];
    if (!title) warnings.push("Mangler tittel");
    if (!body) warnings.push("Mangler hovedtekst");
    if (heroImage === null) warnings.push("Fant ikke hovedbilde");

    return {
      id: `sak-${idx + 1}`,
      title,
      ingress,
      body,
      imageFilename: "",
      altText: "",
      photoCredit: "",
      heroImageIndex: heroImage,
      inlineImageIndexes: inlineImages,
      parseWarnings: warnings,
      aiAssisted: true,
    };
  });
}

async function aiParseDocx(paragraphs) {
  const specs = await aiIdentifyArticles(paragraphs);
  return buildArticlesFromRanges(paragraphs, specs);
}

module.exports = { aiParseDocx, buildParagraphListing, buildArticlesFromRanges };
