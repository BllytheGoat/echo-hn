// ECHO — Hacker News reader that reads the room
// Features: hot-right-now, AI summary, explain, sentiment, source check,
// who's talking, time-travel, keyword watch, rooms (saved views), reader mode, share card, local notes.
const API = "https://hacker-news.firebaseio.com/v0";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = (window.ECHO_CONFIG && window.ECHO_CONFIG.groqKey) || "";
const WB = "https://archive.org/wayback/available?url=";
const $ = (s) => document.querySelector(s);
const feedList = $("#feed-list");
const commentsEl = $("#comments");
const state = { feed: "top", sort: "hot", selected: null, items: {}, prevDesc: {}, history: {}, histKeys: [] };
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
function deltaHot(it) {
  const prev = state.prevDesc[it.id];
  if (prev === undefined) return 0;
  return (it.descendants || 0) - prev;
}
function veloPct(v) { return Math.min(100, (v / 4) * 100); }
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function getJSON(u) { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch { return null; } }

// ---------- feed ----------
async function loadFeed(snapshotLabel) {
  const key = snapshotLabel || "now";
  const ids = await getJSON(`${API}/${FEEDS[state.feed]}.json`);
  if (!ids) { feedList.innerHTML = '<div class="loading">HN unreachable. Retry?</div>'; return; }
  const slice = ids.slice(0, 30);
  feedList.innerHTML = "";
  slice.forEach(() => {
    const sk = document.createElement("div");
    sk.className = "fitem skeleton";
    sk.innerHTML = '<div class="sk-line" style="width:90%"></div><div class="sk-line" style="width:50%"></div><div class="sk-bar"></div>';
    feedList.appendChild(sk);
  });
  let loaded = [];
  await Promise.all(slice.map(async (id) => {
    const it = await getJSON(`${API}/item/${id}.json`);
    if (!it) return;
    if (state.prevDesc[it.id] === undefined) state.prevDesc[it.id] = it.descendants || 0;
    state.items[it.id] = it;
    loaded.push(it);
    sortItems(loaded);
    renderFeed(loaded);
  }));
  // snapshot for time-travel
  state.history[key] = loaded.map((i) => i.id);
  if (!state.histKeys.includes(key)) state.histKeys.unshift(key);
  state.histKeys = state.histKeys.slice(0, 12);
  // keyword watch check
  checkWatch(loaded);
}

function sortItems(items) {
  if (state.sort === "hot") items.sort((a, b) => deltaHot(b) - deltaHot(a));
  else if (state.sort === "velocity") items.sort((a, b) => velocity(b) - velocity(a));
  else items.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function renderFeed(items) {
  feedList.innerHTML = "";
  const watches = getWatches();
  items.forEach((it, i) => {
    const v = velocity(it);
    const d = deltaHot(it);
    const hot = d >= 3;
    const hit = watches.some((w) => (it.title || "").toLowerCase().includes(w));
    const el = document.createElement("div");
    el.className = "fitem" + (state.selected === it.id ? " active" : "") + (hit ? " watch-hit" : "");
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="fitem-top">
        <span class="frank">${i + 1}</span>
        <span class="ftitle">${esc(it.title || "[untitled]")}</span>
        ${hot ? '<span class="hot-badge">🔥</span>' : ""}
        ${hit ? '<span class="hot-badge">🔔</span>' : ""}
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

// ---------- story reader ----------
async function selectStory(id) {
  state.selected = id;
  document.querySelectorAll(".fitem").forEach((e) => e.classList.toggle("active", e.dataset.id == id));
  const it = state.items[id];
  $("#reader-empty").hidden = true;
  $("#story").hidden = false;
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
  // reset panels
  ["summary-box", "source-box", "sentiment", "voices"].forEach((x) => { if (x === "voices") { $("#voices").open = false; } else { $(("#" + x)).hidden = true; } });
  $("#summary-box").textContent = ""; $("#source-box").textContent = ""; $("#voices-list").innerHTML = "";
  commentsEl.innerHTML = '<div class="loading">loading the conversation…</div>';
  loadComments(it.kids || [], 0);
  renderMyComments(id);
}

// ---------- AI: summarize / explain ----------
async function groq(prompt, max = 250) {
  const r = await fetch(GROQ, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: "groq/compound-mini", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: max })
  });
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}
async function loadCommentTexts(kids, n) {
  const out = [];
  for (const k of kids.slice(0, n)) {
    const c = await getJSON(`${API}/item/${k}.json`);
    if (c && c.text) { const t = c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); if (t) out.push(t.slice(0, 280)); }
  }
  return out;
}
$("#summary-btn").addEventListener("click", async () => {
  const btn = $("#summary-btn"); const box = $("#summary-box"); const it = state.items[state.selected];
  if (!it) return;
  btn.disabled = true; box.hidden = false; box.className = "summary-box loading"; box.textContent = "Reading the debate…";
  const top = await loadCommentTexts(it.kids || [], 8);
  if (!top.length) { box.className = "summary-box error"; box.textContent = "No comments yet to summarize."; btn.disabled = false; return; }
  try {
    const text = await groq(`Top comments on HN story "${it.title}". Summarize in 3 short bullets what people agree/disagree about. Plain language, no markdown:\n` + top.map((t, i) => `${i + 1}. ${t}`).join("\n"));
    renderSummary(box, text);
  } catch { box.className = "summary-box error"; box.textContent = "Summary unavailable right now."; }
  btn.disabled = false;
});
$("#explain-btn").addEventListener("click", async () => {
  const btn = $("#explain-btn"); const box = $("#summary-box"); const it = state.items[state.selected];
  if (!it) return;
  btn.disabled = true; box.hidden = false; box.className = "summary-box loading"; box.textContent = "Explaining like you're new…";
  try {
    const url = it.url || "";
    const text = await groq(`Explain this Hacker News story to a complete beginner in 2 plain-English sentences. What is it, and why might a tech person care? Title: "${it.title}".${url ? " Link: " + url : ""} No jargon, no markdown.`);
    renderSummary(box, text, "💡 What this is about");
  } catch { box.className = "summary-box error"; box.textContent = "Explain unavailable right now."; }
  btn.disabled = false;
});
function renderSummary(box, text, head) {
  const lines = text.split("\n").map((l) => l.replace(/^[\s>*•\-]+/, "").trim()).filter(Boolean);
  box.className = "summary-box"; box.innerHTML = "";
  const h = document.createElement("div"); h.className = "sum-head"; h.textContent = head || "✨ What the comments are saying";
  box.appendChild(h);
  if (lines.length > 1) {
    const ul = document.createElement("ul");
    lines.slice(0, 5).forEach((l) => { const li = document.createElement("li"); li.textContent = l; ul.appendChild(li); });
    box.appendChild(ul);
  } else { box.textContent = (head ? "" : "") + (lines[0] || text); }
}

// ---------- sentiment ----------
async function updateSentiment() {
  const it = state.items[state.selected]; if (!it) return;
  const texts = await loadCommentTexts(it.kids || [], 10);
  if (!texts.length) return;
  try {
    const j = await groq(`Rate the overall sentiment of these Hacker News comments as a percentage positive (0-100). Reply with ONLY a number. Comments:\n` + texts.map((t, i) => `${i + 1}. ${t}`).join("\n"), 10);
    const pct = Math.max(0, Math.min(100, parseInt(j) || 50));
    const s = $("#sentiment"); s.hidden = false;
    $("#sent-fill").style.width = pct + "%";
    $("#sent-num").textContent = pct + "% positive";
  } catch {}
}
// trigger sentiment when summary runs (cheap): hook explain too
$("#explain-btn").addEventListener("click", () => setTimeout(updateSentiment, 50));

// ---------- source check ----------
$("#source-btn").addEventListener("click", async () => {
  const box = $("#source-box"); const it = state.items[state.selected];
  if (!it) return;
  const url = it.url;
  box.hidden = false; box.innerHTML = "Checking source…";
  if (!url) { box.innerHTML = '<div class="src-row">No external link (discussion only).</div>'; return; }
  let html = `<div class="src-row"><span class="tag-ok">LINK</span> <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div>`;
  // paywall heuristic
  const pay = /(?:nytimes|wsj|ft\.com|economist|bloomberg|medium\.com\/subscription|theinformation)/i.test(url);
  html += pay ? `<div class="src-row"><span class="tag-warn">PAYWALL LIKELY</span> may require subscription</div>`
              : `<div class="src-row"><span class="tag-ok">OPEN</span> no obvious paywall</div>`;
  // wayback
  const wb = await getJSON(WB + encodeURIComponent(url));
  if (wb && wb.archived_snapshots && wb.archived_snapshots.closest && wb.archived_snapshots.closest.url) {
    html += `<div class="src-row"><span class="tag-ok">ARCHIVED</span> <a href="${esc(wb.archived_snapshots.closest.url)}" target="_blank" rel="noopener">Wayback snapshot</a></div>`;
  }
  box.innerHTML = html;
});

// ---------- who's talking ----------
$("#voices").addEventListener("toggle", async () => {
  if (!$("#voices").open) return;
  const it = state.items[state.selected]; if (!it) return;
  const list = $("#voices-list"); list.innerHTML = "loading voices…";
  const counts = {};
  async function walk(kids, depth) {
    if (depth > 2 || !kids) return;
    for (const k of kids.slice(0, 12)) {
      const c = await getJSON(`${API}/item/${k}.json`);
      if (!c) continue;
      if (c.by) counts[c.by] = (counts[c.by] || 0) + 1;
      if (c.kids) await walk(c.kids, depth + 1);
    }
  }
  await walk(it.kids || [], 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  list.innerHTML = top.length ? top.map(([by, n]) => `<div class="voice"><span>${esc(by)}</span><span class="vc">${n}×</span></div>`).join("") : "no comments";
});

// ---------- time travel ----------
$("#history-btn").addEventListener("click", () => {
  const pop = $("#history-pop");
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.hidden = false;
  pop.innerHTML = state.histKeys.map((k) => `<button data-k="${k}" class="${k === "now" ? "on" : ""}">${k}</button>`).join("");
  pop.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k;
    const ids = state.history[k] || [];
    const items = ids.map((id) => state.items[id]).filter(Boolean);
    $("#history-label").textContent = k;
    renderFeed(items.length ? items : Object.values(state.items).slice(0, 30));
    pop.hidden = true;
  }));
});

// ---------- keyword watch ----------
function getWatches() {
  try { return JSON.parse(localStorage.getItem("echo_watch") || "[]"); } catch { return []; }
}
function setWatches(a) { localStorage.setItem("echo_watch", JSON.stringify(a)); renderWatchChips(); }
function renderWatchChips() {
  const wrap = $("#watch-chips"); const ws = getWatches();
  wrap.innerHTML = ws.map((w) => `<span class="chip">${esc(w)} <b data-w="${esc(w)}">✕</b></span>`).join("");
  wrap.querySelectorAll("b").forEach((b) => b.addEventListener("click", () => setWatches(getWatches().filter((x) => x !== b.dataset.w))));
}
function checkWatch(items) {
  const ws = getWatches();
  if (!ws.length) return;
  const hit = items.some((it) => ws.some((w) => (it.title || "").toLowerCase().includes(w)));
  const btn = $("#watch-toggle");
  const status = $("#watch-status");
  if (hit) { btn.classList.add("alert", "on"); status.textContent = "match found!"; setTimeout(() => btn.classList.remove("alert"), 4000); }
  else { btn.classList.remove("alert"); status.textContent = ""; }
}
$("#watch-toggle").addEventListener("click", () => { const w = $("#watchbar"); w.hidden = !w.hidden; renderWatchChips(); });
$("#watch-add").addEventListener("click", () => {
  const v = $("#watch-input").value.trim().toLowerCase();
  if (v && !getWatches().includes(v)) setWatches([...getWatches(), v]);
  $("#watch-input").value = "";
});
$("#watch-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#watch-add").click(); });

// ---------- reader mode ----------
$("#reader-mode-btn").addEventListener("click", () => {
  $("#reader").classList.toggle("reader-mode");
  $("#reader-mode-btn").classList.toggle("on");
});

// ---------- share card ----------
$("#share-btn").addEventListener("click", () => {
  const it = state.items[state.selected]; if (!it) return;
  const c = $("#share-canvas"); const ctx = c.getContext("2d");
  ctx.fillStyle = "#0B0E14"; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = "#FF6600"; ctx.font = "bold 64px monospace"; ctx.fillText("◈ ECHO", 60, 100);
  ctx.fillStyle = "#FF6600"; ctx.font = "bold 40px sans-serif"; ctx.fillText("🔥 HOT RIGHT NOW", 60, 170);
  ctx.fillStyle = "#fff"; ctx.font = "bold 52px sans-serif";
  wrapText(ctx, it.title || "", 60, 260, 1080, 60);
  ctx.fillStyle = "#3DDC84"; ctx.font = "32px monospace";
  ctx.fillText(`▲ ${it.score || 0}   ${it.descendants || 0} replies   ${velocity(it).toFixed(1)}/min`, 60, 540);
  ctx.fillStyle = "#6B7787"; ctx.font = "26px monospace";
  ctx.fillText("echo-hn.vercel.app", 60, 590);
  const link = document.createElement("a");
  link.download = "echo-card.png";
  link.href = c.toDataURL("image/png");
  link.click();
});
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(" "); let line = ""; let yy = y;
  for (const w of words) {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w + " "; yy += lh; }
    else line = test;
  }
  ctx.fillText(line, x, yy);
}

// ---------- saved rooms (localStorage) ----------
function getStore() { return JSON.parse(localStorage.getItem("echo_store") || '{"rooms":{},"saved":{}}'); }
function setStore(s) { localStorage.setItem("echo_store", JSON.stringify(s)); }
function isSaved(id) { return !!getStore().saved[id]; }
function toggleSave(id, title) {
  const s = getStore();
  if (s.saved[id]) delete s.saved[id]; else s.saved[id] = { title, ts: Date.now() };
  setStore(s);
  const sb = $("#save-btn"); const on = !!s.saved[id];
  sb.textContent = on ? "★ Saved" : "☆ Save"; sb.classList.toggle("saved", on);
  if (on) promptRoom(id, title);
}
function promptRoom(id, title) {
  const s = getStore(); const names = Object.keys(s.rooms);
  if (!names.length) { addRoom("Saved", id, title); return; }
  const name = prompt(`Add to room:\n${names.join("\n")}\n(or type a new room name)`, names[0]);
  if (name) addRoom(name, id, title);
}
function addRoom(name, id, title) {
  const s = getStore(); s.rooms[name] = s.rooms[name] || { items: {}, view: null };
  s.rooms[name].items[id] = { title, ts: Date.now() }; setStore(s); renderRooms();
}
function applyView(view) {
  if (!view) return;
  if (view.feed) { state.feed = view.feed; document.querySelectorAll(".tab[data-feed]").forEach((x) => x.classList.toggle("active", x.dataset.feed === view.feed)); }
  if (view.sort) { state.sort = view.sort; $("#sort-hot").classList.toggle("active", view.sort === "hot"); $("#sort-hot").textContent = view.sort === "hot" ? "🔥 Hot" : "📊 By score"; }
  loadFeed();
}
function renderRooms() {
  const s = getStore(); const list = $("#rooms-list"); list.innerHTML = "";
  const names = Object.keys(s.rooms);
  if (!names.length) { list.innerHTML = '<div class="loading">No rooms yet.</div>'; return; }
  names.forEach((n) => {
    const count = Object.keys(s.rooms[n].items).length;
    const el = document.createElement("div"); el.className = "room-item";
    el.innerHTML = `<span>${esc(n)} · ${count}</span><button title="delete">✕</button>`;
    el.querySelector("button").onclick = (e) => { e.stopPropagation(); delete s.rooms[n]; setStore(s); renderRooms(); };
    el.onclick = () => { const v = s.rooms[n].view; if (v) applyView(v); $("#rooms-panel").hidden = true; };
    list.appendChild(el);
  });
}
$("#room-save-view").addEventListener("click", () => {
  const name = prompt("Save current view (feed + sort) as a room name:", "My view");
  if (!name) return;
  const s = getStore(); s.rooms[name] = s.rooms[name] || { items: {}, view: null };
  s.rooms[name].view = { feed: state.feed, sort: state.sort }; setStore(s); renderRooms();
  $("#rooms-panel").hidden = true;
});

// ---------- local notes (comments) ----------
function getNotes() { return JSON.parse(localStorage.getItem("echo_notes") || "{}"); }
function renderMyComments(id) {
  const notes = getNotes(); const wrap = $("#my-comments");
  const mine = notes[id] || [];
  wrap.innerHTML = mine.length ? mine.map((m) => `<div class="my-c"><div class="mc-by">you · ${timeAgo(m.ts)}</div>${esc(m.text)}</div>`).join("") : "";
}
$("#comment-send").addEventListener("click", () => {
  const id = state.selected; const v = $("#comment-input").value.trim(); if (!id || !v) return;
  const notes = getNotes(); notes[id] = notes[id] || [];
  notes[id].push({ text: v, ts: Math.floor(Date.now() / 1000) });
  localStorage.setItem("echo_notes", JSON.stringify(notes));
  $("#comment-input").value = ""; renderMyComments(id);
});

// ---------- UI wiring ----------
document.querySelectorAll(".tab[data-feed]").forEach((t) => t.addEventListener("click", () => {
  state.feed = t.dataset.feed;
  document.querySelectorAll(".tab[data-feed]").forEach((x) => x.classList.remove("active"));
  t.classList.add("active"); loadFeed();
}));
$("#sort-hot").addEventListener("click", () => {
  state.sort = state.sort === "hot" ? "score" : "hot";
  $("#sort-hot").classList.toggle("active", state.sort === "hot");
  $("#sort-hot").textContent = state.sort === "hot" ? "🔥 Hot" : "📊 By score";
  loadFeed();
});
$("#rooms-btn").addEventListener("click", () => { renderRooms(); $("#rooms-panel").hidden = false; });
$("#rooms-close").addEventListener("click", () => $("#rooms-panel").hidden = true);
$("#room-add").addEventListener("click", () => { const v = $("#room-name").value.trim(); if (v) { addRoom(v); $("#room-name").value = ""; } });
$("#help-btn").addEventListener("click", () => $("#help-modal").hidden = false);
$("#help-close").addEventListener("click", () => $("#help-modal").hidden = true);
$("#onboard-close").addEventListener("click", () => { $("#onboard").style.display = "none"; localStorage.setItem("echo_onboarded", "1"); });
if (localStorage.getItem("echo_onboarded")) $("#onboard").style.display = "none";

// theme morph
const themeBtn = $("#theme-btn"); const morph = $("#theme-morph");
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); themeBtn.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark"; localStorage.setItem("echo_theme", t); }
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  const r = themeBtn.getBoundingClientRect();
  morph.style.setProperty("--mx", (r.left + r.width / 2) + "px");
  morph.style.setProperty("--my", (r.top + r.height / 2) + "px");
  morph.style.background = next === "dark" ? "#0E0E12" : "#F5F1E8";
  morph.classList.add("run"); requestAnimationFrame(() => morph.classList.add("go"));
  setTimeout(() => applyTheme(next), 240);
  setTimeout(() => { morph.classList.remove("run", "go"); }, 650);
}
const savedTheme = localStorage.getItem("echo_theme") || "light";
applyTheme(savedTheme);
themeBtn.addEventListener("click", toggleTheme);

loadFeed("now");
setInterval(() => loadFeed("now"), 45000);
