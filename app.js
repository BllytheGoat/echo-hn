// ECHO — Hacker News reader that reads the room
const API = "https://hacker-news.firebaseio.com/v0";
const $ = (s) => document.querySelector(s);
const feedList = $("#feed-list");
const commentsEl = $("#comments");
const state = { feed: "top", sort: "score", selected: null, items: {} };

const FEEDS = {
  top: "topstories", new: "newstories",
  ask: "askstories", show: "showstories", job: "jobstories"
};

function timeAgo(t) {
  const s = Math.floor(Date.now() / 1000 - t);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

// velocity = comments-per-minute since post (descendants / minutes old, capped)
function velocity(item) {
  const ageMin = Math.max(1, (Date.now() / 1000 - item.time) / 60);
  const d = item.descendants || 0;
  return d / ageMin; // comments per minute
}

function veloPct(v) {
  // map 0..4 c/m to 0..100%
  return Math.min(100, (v / 4) * 100);
}

async function getJSON(u) {
  const r = await fetch(u);
  return r.ok ? r.json() : null;
}

async function loadFeed() {
  $("#pulse-label").textContent = "fetching " + state.feed + "…";
  const ids = await getJSON(`${API}/${FEEDS[state.feed]}.json`);
  if (!ids) { feedList.innerHTML = '<div class="loading">HN unreachable. Retry?</div>'; return; }
  const slice = ids.slice(0, 30);
  const items = await Promise.all(slice.map((id) => getJSON(`${API}/item/${id}.json`)));
  const valid = items.filter(Boolean);
  state.items = {};
  valid.forEach((it) => (state.items[it.id] = it));

  if (state.sort === "velocity") {
    valid.sort((a, b) => velocity(b) - velocity(a));
  } else {
    valid.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  renderFeed(valid);
  $("#pulse-label").textContent = `${valid.length} live · HN connected`;
}

function renderFeed(items) {
  feedList.innerHTML = "";
  items.forEach((it, i) => {
    const v = velocity(it);
    const el = document.createElement("div");
    el.className = "fitem" + (state.selected === it.id ? " active" : "");
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="fitem-top">
        <span class="frank">${i + 1}</span>
        <span class="ftitle">${escapeHtml(it.title || "[untitled]")}</span>
      </div>
      <div class="fmeta">
        <span class="score">▲ ${it.score || 0}</span>
        <span>${it.descendants || 0} comments</span>
        <span>${timeAgo(it.time)}</span>
      </div>
      <div class="fvelo">
        <div class="fvelo-bar"><i style="width:${veloPct(v)}%"></i></div>
        <span class="fvelo-num">${v.toFixed(1)}/min</span>
      </div>`;
    el.addEventListener("click", () => selectStory(it.id));
    feedList.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function selectStory(id) {
  state.selected = id;
  document.querySelectorAll(".fitem").forEach((e) =>
    e.classList.toggle("active", e.dataset.id == id));
  const it = state.items[id];
  $("#reader-empty").hidden = true;
  const story = $("#story");
  story.hidden = false;
  $("#s-rank").textContent = "#" + (Object.values(state.items).indexOf(it) + 1);
  $("#s-score").textContent = "▲ " + (it.score || 0);
  $("#s-by").textContent = "by " + (it.by || "?");
  $("#s-age").textContent = timeAgo(it.time) + " ago";
  $("#s-title").textContent = it.title || "[untitled]";
  const url = it.url || `https://news.ycombinator.com/item?id=${id}`;
  $("#s-url").textContent = url;
  $("#s-url").href = url;
  const v = velocity(it);
  $("#s-velo").style.width = veloPct(v) + "%";
  $("#s-velo-num").textContent = v.toFixed(1) + " comments/min";
  commentsEl.innerHTML = '<div class="loading">loading the conversation…</div>';
  loadComments(it.kids || [], 0);
}

async function loadComments(kids, depth) {
  if (!kids.length) {
    if (!commentsEl.children.length) commentsEl.innerHTML = '<div class="loading">no comments yet</div>';
    return;
  }
  const batch = kids.slice(0, depth === 0 ? 12 : 6);
  const items = await Promise.all(batch.map((k) => getJSON(`${API}/item/${k}.json`)));
  const rest = kids.slice(batch.length);
  for (const c of items.filter(Boolean)) {
    const el = document.createElement("div");
    el.className = "cm";
    const kidsCount = (c.kids || []).length;
    el.innerHTML = `
      <div class="cm-head">
        <span class="cm-toggle">[–]</span>
        <span class="cm-by">${escapeHtml(c.by || "anon")}</span>
        <span>${timeAgo(c.time)}</span>
        ${kidsCount ? `<span>· ${kidsCount} replies</span>` : ""}
      </div>
      <div class="cm-text">${c.text || "<i>comment deleted</i>"}</div>
      <div class="cm-kids"></div>`;
    const toggle = el.querySelector(".cm-toggle");
    const kidsBox = el.querySelector(".cm-kids");
    toggle.addEventListener("click", () => {
      el.classList.toggle("collapsed");
      toggle.textContent = el.classList.contains("collapsed") ? "[+]" : "[–]";
      if (!el.classList.contains("collapsed") && !kidsBox.dataset.loaded) {
        kidsBox.dataset.loaded = "1";
        loadCommentsInto(kidsBox, c.kids || []);
      }
    });
    commentsEl.appendChild(el);
  }
  if (rest.length && depth === 0) {
    const more = document.createElement("div");
    more.className = "loading";
    more.textContent = "load more comments…";
    more.style.cursor = "pointer";
    more.addEventListener("click", () => { more.remove(); loadComments(rest, 1); });
    commentsEl.appendChild(more);
  }
}

async function loadCommentsInto(box, kids) {
  if (!kids.length) return;
  const items = await Promise.all(kids.slice(0, 6).map((k) => getJSON(`${API}/item/${k}.json`)));
  for (const c of items.filter(Boolean)) {
    const el = document.createElement("div");
    el.className = "cm";
    el.innerHTML = `
      <div class="cm-head"><span class="cm-by">${escapeHtml(c.by || "anon")}</span><span>${timeAgo(c.time)}</span></div>
      <div class="cm-text">${c.text || "<i>deleted</i>"}</div>`;
    box.appendChild(el);
  }
}

// tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    if (t.dataset.sort) {
      state.sort = state.sort === "velocity" ? "score" : "velocity";
      t.classList.toggle("active", state.sort === "velocity");
    } else {
      state.feed = t.dataset.feed;
      document.querySelectorAll(".tab[data-feed]").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
    }
    loadFeed();
  });
});

loadFeed();
setInterval(loadFeed, 60000); // refresh every minute
