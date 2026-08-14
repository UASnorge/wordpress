const Anthropic = require("@anthropic-ai/sdk");
const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { listPosts, getTags } = require("./lib/wp");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Assistenten er bevisst READ-ONLY: den kan slå opp saker, men aldri publisere,
// slette eller redigere noe selv. Endringer skjer alltid via knappene i
// Oversikt-fanen, med bekreftelse fra brukeren.
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

async function runTool(name, input) {
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
    return {
      total,
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        link: p.link,
        editLink: p.editLink,
        categories: p.categories,
        tags: p.tags,
        date: p.date,
      })),
    };
  }
  throw new Error(`Ukjent verktøy: ${name}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY er ikke konfigurert på serveren." }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Ugyldig forespørsel." }) };
  }

  const history = Array.isArray(data.messages) ? data.messages : [];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = [
    "Du er AI-assistenten i 'WordPress Infosak Batch Administrator', et internt verktøy for å administrere nyhetssaker på uasnorway.no.",
    "Du kan hente informasjon om saker (tittel, status, lenker, kategori, stikkord) med list_posts-verktøyet. Bruk det aktivt - ikke gjett eller finn på lenker/titler selv.",
    "Du kan IKKE publisere, slette eller redigere saker selv. Hvis brukeren ber deg gjøre en endring, forklar kort at det må gjøres via avmerkingsboksene og knappene i Oversikt-fanen, og foreslå gjerne hvilke saker de bør velge der.",
    "Svar kort og konkret på norsk.",
  ].join(" ");

  try {
    let loopMessages = history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
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
          const result = await runTool(use.name, use.input || {});
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: `Feil: ${err.message}`, is_error: true });
        }
      }
      loopMessages.push({ role: "user", content: toolResults });

      if (i === 3) finalText = textBlocks || "Klarte ikke fullføre forespørselen innen forsøksgrensen.";
    }

    return { statusCode: 200, body: JSON.stringify({ reply: finalText }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
