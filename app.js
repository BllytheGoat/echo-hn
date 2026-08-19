// ECHO — Hacker News reader that reads the room
// Phase A+B: beginner UX, hot-right-now, AI debate summary, saved rooms (all client-side)
const API = "https://hacker-news.firebaseio.com/v0";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = (window.ECHO_CONFIG && window.ECHO_CONFIG.groqKey) || "";
const $ = (s) => document.querySelector(s);
const feedList = $("#feed-list");
const commentsEl = $("#comments");
const state = { feed: "top", sort: "hot", selected: null, items: {}, prevDesc: {} };

const FEEDS = { top: "topstories", new: "newstories", ask: "askstories", show: "showstories", job: "jobstories" };

function timeAgo(t) {
  const s = Math.floor(Date.now() / 1000 - t);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
function velocity(it) {
  const ageMin = Math.max(1, (Date.now() / 1000 - it.time) / 60);
  return (it.descendants || 0) / ageMin;
}
// delta velocity: how many new comments in the last poll vs stored
function deltaHot(it) {
  const prev = state.prevDesc[it.id];
  if (prev === undefined) return 0;
  return (it.descendants || 0) - prev;
}
function veloPct(v) { return Math.min(100, (v / 4) * 100); }

async function getJSON(u) {
  const r = await fetch(u);
  return r.ok ? r.json() : null;
}

async function loadFeed() {
  const ids = await getJSON(`${API}/${FEEDS[state.feed]}.json`);
  if (!ids) { feedList.innerHTML = '<div class="loading">HN unreachable. Retry?</div>'; return; }
  const slice = ids.slice(0, 30);
  const items = (await Promise.all(slice.map((id) => getJSON(`${API}/item/${id}.json`)))).filter(Boolean);
  // store descendants for delta calc
  items.forEach((it) => {
    if (state.prevDesc[it.id] === undefined) state.prevDesc[it.id] = it.descendants || 0;
  });
  state.items = {};
  items.forEach((it) => (state.items[it.id] = it));

  if (state.sort === "hot") {
    items.sort((a, b) => deltaHot(b) - deltaHot(a));
  } else if (state.sort === "velocity") {
    items.sort((a, b) => velocity(b) - velocity(a));
  } else {
    items.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  renderFeed(items);
}

function renderFeed(items) {
  feedList.innerHTML = "";
  items.forEach((it, i) => {
    const v = velocity(it);
    const d = deltaHot(it);
    const hot = d >= 3; // gained 3+ comments since last poll
    const el = document.createElement("div");
    el.className = "fitem" + (state.selected === it.id ? " active" : "");
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="fitem-top">
        <span class="frank">${i + 1}</span>
        <span class="ftitle">${esc(it.title || "[untitled]")}</span>
        ${hot ? '<span class="hot-badge">🔥</span>' : ""}
      </div>
      <div class="fmeta">
        <span class="score">▲ ${it.score || 0}</span>
        <span>${it.descendants || 0} replies</span>
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

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function selectStory(id) {
  state.selected = id;
  document.querySelectorAll(".fitem").forEach((e) => e.classList.toggle("active", e.dataset.id == id));
  const it = state.items[id];
  $("#reader-empty").hidden = true;
  const story = $("#story");
  story.hidden = false;
  // save button state
  const saved = isSaved(id);
  const sb = $("#save-btn");
  sb.textContent = saved ? "★ Saved" : "☆ Save";
  sb.classList.toggle("saved", saved);
  sb.onclick = () => toggleSave(id, it.title);
  $("#s-score").textContent = "▲ " + (it.score || 0);
  $("#s-by").textContent = "by " + (it.by || "?");
  $("#s-age").textContent = timeAgo(it.time) + " ago";
  const d = deltaHot(it);
  $("#s-hot").hidden = !(d >= 3);
  $("#s-title").textContent = it.title || "[untitled]";
  const url = it.url || `https://news.ycombinator.com/item?id=${id}`;
  $("#s-url").textContent = url;
  $("#s-url").href = url;
  const v = velocity(it);
  $("#s-velo").style.width = veloPct(v) + "%";
  $("#s-velo-num").textContent = v.toFixed(1) + " replies/min";
  // reset summary
  $("#summary-box").hidden = true; $("#summary-box").textContent = "";
  commentsEl.innerHTML = '<div class="loading">loading the conversation…</div>';
  loadComments(it.kids || [], 0);
}

// ---- AI debate summary (Groq) ----
$("#summary-btn").addEventListener("click", async () => {
  const box = $("#summary-box");
  const btn = $("#summary-btn");
  const it = state.items[state.selected];
  if (!it) return;
  box.hidden = false;
  box.className = "summary-box loading";
  box.textContent = "Reading the debate…";
  btn.disabled = true;
  const top = await loadCommentTexts(it.kids || [], 8);
  if (!top.length) {
    box.className = "summary-box error";
    box.textContent = "No comments yet to summarize.";
    btn.disabled = false;
    return;
  }
  try {
    const prompt = `These are the top comments on a Hacker News story titled "${it.title}". Summarize in 3 short bullet points what people are agreeing, disagreeing, or debating about. Plain language, no jargon, no markdown:\n\n` +
      top.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const r = await fetch(GROQ, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "groq/compound-mini", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 250 })
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || "";
    renderSummary(box, text);
  } catch (e) {
    box.className = "summary-box error";
    box.textContent = "Summary unavailable right now.";
  }
  btn.disabled = false;
});

function renderSummary(box, text) {
  // strip markdown bullet markers, split into points
  const lines = text.split("\n").map((l) => l.replace(/^[\s>*•\-]+/, "").trim()).filter(Boolean);
  box.className = "summary-box";
  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "sum-head";
  head.innerHTML = "✨ What the comments are saying";
  box.appendChild(head);
  const ul = document.createElement("ul");
  lines.slice(0, 5).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  });
  if (!lines.length) {
    box.textContent = text || "No summary available.";
  } else {
    box.appendChild(ul);
  }
}

async function loadCommentTexts(kids, n) {
  const out = [];
  for (const k of kids.slice(0, n)) {
    const c = await getJSON(`${API}/item/${k}.json`);
    if (c && c.text) {
      const txt = c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (txt) out.push(txt.slice(0, 280));
    }
  }
  return out;
}

// ---- comments ----
async function loadComments(kids, depth) {
  if (!kids.length) { if (!commentsEl.children.length) commentsEl.innerHTML = '<div class="loading">no comments yet</div>'; return; }
  const batch = kids.slice(0, depth === 0 ? 12 : 6);
  const items = await Promise.all(batch.map((k) => getJSON(`${API}/item/${k}.json`)));
  for (const c of items.filter(Boolean)) {
    const el = document.createElement("div");
    el.className = "cm";
    const kidsCount = (c.kids || []).length;
    el.innerHTML = `
      <div class="cm-head"><span class="cm-toggle">[–]</span><span class="cm-by">${esc(c.by || "anon")}</span><span>${timeAgo(c.time)}</span>${kidsCount ? `<span>· ${kidsCount} replies</span>` : ""}</div>
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
  if (depth === 0 && kids.slice(batch.length).length) {
    const more = document.createElement("div");
    more.className = "loading"; more.textContent = "load more comments…"; more.style.cursor = "pointer";
    more.addEventListener("click", () => { more.remove(); loadComments(kids.slice(batch.length), 1); });
    commentsEl.appendChild(more);
  }
}
async function loadCommentsInto(box, kids) {
  if (!kids.length) return;
  const items = await Promise.all(kids.slice(0, 6).map((k) => getJSON(`${API}/item/${k}.json`)));
  for (const c of items.filter(Boolean)) {
    const el = document.createElement("div");
    el.className = "cm";
    el.innerHTML = `<div class="cm-head"><span class="cm-by">${esc(c.by || "anon")}</span><span>${timeAgo(c.time)}</span></div><div class="cm-text">${c.text || "<i>deleted</i>"}</div>`;
    box.appendChild(el);
  }
}

// ---- saved rooms (localStorage) ----
function getStore() { return JSON.parse(localStorage.getItem("echo_store") || '{"rooms":{},"saved":{}}'); }
function setStore(s) { localStorage.setItem("echo_store", JSON.stringify(s)); }
function isSaved(id) { return !!getStore().saved[id]; }
function toggleSave(id, title) {
  const s = getStore();
  if (s.saved[id]) { delete s.saved[id]; } else { s.saved[id] = { title, ts: Date.now() }; }
  setStore(s);
  const sb = $("#save-btn");
  const on = !!s.saved[id];
  sb.textContent = on ? "★ Saved" : "☆ Save";
  sb.classList.toggle("saved", on);
  if (on) promptRoom(id, title);
}
function promptRoom(id, title) {
  const s = getStore();
  const names = Object.keys(s.rooms);
  if (!names.length) { addRoom("Saved", id, title); return; }
  const name = prompt(`Add to room:\n${names.join("\n")}\n(or type a new room name)`, names[0]);
  if (name) addRoom(name, id, title);
}
function addRoom(name, id, title) {
  const s = getStore();
  s.rooms[name] = s.rooms[name] || { items: {} };
  s.rooms[name].items[id] = { title, ts: Date.now() };
  setStore(s);
  renderRooms();
}
function renderRooms() {
  const s = getStore();
  const list = $("#rooms-list");
  list.innerHTML = "";
  const names = Object.keys(s.rooms);
  if (!names.length) { list.innerHTML = '<div class="loading">No rooms yet.</div>'; return; }
  names.forEach((n) => {
    const count = Object.keys(s.rooms[n].items).length;
    const el = document.createElement("div");
    el.className = "room-item";
    el.innerHTML = `<span>${esc(n)} · ${count}</span><button title="delete">✕</button>`;
    el.querySelector("button").onclick = () => { delete s.rooms[n]; setStore(s); renderRooms(); };
    el.onclick = (e) => { if (e.target.tagName !== "BUTTON") { /* could open room */ } };
    list.appendChild(el);
  });
}

// ---- UI wiring ----
document.querySelectorAll(".tab[data-feed]").forEach((t) => {
  t.addEventListener("click", () => {
    state.feed = t.dataset.feed;
    document.querySelectorAll(".tab[data-feed]").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    loadFeed();
  });
});
$("#sort-hot").addEventListener("click", () => {
  state.sort = state.sort === "hot" ? "score" : "hot";
  $("#sort-hot").classList.toggle("active", state.sort === "hot");
  $("#sort-hot").textContent = state.sort === "hot" ? "🔥 Hot right now" : "📊 By score";
  loadFeed();
});
$("#rooms-btn").addEventListener("click", () => {
  renderRooms();
  $("#rooms-panel").hidden = false;
});
$("#rooms-close").addEventListener("click", () => $("#rooms-panel").hidden = true);
$("#room-add").addEventListener("click", () => {
  const v = $("#room-name").value.trim();
  if (v) { addRoom(v); $("#room-name").value = ""; }
});
$("#help-btn").addEventListener("click", () => $("#help-modal").hidden = false);
$("#help-close").addEventListener("click", () => $("#help-modal").hidden = true);
$("#onboard-close").addEventListener("click", () => { $("#onboard").style.display = "none"; localStorage.setItem("echo_onboarded", "1"); });
if (localStorage.getItem("echo_onboarded")) $("#onboard").style.display = "none";

loadFeed();
setInterval(loadFeed, 45000);
