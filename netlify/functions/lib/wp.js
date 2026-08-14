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

async function listPosts({ status = "draft,publish", search = "", category, tag, page = 1, perPage = 40 } = {}) {
  const params = new URLSearchParams({
    status,
    per_page: String(perPage),
    page: String(page),
    _embed: "wp:featuredmedia,wp:term",
    orderby: "date",
    order: "desc",
  });
  if (search) params.set("search", search);
  if (category) params.set("categories", String(category));
  if (tag) params.set("tags", String(tag));

  const url = `/wp/v2/posts?${params.toString()}`;
  const res = await fetch(`${wpBaseUrl()}/wp-json${url}`, { headers: { Authorization: authHeader() } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  if (!res.ok) {
    const err = new Error((data && data.message) || `WP-feil ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const totalPages = Number(res.headers.get("x-wp-totalpages") || 1);
  const total = Number(res.headers.get("x-wp-total") || data.length);

  const posts = data.map((p) => {
    const embedded = p._embedded || {};
    const media = (embedded["wp:featuredmedia"] || [])[0];
    const terms = embedded["wp:term"] || [];
    const categories = (terms[0] || []).map((t) => t.name);
    const tags = (terms[1] || []).map((t) => t.name);
    return {
      id: p.id,
      title: p.title?.rendered || "(uten tittel)",
      status: p.status,
      date: p.date,
      link: p.link,
      editLink: `${wpBaseUrl()}/wp-admin/post.php?post=${p.id}&action=edit`,
      excerpt: (p.excerpt?.rendered || "").replace(/<[^>]+>/g, "").trim(),
      categories,
      tags,
      thumbnail: media ? media.source_url : null,
    };
  });

  return { posts, totalPages, total };
}

async function getPostTagIds(postId) {
  const post = await wpFetch(`/wp/v2/posts/${postId}?_fields=tags`);
  return post.tags || [];
}

async function updatePostStatus(postId, status) {
  return wpFetch(`/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

async function updatePostTags(postId, tagIds) {
  return wpFetch(`/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: tagIds }),
  });
}

async function trashPost(postId) {
  return wpFetch(`/wp/v2/posts/${postId}`, { method: "DELETE" });
}

module.exports = {
  getCategories,
  getTags,
  resolveTagIds,
  uploadMedia,
  createPost,
  listPosts,
  getPostTagIds,
  updatePostStatus,
  updatePostTags,
  trashPost,
};
