const crypto = require("crypto");

const SECRET = process.env.APP_SESSION_SECRET || process.env.APP_ACCESS_PASSWORD || "change-me";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 timer

function sign(payload) {
  const h = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${h}`;
}

function issueToken() {
  const payload = String(Date.now() + TOKEN_TTL_MS); // expiry timestamp
  return sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig || "", "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const expiry = Number(payload);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

// Sjekker Authorization: Bearer <token>-header. Kaster ikke - returnerer bool.
function isAuthorized(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifyToken(token);
}

function unauthorizedResponse() {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: "Ikke innlogget eller utløpt økt." }),
  };
}

module.exports = { issueToken, verifyToken, isAuthorized, unauthorizedResponse };
