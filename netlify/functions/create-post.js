const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { resolveTagIds, createPost } = require("./lib/wp");
const { bodyTextToHtml } = require("./lib/parseArticles");

// ACF-feltnøkler for "Innlegg"-feltgruppen på uasnorway.no (funnet via DevTools
// i wp-admin, bekreftet 18.08.2026). Åpnet for REST-skriving via mu-pluginen
// "uas-batch-rest-fields" i wp-content/mu-plugins/ på selve WP-installasjonen.
// Disse feltene styrer den faktiske visningen på nettsiden - IKKE WPs native
// content/excerpt/featured_media, som fortsatt settes i tillegg (se under) for
// Yoast SEO-fallback og andre systemer som leser standardfeltene.
const ACF_FIELD_KEYS = {
  image: "field_58ac635e3fd79", // Bilde
  imageTxt: "field_58ad5800ad8f8", // Bildetekst
  photoCredits: "field_58ad5816549da", // Foto
  byline: "field_58ad63e185d2a", // Byline
  excerpt: "field_58aca286266be", // Ingress
  content: "field_58aca298266bf", // Innhold
};

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
    const { title, ingress, body, categoryIds = [], tagNames = [], featuredMediaId, status, poster, byline, caption, photoCredit } = data;

    if (!title || !body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mangler tittel eller hovedtekst." }) };
    }

    const tagIds = await resolveTagIds(tagNames);
    const contentHtml = bodyTextToHtml(body) + posterBlockHtml(poster);

    const meta = {
      // Yoast bruker disse som fallback for sosial tittel/beskrivelse/bilde
      // (sammen med featured_media) - bekreftet ved test mot uasnorway.no.
      "_yoast_wpseo_title": title,
      "_yoast_wpseo_metadesc": ingress || "",

      // ACF-felt som faktisk styrer den redaksjonelle visningen på nettsiden.
      content: contentHtml,
      _content: ACF_FIELD_KEYS.content,
      excerpt: ingress || "",
      _excerpt: ACF_FIELD_KEYS.excerpt,
    };

    if (byline) {
      meta.byline = byline;
      meta._byline = ACF_FIELD_KEYS.byline;
    }
    if (caption) {
      meta.imageTxt = caption;
      meta._imageTxt = ACF_FIELD_KEYS.imageTxt;
    }
    if (photoCredit) {
      meta.photoCredits = photoCredit;
      meta._photoCredits = ACF_FIELD_KEYS.photoCredits;
    }
    if (featuredMediaId) {
      meta.image = String(featuredMediaId);
      meta._image = ACF_FIELD_KEYS.image;
    }

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
