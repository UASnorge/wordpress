const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const {
  resolveTagIds,
  getPostTagIds,
  getPostCategoryIds,
  updatePostStatus,
  updatePostTags,
  updatePostCategories,
  trashPost,
} = require("./lib/wp");

const VALID_ACTIONS = [
  "publish",
  "draft",
  "trash",
  "add_tags",
  "replace_tags",
  "add_categories",
  "replace_categories",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Ugyldig forespørsel." }) };
  }

  const { ids = [], action, tagNames = [], categoryIds = [] } = data;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ingen saker valgt." }) };
  }
  if (!VALID_ACTIONS.includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ukjent handling." }) };
  }

  let newTagIds = [];
  if (action === "add_tags" || action === "replace_tags") {
    newTagIds = await resolveTagIds(tagNames);
  }

  const results = [];
  for (const id of ids) {
    try {
      if (action === "publish") await updatePostStatus(id, "publish");
      else if (action === "draft") await updatePostStatus(id, "draft");
      else if (action === "trash") await trashPost(id);
      else if (action === "replace_tags") await updatePostTags(id, newTagIds);
      else if (action === "add_tags") {
        const existing = await getPostTagIds(id);
        const merged = [...new Set([...existing, ...newTagIds])];
        await updatePostTags(id, merged);
      } else if (action === "replace_categories") {
        await updatePostCategories(id, categoryIds.map(Number));
      } else if (action === "add_categories") {
        const existing = await getPostCategoryIds(id);
        const merged = [...new Set([...existing, ...categoryIds.map(Number)])];
        await updatePostCategories(id, merged);
      }
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ results }) };
};
