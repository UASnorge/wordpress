const Anthropic = require("@anthropic-ai/sdk");
const mammoth = require("mammoth");
const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { listPosts, getTags } = require("./lib/wp");
const { parseMultipart } = require("./lib/multipart");
const { parseArticles } = require("./lib/parseArticles");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Assistenten er bevisst READ-ONLY overfor WordPress: den kan slå opp saker, men
// aldri publisere, slette eller redigere noe selv. Endringer skjer alltid via
// knappene i Oversikt-fanen, med bekreftelse fra brukeren.
const tools = [
  {
    name: "list_posts",
    description:
      "Hent saker (WordPress-innlegg) med filter. Bruk alltid dette verktøyet før du svarer på spørsmål om konkrete saker, lenker, status, kategori eller stikkord - ikke gjett eller finn på lenker.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "draft, publish, eller 'draft,publish' for begge. Standard: draft,publish" },
        search: { type: "string", description: "Søk i tittel/innhold" },
        tagName: { type: "string", description: "Filtrer på stikkord (navn), f.eks. en batch-tag som 'batch-20260814-1432'" },
      },
    },
  },
];

// NB: holdes som funksjonsparameter (ikke modul-nivå state), slik at samtidige
// kall til funksjonen i samme "varme" container ikke kan lekke data til hverandre.
async function runTool(name, input, ctx) {
  if (name === "list_posts") {
    let tagId;
    if (input.tagName) {
      const tags = await getTags(input.tagName);
      const match = tags.find((t) => t.name.toLowerCase() === input.tagName.toLowerCase());
      tagId = match ? match.id : tags[0] && tags[0].id;
    }
    const { posts, total } = await listPosts({
      status: input.status || "draft,publish",
      search: input.search || "",
      tag: tagId,
      perPage: 60,
    });
    const simplified = posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      link: p.link,
      editLink: p.editLink,
      categories: p.categories,
      tags: p.tags,
      date: p.date,
    }));
    ctx.lastPostsResult = simplified;
    return { total, posts: simplified };
  }
  throw new Error(`Ukjent verktøy: ${name}`);
}

// Bygger en tekstoppsummering av et opplastet Word-dokument, slik at brukeren
// kan spørre oppfølgingsspørsmål om det (uten å måtte gå via Ny batch-fanen).
async function summarizeDocx(buffer) {
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const articles = parseArticles(rawText);
  if (articles.length === 0) {
    return "[Vedlagt Word-dokument: fant ingen saker. Sjekk at det bruker === som skille og TITTEL:/INGRESS:/HOVEDTEKST:/BILDE:-feltene.]";
  }
  const lines = articles.map((a, i) => {
    const warn = a.parseWarnings.length ? ` (⚠ ${a.parseWarnings.join(", ")})` : "";
    return `${i + 1}. "${a.title || "(uten tittel)"}" - bilde: ${a.imageFilename || "mangler"}${warn}`;
  });
  return `[Vedlagt Word-dokument tolket - fant ${articles.length} sak(er):\n${lines.join("\n")}]`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY er ikke konfigurert på serveren." }) };
  }

  let history = [];
  let attachedFile = null;
  try {
    const { fields, files } = await parseMultipart(event);
    history = fields.messages ? JSON.parse(fields.messages) : [];
    attachedFile = files.find((f) => f.fieldname === "file") || null;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Ugyldig forespørsel." }) };
  }

  const ctx = { lastPostsResult: null };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = [
    "Du er AI-assistenten i 'WordPress Infosak Batch Administrator', et internt verktøy for å administrere nyhetssaker på uasnorway.no.",
    "Du kan hente informasjon om saker (tittel, status, lenker, kategori, stikkord) med list_posts-verktøyet. Bruk det aktivt - ikke gjett eller finn på lenker/titler selv.",
    "Du kan IKKE publisere, slette eller redigere saker selv. Hvis brukeren ber deg gjøre en endring, forklar kort at det må gjøres via avmerkingsboksene og knappene i Oversikt-fanen, og foreslå gjerne hvilke saker de bør velge der.",
    "Brukeren kan legge ved et Word-dokument (allerede tolket til en liste over saker i meldingen) eller et bilde - kommenter/vurder det når det er relevant for spørsmålet.",
    "Svar kort og konkret på norsk.",
  ].join(" ");

  try {
    let loopMessages = history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    // Legg ved fil på siste brukermelding
    if (attachedFile && loopMessages.length > 0) {
      const lastMsg = loopMessages[loopMessages.length - 1];
      if (lastMsg.role === "user") {
        const originalText = typeof lastMsg.content === "string" ? lastMsg.content : "";
        const content = [];
        const isImage = IMAGE_TYPES.includes(attachedFile.mimeType);
        const isDocx = /\.docx$/i.test(attachedFile.filename || "") || attachedFile.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        if (isDocx) {
          const summary = await summarizeDocx(attachedFile.buffer);
          content.push({ type: "text", text: `${originalText}\n\n${summary}` });
        } else if (isImage) {
          content.push({ type: "text", text: originalText || "Se vedlagt bilde." });
          content.push({
            type: "image",
            source: { type: "base64", media_type: attachedFile.mimeType, data: attachedFile.buffer.toString("base64") },
          });
        } else {
          content.push({ type: "text", text: `${originalText}\n\n[Vedlagt fil "${attachedFile.filename}" er av en filtype som ikke støttes ennå (kun .docx og bilder).]` });
        }
        lastMsg.content = content;
      }
    }

    let finalText = "";
    for (let i = 0; i < 4; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        tools,
        messages: loopMessages,
      });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      const textBlocks = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      if (toolUses.length === 0) {
        finalText = textBlocks;
        break;
      }

      loopMessages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const use of toolUses) {
        try {
          const result = await runTool(use.name, use.input || {}, ctx);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: `Feil: ${err.message}`, is_error: true });
        }
      }
      loopMessages.push({ role: "user", content: toolResults });

      if (i === 3) finalText = textBlocks || "Klarte ikke fullføre forespørselen innen forsøksgrensen.";
    }

    return { statusCode: 200, body: JSON.stringify({ reply: finalText, posts: ctx.lastPostsResult }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
