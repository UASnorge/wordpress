// Leser en .docx-fil direkte som en ZIP (via JSZip) og går gjennom word/document.xml
// avsnitt for avsnitt, i dokumentrekkefølge. For hvert avsnitt hentes tekstinnholdet
// OG eventuelle innebygde bilder (via r:embed-referanser slått opp i relasjonsfila).
//
// Dette gir oss det mammoth sin enkle extractRawText() ikke kan: nøyaktig hvor i
// dokumentet et bilde faktisk ligger, slik at vi kan koble det til riktig sak og
// riktig posisjon i brødteksten.

const JSZip = require("jszip");

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function extToMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Returnerer { paragraphs, images }
// paragraphs: [{ text, imageIndexes: [n, ...] }]  (i dokumentrekkefølge)
// images: [{ filename, mimeType, buffer }]        (i dokumentrekkefølge)
async function extractDocxStructure(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const relsXml = relsEntry ? await relsEntry.async("string") : "";
  const relMap = {};
  const relRegex = /Id="(rId\d+)"[^>]*Target="media\/([^"]+)"/g;
  let relMatch;
  while ((relMatch = relRegex.exec(relsXml))) {
    relMap[relMatch[1]] = relMatch[2];
  }

  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) {
    throw new Error("Fant ikke word/document.xml - er dette en gyldig .docx-fil?");
  }
  const documentXml = await documentEntry.async("string");

  const paraMatches = documentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];

  const images = [];
  const imageCache = new Map(); // filename -> index (unngår å lese samme bilde flere ganger)
  const paragraphs = [];

  for (const paraXml of paraMatches) {
    const textPieces = [...paraXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const text = textPieces.join("").trim();

    const imageIndexes = [];
    const embedRegex = /r:embed="(rId\d+)"/g;
    let embedMatch;
    while ((embedMatch = embedRegex.exec(paraXml))) {
      const filename = relMap[embedMatch[1]];
      if (!filename) continue;

      let idx = imageCache.get(filename);
      if (idx === undefined) {
        const mediaEntry = zip.file(`word/media/${filename}`);
        if (!mediaEntry) continue;
        const imgBuffer = await mediaEntry.async("nodebuffer");
        images.push({ filename, mimeType: extToMime(filename), buffer: imgBuffer });
        idx = images.length - 1;
        imageCache.set(filename, idx);
      }
      imageIndexes.push(idx);
    }

    if (text || imageIndexes.length) {
      paragraphs.push({ text, imageIndexes });
    }
  }

  return { paragraphs, images };
}

module.exports = { extractDocxStructure };
