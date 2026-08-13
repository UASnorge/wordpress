const Busboy = require("busboy");

// Parser multipart/form-data fra en Netlify Functions-event.
// Returnerer { fields: {name: value}, files: [{fieldname, filename, mimeType, buffer}] }
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType) {
      reject(new Error("Mangler content-type header"));
      return;
    }
    const busboy = Busboy({ headers: { "content-type": contentType } });
    const fields = {};
    const files = [];

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        files.push({ fieldname, filename, mimeType, buffer: Buffer.concat(chunks) });
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    const bodyBuffer = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
    busboy.end(bodyBuffer);
  });
}

module.exports = { parseMultipart };
