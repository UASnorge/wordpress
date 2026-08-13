const mammoth = require("mammoth");
const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { parseMultipart } = require("./lib/multipart");
const { parseArticles } = require("./lib/parseArticles");

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

    const { value: rawText } = await mammoth.extractRawText({ buffer: docxFile.buffer });
    const articles = parseArticles(rawText);

    if (articles.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          articles: [],
          warning: "Fant ingen saker. Sjekk at dokumentet bruker === som skille mellom saker.",
        }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ articles }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
