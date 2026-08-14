const API = "/api";

const state = {
  token: localStorage.getItem("uas_token") || null,
  articles: [],
  imageFiles: new Map(), // filename (lowercase) -> File
  categories: [],
  tags: [],
  poster: { file: null, link: "" },
  lastBatchTag: localStorage.getItem("uas_last_batch_tag") || null,
  overviewPosts: [],
  selectedIds: new Set(),
  chatHistory: [],
};

// ---------- helpers ----------

function el(id) { return document.getElementById(id); }

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Økten er utløpt. Logg inn på nytt.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Feil (${res.status})`);
  return data;
}

function logout() {
  state.token = null;
  localStorage.removeItem("uas_token");
  el("loginView").hidden = false;
  el("mainView").hidden = true;
  el("logoutBtn").hidden = true;
  el("chatToggleBtn").hidden = true;
  el("chatWidget").hidden = true;
}

function findImageFile(filename) {
  if (!filename) return null;
  return state.imageFiles.get(filename.trim().toLowerCase()) || null;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- tabs ----------

document.querySelectorAll(".tabBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tabPanel").forEach((p) => (p.hidden = true));
    btn.classList.add("active");
    const panel = el(btn.dataset.tab);
    panel.hidden = false;
    if (btn.dataset.tab === "overviewTab") loadOverview();
  });
});

// ---------- login ----------

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("loginError").hidden = true;
  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: el("password").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Innlogging feilet");
    state.token = data.token;
    localStorage.setItem("uas_token", data.token);
    el("loginView").hidden = true;
    el("mainView").hidden = false;
    el("logoutBtn").hidden = false;
    el("chatToggleBtn").hidden = false;
    loadTaxonomies();
  } catch (err) {
    el("loginError").textContent = err.message;
    el("loginError").hidden = false;
  }
});

el("logoutBtn").addEventListener("click", logout);

if (state.token) {
  el("loginView").hidden = true;
  el("mainView").hidden = false;
  el("logoutBtn").hidden = false;
  el("chatToggleBtn").hidden = false;
  loadTaxonomies();
}

// ---------- taxonomies ----------

async function loadTaxonomies() {
  try {
    const data = await apiFetch("/wp-taxonomies");
    state.categories = data.categories || [];
    state.tags = data.tags || [];
    const datalist = document.getElementById("tagList") || document.createElement("datalist");
    datalist.id = "tagList";
    datalist.innerHTML = state.tags.map((t) => `<option value="${t.name}">`).join("");
    document.body.appendChild(datalist);
  } catch (err) {
    console.error("Klarte ikke hente kategorier/stikkord:", err.message);
  }
}

function categoryCheckboxOptions() {
  const preferred = state.categories.filter((c) => /aktuelt|info/i.test(c.name));
  return preferred.length ? preferred : state.categories;
}

// ---------- image inputs ----------

el("imagesInput").addEventListener("change", (e) => {
  state.imageFiles.clear();
  for (const file of e.target.files) {
    state.imageFiles.set(file.name.toLowerCase(), file);
  }
});

el("posterImageInput").addEventListener("change", (e) => {
  const file = e.target.files[0] || null;
  state.poster.file = file;
  const preview = el("posterPreview");
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }
});

el("posterLinkInput").addEventListener("input", (e) => {
  state.poster.link = e.target.value.trim();
});

// ---------- parse docx ----------

el("parseBtn").addEventListener("click", async () => {
  const file = el("docxInput").files[0];
  if (!file) {
    el("parseStatus").textContent = "Velg en .docx-fil først.";
    return;
  }
  el("parseStatus").textContent = "Tolker dokument …";
  try {
    const fd = new FormData();
    fd.append("docx", file);
    const data = await apiFetch("/parse-docx", { method: "POST", body: fd });
    if (data.warning) {
      el("parseStatus").textContent = data.warning;
      return;
    }
    state.articles = data.articles.map((a) => ({
      ...a,
      include: a.parseWarnings.length === 0,
      selectedCategoryIds: [],
      tagsText: "",
      status: "venter",
    }));
    el("parseStatus").textContent = `Fant ${state.articles.length} sak(er).`;
    renderArticles();
  } catch (err) {
    el("parseStatus").textContent = `Feil: ${err.message}`;
  }
});

// ---------- render articles ----------

function renderArticles() {
  const section = el("articlesSection");
  const list = el("articlesList");
  list.innerHTML = "";
  section.hidden = state.articles.length === 0;
  el("articleCount").textContent = String(state.articles.length);

  state.articles.forEach((article, idx) => {
    const imgFile = findImageFile(article.imageFilename);
    const wrapper = document.createElement("details");
    wrapper.className = "article-card";
    wrapper.open = idx === 0;

    const warningBadges = article.parseWarnings
      .map((w) => `<span class="badge warn">${w}</span>`)
      .join("");

    wrapper.innerHTML = `
      <summary>${article.title || "(uten tittel)"} ${warningBadges}</summary>
      <label><input type="checkbox" data-role="include" ${article.include ? "checked" : ""}/> Inkluder i sending</label>

      <label>Tittel</label>
      <input type="text" data-role="title" value="${escapeAttr(article.title)}" />

      <label>Ingress</label>
      <textarea data-role="ingress">${article.ingress}</textarea>

      <label>Hovedtekst</label>
      <textarea data-role="body" style="min-height:8rem">${article.body}</textarea>

      <label>Bilde (${article.imageFilename || "ingen fil angitt"})</label>
      ${imgFile ? `<img class="preview" src="${URL.createObjectURL(imgFile)}" />` : `<span class="badge error">Bilde ikke funnet blant opplastede filer</span>`}

      <label>Alt-tekst på bilde</label>
      <input type="text" data-role="altText" value="${escapeAttr(article.altText)}" />

      <label>Kategori</label>
      <div class="checkbox-row" data-role="categories">
        ${categoryCheckboxOptions()
          .map(
            (c) =>
              `<label><input type="checkbox" value="${c.id}" /> ${c.name}</label>`
          )
          .join("")}
      </div>

      <label>Stikkord (kommaseparert)</label>
      <input type="text" data-role="tags" list="tagList" placeholder="f.eks. droner, regelverk" />

      <button data-role="analyze" type="button">Analyser med AI</button>
      <div data-role="analysis"></div>

      <p data-role="rowStatus" class="hint">Status: venter</p>
    `;

    // wire up fields to state
    wrapper.querySelector('[data-role="include"]').addEventListener("change", (e) => {
      article.include = e.target.checked;
    });
    wrapper.querySelector('[data-role="title"]').addEventListener("input", (e) => {
      article.title = e.target.value;
    });
    wrapper.querySelector('[data-role="ingress"]').addEventListener("input", (e) => {
      article.ingress = e.target.value;
    });
    wrapper.querySelector('[data-role="body"]').addEventListener("input", (e) => {
      article.body = e.target.value;
    });
    wrapper.querySelector('[data-role="altText"]').addEventListener("input", (e) => {
      article.altText = e.target.value;
    });
    wrapper.querySelector('[data-role="tags"]').addEventListener("input", (e) => {
      article.tagsText = e.target.value;
    });
    wrapper.querySelectorAll('[data-role="categories"] input').forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = [...wrapper.querySelectorAll('[data-role="categories"] input:checked')].map((c) => Number(c.value));
        article.selectedCategoryIds = checked;
      });
    });

    wrapper.querySelector('[data-role="analyze"]').addEventListener("click", async (e) => {
      const btn = e.target;
      const out = wrapper.querySelector('[data-role="analysis"]');
      btn.disabled = true;
      out.innerHTML = `<p class="hint">Analyserer …</p>`;
      try {
        const fd = new FormData();
        fd.append("title", article.title);
        fd.append("ingress", article.ingress);
        fd.append("body", article.body);
        const currentImg = findImageFile(article.imageFilename);
        if (currentImg) fd.append("image", currentImg);
        const result = await apiFetch("/analyze-article", { method: "POST", body: fd });
        const matchBadgeClass = result.imageMatch === "god" ? "ok" : result.imageMatch === "dårlig" ? "error" : "warn";
        out.innerHTML = `
          <p><span class="badge ${matchBadgeClass}">Bilde: ${result.imageMatch || "ikke vurdert"}</span></p>
          ${(result.warnings || []).map((w) => `<span class="badge warn">${w}</span>`).join("")}
          <p class="hint">${result.comment || ""}</p>
        `;
      } catch (err) {
        out.innerHTML = `<p class="error">Analyse feilet: ${err.message}</p>`;
      } finally {
        btn.disabled = false;
      }
    });

    list.appendChild(wrapper);
    article._rowEl = wrapper;
  });
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}

// ---------- submit batch ----------

function makeBatchTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `batch-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

el("submitBatchBtn").addEventListener("click", async () => {
  const btn = el("submitBatchBtn");
  btn.disabled = true;

  const batchTag = makeBatchTag();
  state.lastBatchTag = batchTag;
  localStorage.setItem("uas_last_batch_tag", batchTag);

  el("resultsSection").hidden = false;
  el("batchTagHint").textContent = `Alle saker i denne sendingen merkes med stikkordet "${batchTag}" - bruk "Vis kun siste opplasting" i Oversikt-fanen for å finne dem raskt igjen.`;
  const tbody = document.querySelector("#resultsTable tbody");
  tbody.innerHTML = "";

  let posterData = null;
  if (state.poster.file) {
    try {
      const fd = new FormData();
      fd.append("image", state.poster.file);
      fd.append("altText", "Konferanseplakat");
      const uploaded = await apiFetch("/upload-image", { method: "POST", body: fd });
      posterData = { imageUrl: uploaded.url, link: state.poster.link, altText: "Konferanseplakat" };
    } catch (err) {
      alert(`Klarte ikke laste opp konferanseplakat: ${err.message}. Fortsetter uten plakat.`);
    }
  }

  for (const article of state.articles) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${article.title || "(uten tittel)"}</td><td data-role="status">…</td><td data-role="link"></td>`;
    tbody.appendChild(row);

    if (!article.include) {
      row.querySelector('[data-role="status"]').textContent = "Hoppet over";
      continue;
    }

    try {
      let featuredMediaId, featuredMediaUrl;
      const imgFile = findImageFile(article.imageFilename);
      if (imgFile) {
        const fd = new FormData();
        fd.append("image", imgFile);
        fd.append("altText", article.altText || "");
        const uploaded = await apiFetch("/upload-image", { method: "POST", body: fd });
        featuredMediaId = uploaded.id;
        featuredMediaUrl = uploaded.url;
      }

      const tagNames = (article.tagsText || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      tagNames.push(batchTag);

      const result = await apiFetch("/create-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: article.title,
          ingress: article.ingress,
          body: article.body,
          categoryIds: article.selectedCategoryIds,
          tagNames,
          featuredMediaId,
          featuredMediaUrl,
          status: "draft",
          poster: posterData,
        }),
      });

      row.querySelector('[data-role="status"]').innerHTML = `<span class="badge ok">Opprettet</span>`;
      row.querySelector('[data-role="link"]').innerHTML = `<a href="${result.editLink}" target="_blank">Åpne utkast</a>`;
    } catch (err) {
      row.querySelector('[data-role="status"]').innerHTML = `<span class="badge error">Feilet</span>`;
      row.querySelector('[data-role="link"]').textContent = err.message;
    }
  }

  btn.disabled = false;
});

// ---------- oversikt ----------

async function loadOverview() {
  const statusEl = el("overviewStatus");
  statusEl.textContent = "Laster …";
  statusEl.hidden = false;
  state.selectedIds.clear();
  updateBulkBar();

  const status = el("filterStatus").value;
  const search = el("filterSearch").value.trim();
  const params = new URLSearchParams({ status });
  if (search) params.set("search", search);

  const useLastBatch = el("filterLastBatch").checked;
  if (useLastBatch) {
    if (!state.lastBatchTag) {
      statusEl.textContent = "Ingen batch er lastet opp i denne nettleseren ennå.";
      state.overviewPosts = [];
      renderOverviewTable();
      return;
    }
    params.set("tag", state.lastBatchTag);
  }

  try {
    // For batch-tag-filter må vi slå opp tag-id via taxonomies, enklest er å be serveren
    // filtrere på navn - men list-posts tar imot tag-id. Vi henter derfor tags og finner id.
    if (useLastBatch) {
      const tagMatch = state.tags.find((t) => t.name.toLowerCase() === state.lastBatchTag.toLowerCase());
      if (tagMatch) {
        params.set("tag", String(tagMatch.id));
      } else {
        // tag finnes kanskje ikke i cachen ennå (opprettet nå nylig) - hent på nytt
        const fresh = await apiFetch(`/wp-taxonomies`);
        state.tags = fresh.tags || [];
        const freshMatch = state.tags.find((t) => t.name.toLowerCase() === state.lastBatchTag.toLowerCase());
        if (freshMatch) params.set("tag", String(freshMatch.id));
        else params.delete("tag");
      }
    }

    const data = await apiFetch(`/list-posts?${params.toString()}`);
    state.overviewPosts = data.posts || [];
    statusEl.hidden = true;
    renderOverviewTable();
  } catch (err) {
    statusEl.textContent = `Feil: ${err.message}`;
  }
}

function renderOverviewTable() {
  const tbody = el("overviewTbody");
  tbody.innerHTML = "";
  state.overviewPosts.forEach((post) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${post.id}" /></td>
      <td>${post.thumbnail ? `<img class="thumb" src="${post.thumbnail}" />` : `<span class="thumb-placeholder"></span>`}</td>
      <td><a href="${post.editLink}" target="_blank">${escapeHtml(post.title)}</a></td>
      <td><span class="badge ${post.status === "publish" ? "ok" : "warn"}">${post.status === "publish" ? "Publisert" : "Utkast"}</span></td>
      <td>${post.categories.map(escapeHtml).join(", ") || "<span class=\"badge error\">Mangler</span>"}</td>
      <td>${post.tags.filter((t) => !/^batch-\d{8}-\d{4}$/.test(t)).map(escapeHtml).join(", ")}</td>
      <td>${new Date(post.date).toLocaleDateString("no-NO")}</td>
      <td>
        <a href="${post.link}" target="_blank">Åpne</a> ·
        <a href="${post.editLink}" target="_blank">Rediger</a>
      </td>
    `;
    tr.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      if (e.target.checked) state.selectedIds.add(post.id);
      else state.selectedIds.delete(post.id);
      updateBulkBar();
    });
    tbody.appendChild(tr);
  });
}

function updateBulkBar() {
  const bar = el("bulkActionsBar");
  const count = state.selectedIds.size;
  bar.hidden = count === 0;
  el("selectedCount").textContent = `${count} valgt`;
  el("selectAllCheckbox").checked = count > 0 && count === state.overviewPosts.length;
}

el("selectAllCheckbox").addEventListener("change", (e) => {
  state.selectedIds.clear();
  if (e.target.checked) state.overviewPosts.forEach((p) => state.selectedIds.add(p.id));
  document.querySelectorAll("#overviewTbody input[type=checkbox]").forEach((cb) => {
    cb.checked = e.target.checked;
  });
  updateBulkBar();
});

el("refreshOverviewBtn").addEventListener("click", loadOverview);
el("filterStatus").addEventListener("change", loadOverview);
el("filterLastBatch").addEventListener("change", loadOverview);
el("filterSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadOverview();
});

async function runBulkAction(action, extra = {}) {
  const ids = [...state.selectedIds];
  if (ids.length === 0) return;

  const confirmations = {
    publish: `Publisere ${ids.length} sak(er) live på nettstedet?`,
    trash: `Slette (flytte til papirkurv) ${ids.length} sak(er)? Dette kan angres i WP-admin sin papirkurv.`,
  };
  if (confirmations[action] && !confirm(confirmations[action])) return;

  try {
    const data = await apiFetch("/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, ...extra }),
    });
    const failed = data.results.filter((r) => !r.ok);
    if (failed.length) {
      alert(`${failed.length} av ${ids.length} feilet:\n` + failed.map((f) => `#${f.id}: ${f.error}`).join("\n"));
    }
    await loadOverview();
  } catch (err) {
    alert(`Feil: ${err.message}`);
  }
}

el("bulkPublishBtn").addEventListener("click", () => runBulkAction("publish"));
el("bulkDraftBtn").addEventListener("click", () => runBulkAction("draft"));
el("bulkTrashBtn").addEventListener("click", () => runBulkAction("trash"));

el("bulkAddTagsBtn").addEventListener("click", () => {
  const tagNames = (el("bulkTagsInput").value || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!tagNames.length) return alert("Skriv inn minst ett stikkord.");
  runBulkAction("add_tags", { tagNames });
});

el("bulkReplaceTagsBtn").addEventListener("click", () => {
  const tagNames = (el("bulkTagsInput").value || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!confirm(`Dette ERSTATTER alle eksisterende stikkord på ${state.selectedIds.size} sak(er). Fortsette?`)) return;
  runBulkAction("replace_tags", { tagNames });
});

el("copyLinksBtn").addEventListener("click", async () => {
  const ids = new Set(state.selectedIds);
  const posts = state.overviewPosts.filter((p) => ids.has(p.id));
  const text = posts.map((p) => `${p.title}: ${p.link}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    alert(`${posts.length} lenke(r) kopiert til utklippstavlen.`);
  } catch {
    prompt("Kopier lenkene manuelt:", text);
  }
});

// ---------- AI-assistent (flytende chat-widget) ----------

el("chatToggleBtn").addEventListener("click", () => {
  el("chatWidget").hidden = false;
  el("chatToggleBtn").hidden = true;
  el("chatInput").focus();
  if (el("chatLog").innerHTML === "") {
    el("chatLog").innerHTML =
      '<div class="chat-msg assistant"><div class="bubble">Hei! Spør meg om saker, lenker eller status - f.eks. «gi meg lenkene til sakene fra siste batch».</div></div>';
  }
});

el("chatCloseBtn").addEventListener("click", () => {
  el("chatWidget").hidden = true;
  el("chatToggleBtn").hidden = false;
});

function renderChat() {
  const log = el("chatLog");
  log.innerHTML = state.chatHistory
    .map(
      (m) =>
        `<div class="chat-msg ${m.role}"><div class="bubble">${escapeHtml(m.content)}</div></div>`
    )
    .join("");
  log.scrollTop = log.scrollHeight;
}

async function sendChatMessage() {
  const input = el("chatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  state.chatHistory.push({ role: "user", content: text });
  renderChat();

  const thinkingMsg = { role: "assistant", content: "…" };
  state.chatHistory.push(thinkingMsg);
  renderChat();

  try {
    const data = await apiFetch("/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.chatHistory.slice(0, -1) }),
    });
    thinkingMsg.content = data.reply || "(tomt svar)";
  } catch (err) {
    thinkingMsg.content = `Feil: ${err.message}`;
  }
  renderChat();
}

el("chatSendBtn").addEventListener("click", sendChatMessage);
el("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
