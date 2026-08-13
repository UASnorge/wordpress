const Anthropic = require("@anthropic-ai/sdk");
const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { parseMultipart } = require("./lib/multipart");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY er ikke konfigurert på serveren." }) };
  }

  try {
    const { fields, files } = await parseMultipart(event);
    const { title = "", ingress = "", body = "" } = fields;
    const image = files.find((f) => f.fieldname === "image");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const content = [
      {
        type: "text",
        text: [
          "Du vurderer en nyhetssak før publisering på nettsiden til en bransjeorganisasjon.",
          "Vurder tittel, ingress og hovedtekst for språk, sammenheng og om de henger sammen.",
          image
            ? "Vurder også om bildet passer som illustrasjon til saken."
            : "Det er ikke lastet opp bilde til denne saken - flagg det som en advarsel.",
          "",
          `TITTEL: ${title}`,
          `INGRESS: ${ingress}`,
          `HOVEDTEKST: ${body}`,
          "",
          "Svar KUN med gyldig JSON på dette formatet, uten annen tekst:",
          '{"warnings": ["kort advarsel 1", "kort advarsel 2"], "imageMatch": "god" | "usikker" | "dårlig" | "ikke_vurdert", "comment": "én kort setning med generell vurdering"}',
        ].join("\n"),
      },
    ];

    if (image) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType || "image/jpeg",
          data: image.buffer.toString("base64"),
        },
      });
    }

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const parsed = extractJson(textBlock ? textBlock.text : "{}");

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
