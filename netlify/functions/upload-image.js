const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { parseMultipart } = require("./lib/multipart");
const { uploadMedia } = require("./lib/wp");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    const { fields, files } = await parseMultipart(event);
    const file = files.find((f) => f.fieldname === "image");
    if (!file) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mangler bildefil." }) };
    }

    const media = await uploadMedia({
      buffer: file.buffer,
      filename: file.filename,
      mimeType: file.mimeType || "image/jpeg",
      altText: fields.altText || "",
      caption: fields.caption || "",
    });

    return { statusCode: 200, body: JSON.stringify(media) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
