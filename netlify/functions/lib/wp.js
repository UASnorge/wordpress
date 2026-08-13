// Enkel klient mot WordPress REST API med Application Password (Basic Auth).

function wpBaseUrl() {
  const raw = process.env.WP_URL || "";
  return raw.replace(/\/+$/, "");
}

function authHeader() {
  const user = process.env.WP_USERNAME;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("WP_USERNAME / WP_APP_PASSWORD er ikke satt som miljøvariabler.");
  }
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

async function wpFetch(path, options = {}) {
  const url = `${wpBaseUrl()}/wp-json${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.message) || `WP-feil ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getCategories() {
  return wpFetch("/wp/v2/categories?per_page=100&_fields=id,name,slug");
}

async function getTags(search) {
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  return wpFetch(`/wp/v2/tags?per_page=100${q}&_fields=id,name,slug`);
}

async function findOrCreateTag(name) {
  const clean = name.trim();
  if (!clean) return null;
  const found = await getTags(clean);
  const exact = found.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (exact) return exact.id;
  const created = await wpFetch("/wp/v2/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: clean }),
  });
  return created.id;
}

async function resolveTagIds(names) {
  const ids = [];
  for (const name of names) {
    const id = await findOrCreateTag(name);
    if (id) ids.push(id);
  }
  return ids;
}

async function uploadMedia({ buffer, filename, mimeType, altText }) {
  const media = await wpFetch("/wp/v2/media", {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
    body: buffer,
  });
  if (altText) {
    await wpFetch(`/wp/v2/media/${media.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: altText }),
    });
  }
  return { id: media.id, url: media.source_url };
}

async function createPost({ title, contentHtml, excerpt, status, categoryIds, tagIds, featuredMediaId, meta }) {
  return wpFetch("/wp/v2/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: contentHtml,
      excerpt,
      status: status || "draft",
      categories: categoryIds || [],
      tags: tagIds || [],
      featured_media: featuredMediaId || undefined,
      meta: meta || {},
    }),
  });
}

module.exports = {
  getCategories,
  getTags,
  resolveTagIds,
  uploadMedia,
  createPost,
};
