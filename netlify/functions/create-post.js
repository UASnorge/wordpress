const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { resolveTagIds, createPost } = require("./lib/wp");
const { bodyTextToHtml } = require("./lib/parseArticles");

function posterBlockHtml(poster) {
  if (!poster || !poster.imageUrl) return "";
  const linkOpen = poster.link ? `<a href="${poster.link}" target="_blank" rel="noopener">` : "";
  const linkClose = poster.link ? "</a>" : "";
  return `\n<p>${linkOpen}<img src="${poster.imageUrl}" alt="${(poster.altText || "Konferanseplakat").replace(/"/g, "")}" />${linkClose}</p>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    const data = JSON.parse(event.body || "{}");
    const { title, ingress, body, categoryIds = [], tagNames = [], featuredMediaId, status, poster } = data;

    if (!title || !body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mangler tittel eller hovedtekst." }) };
    }

    const tagIds = await resolveTagIds(tagNames);
    const contentHtml = bodyTextToHtml(body) + posterBlockHtml(poster);

    // Yoast fyller selv sosial tittel/beskrivelse/bilde ut fra disse to feltene
    // og hovedbildet (featured_media) - bekreftet ved test mot uasnorway.no.
    // De direkte opengraph-*-meta-feltene er ikke skrivbare via REST API uten
    // en egen mu-plugin, og trengs ikke her siden fallback allerede gir riktig resultat.
    const meta = {
      "_yoast_wpseo_title": title,
      "_yoast_wpseo_metadesc": ingress || "",
    };

    const post = await createPost({
      title,
      contentHtml,
      excerpt: ingress || "",
      status: status || "draft",
      categoryIds,
      tagIds,
      featuredMediaId,
      meta,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: post.id, editLink: `${(process.env.WP_URL || "").replace(/\/+$/, "")}/wp-admin/post.php?post=${post.id}&action=edit` }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message, wpData: err.data }) };
  }
};
