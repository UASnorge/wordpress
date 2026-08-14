const { isAuthorized, unauthorizedResponse } = require("./lib/auth");
const { getCategories, getTags, getUsers } = require("./lib/wp");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!isAuthorized(event)) return unauthorizedResponse();

  try {
    const [categories, tags, users] = await Promise.all([getCategories(), getTags(), getUsers()]);
    return { statusCode: 200, body: JSON.stringify({ categories, tags, users }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
