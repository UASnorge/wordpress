const API = "/api";

const state = {
  token: localStorage.getItem("uas_token") || null,
  articles: [],
  imageFiles: new Map(), // filename (lowercase) -> File
  categories: [],
  tags: [],
  poster: { file: null, link: "" },
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
}

function findImageFile(filename) {
  if (!filename) return null;
  return state.imageFiles.get(filename.trim().toLowerCase()) || null;
}

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

el("submitBatchBtn").addEventListener("click", async () => {
  const btn = el("submitBatchBtn");
  btn.disabled = true;

  el("resultsSection").hidden = false;
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
