const mammoth = require("mammoth");
const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { parseMultipart } = require("./lib/multipart");
const { parseArticles, parseArticlesFromStructured } = require("./lib/parseArticles");
const { extractDocxStructure } = require("./lib/docxStructure");

// Rå bildedata over denne grensen sendes ikke tilbake i ett JSON-svar - Netlify
// Functions har ca. 6 MB grense på svar, og base64 blåser opp størrelsen ~33%.
const MAX_EMBEDDED_IMAGE_BYTES = 4 * 1024 * 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    const { files } = await parseMultipart(event);
    const docxFile = files.find((f) => f.fieldname === "docx");
    if (!docxFile) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mangler docx-fil i forespørselen." }) };
    }

    const { paragraphs, images } = await extractDocxStructure(docxFile.buffer);

    let articles;
    let embeddedImages = null;
    let warning;

    if (images.length > 0) {
      const totalBytes = images.reduce((sum, img) => sum + img.buffer.length, 0);

      if (totalBytes > MAX_EMBEDDED_IMAGE_BYTES) {
        // For mye bildedata til å sendes tilbake i ett svar - tolk kun teksten,
        // og be brukeren laste opp bildene som egne filer i stedet.
        const { value: rawText } = await mammoth.extractRawText({ buffer: docxFile.buffer });
        articles = parseArticles(rawText);
        warning = `Dokumentet inneholder ${images.length} innebygde bilde(r) på til sammen ${(totalBytes / 1024 / 1024).toFixed(1)} MB - for stort til å håndteres automatisk her (grense ca. 4 MB). Last opp bildene som egne filer i stedet for å ha dem innebygd i dokumentet, og referer til dem med BILDE:-feltet i teksten.`;
      } else {
        articles = parseArticlesFromStructured(paragraphs);
        embeddedImages = images.map((img, i) => ({
          index: i,
          mimeType: img.mimeType,
          dataUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
        }));
      }
    } else {
      const { value: rawText } = await mammoth.extractRawText({ buffer: docxFile.buffer });
      articles = parseArticles(rawText);
    }

    if (articles.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          articles: [],
          warning: warning || "Fant ingen saker. Sjekk at dokumentet bruker === som skille mellom saker.",
        }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ articles, images: embeddedImages, warning }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
