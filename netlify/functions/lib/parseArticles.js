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

function bodyTextToHtml(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

module.exports = { parseArticles, bodyTextToHtml };
