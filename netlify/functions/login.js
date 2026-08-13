const { issueToken } = require("./lib/auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Ugyldig forespørsel" }) };
  }

  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) {
    return { statusCode: 500, body: JSON.stringify({ error: "APP_ACCESS_PASSWORD er ikke konfigurert på serveren." }) };
  }

  if (body.password !== expected) {
    return { statusCode: 401, body: JSON.stringify({ error: "Feil passord." }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ token: issueToken() }),
  };
};
