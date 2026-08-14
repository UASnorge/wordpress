const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { listPosts } = require("./lib/wp");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  const qs = event.queryStringParameters || {};
  try {
    const result = await listPosts({
      status: qs.status || "draft,publish",
      search: qs.search || "",
      category: qs.category,
      tag: qs.tag,
      page: qs.page ? Number(qs.page) : 1,
      perPage: qs.perPage ? Number(qs.perPage) : 40,
    });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
