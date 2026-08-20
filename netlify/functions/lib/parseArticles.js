// Tolker rå tekst (fra Word-dokumentet) til en liste med saker.
// Format per sak, adskilt med en linje som kun inneholder ===:
//
// TITTEL: ...
// INGRESS: ...
// HOVEDTEKST:
// ...flere avsnitt...
// BILDE: filnavn.jpg
// ALT-TEKST BILDE: ...
// FOTO: ... (valgfritt - fotokreditering, kan også settes/endres i appen)

const LABELS = ["TITTEL", "INGRESS", "HOVEDTEKST", "BILDE", "ALT-TEKST BILDE", "FOTO"];

function escapeRegex(s) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

const labelRegex = new RegExp(`^(${LABELS.map(escapeRegex).join("|")}):[ \\t]*`, "gm");

// Mammoth setter alltid \n\n mellom HVER Word-avsnitt, også når kilde-dokumentet
// allerede har en tom linje mellom avsnitt (dobbel Enter) - da blir det \n\n\n\n,
// som vises som 2-3 tomme linjer i redigeringsfeltet. Normaliserer til nøyaktig
// én tom linje (\n\n) mellom avsnitt, uansett hvor mange linjeskift kilden hadde.
function normalizeBlankLines(text) {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function parseBlock(block, index) {
  const matches = [...block.matchAll(labelRegex)];
  const fields = {};
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : block.length;
    fields[label] = normalizeBlankLines(block.slice(start, end));
  }

  const title = fields["TITTEL"] || "";
  const warnings = [];
  if (!title) warnings.push("Mangler tittel");
  if (!fields["INGRESS"]) warnings.push("Mangler ingress");
  if (!fields["HOVEDTEKST"]) warnings.push("Mangler hovedtekst");
  if (!fields["BILDE"]) warnings.push("Mangler bildefilnavn (BILDE:)");

  return {
    id: `sak-${index + 1}`,
    title,
    ingress: fields["INGRESS"] || "",
    body: fields["HOVEDTEKST"] || "",
    imageFilename: (fields["BILDE"] || "").trim(),
    altText: fields["ALT-TEKST BILDE"] || "",
    photoCredit: fields["FOTO"] || "",
    parseWarnings: warnings,
  };
}

function parseArticles(rawText) {
  const normalized = rawText.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split(/^\s*={3,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map(parseBlock);
}

const SINGLE_LINE_FIELDS = ["TITTEL", "INGRESS", "BILDE", "ALT-TEKST BILDE", "FOTO"];
const labelLineRegex = new RegExp(`^(${LABELS.map(escapeRegex).join("|")}):[ \\t]*(.*)$`);

// Tolker saker fra en STRUKTURERT avsnittsliste (fra docxStructure.js), der bilder
// er innebygd direkte i Word-dokumentet i stedet for opplastet som egne filer.
//
// Konvensjon: det FØRSTE bildet i en sak blir hovedbildet (som BILDE:-feltet i
// tekstformatet). Eventuelle FLERE bilder i samme sak settes inn i brødteksten,
// på nøyaktig det stedet de dukker opp, som en markør ([[BILDE:n]]) - erstattes
// med en ekte <img>-tag når bildet er lastet opp til WordPress (se app.js).
function parseArticlesFromStructured(paragraphs) {
  const articles = [];
  let current = null;
  let currentField = null;

  function startArticle() {
    current = { fields: {}, bodyLines: [], heroImage: null, inlineImages: [] };
    currentField = null;
  }

  function assignImage(idx) {
    if (!current) return;
    if (current.heroImage === null) {
      current.heroImage = idx;
    } else {
      current.inlineImages.push(idx);
      current.bodyLines.push(`[[BILDE:${idx}]]`);
    }
  }

  function finish() {
    if (!current) return;
    const title = (current.fields.TITTEL || "").trim();
    const body = normalizeBlankLines(current.bodyLines.join("\n\n"));
    const warnings = [];
    if (!title) warnings.push("Mangler tittel");
    if (!current.fields.INGRESS) warnings.push("Mangler ingress");
    if (!body) warnings.push("Mangler hovedtekst");
    if (current.heroImage === null && !current.fields.BILDE) {
      warnings.push("Mangler bilde (verken innebygd bilde eller BILDE:-filnavn funnet)");
    }

    articles.push({
      id: `sak-${articles.length + 1}`,
      title,
      ingress: (current.fields.INGRESS || "").trim(),
      body,
      imageFilename: (current.fields.BILDE || "").trim(),
      altText: (current.fields["ALT-TEKST BILDE"] || "").trim(),
      photoCredit: (current.fields.FOTO || "").trim(),
      heroImageIndex: current.heroImage,
      inlineImageIndexes: current.inlineImages,
      parseWarnings: warnings,
    });
  }

  for (const para of paragraphs) {
    const text = para.text;

    if (/^=+$/.test(text) && text.length >= 3) {
      finish();
      current = null;
      currentField = null;
      continue;
    }

    const labelMatch = text.match(labelLineRegex);
    if (labelMatch) {
      if (!current) startArticle();
      const label = labelMatch[1];
      current.fields[label] = labelMatch[2] || "";
      currentField = label;
      para.imageIndexes.forEach(assignImage);
      continue;
    }

    if (!current) continue; // tekst før første TITTEL: ignoreres (forklaringer, overskrifter osv.)

    if (currentField && SINGLE_LINE_FIELDS.includes(currentField)) {
      // Ekstra tekst rett under et enkeltlinje-felt uten ny label - slå sammen (sjeldent tilfelle)
      if (text) current.fields[currentField] = `${current.fields[currentField] || ""} ${text}`.trim();
    } else if (currentField === "HOVEDTEKST") {
      if (text) current.bodyLines.push(text);
    }

    para.imageIndexes.forEach(assignImage);
  }
  finish();

  return articles;
}

function bodyTextToHtml(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

module.exports = { parseArticles, parseArticlesFromStructured, bodyTextToHtml };
