# ◈ ECHO — read the room on Hacker News

A Hacker News reader that doesn't just list stories — it **reads the room**.
ECHO surfaces what's actually happening on HN right now: which stories are
climbing, how fast the debate is moving, and the real conversation underneath.

Built for the Deeperlife hackathon track — a fast, opinionated take on a
firehose everyone uses but nobody *reads*.

## The signature: comment velocity

Every story gets a **velocity meter** — comments-per-minute since it was posted.
A high velocity means the room is arguing. A flat line means it's already
settled. You can sort the entire front page **by velocity** instead of by score,
which surfaces the stories that are *exploding right now* — not the ones that won
yesterday.

## Features

- **Five feeds:** Top · New · Ask · Show · Jobs
- **Velocity sort:** reorder the feed by live comment velocity, not karma
- **Live pulse:** refreshes every 60s, no login, no rate limit
- **Threaded comments:** lazy-loaded, collapsible, real HN data
- **PWA:** installable, offline shell, dark by design
- **Zero backend:** talks straight to the official HN Firebase API

## Stack

- Static PWA — HTML + CSS + vanilla JS (no framework, no build step)
- Hacker News API: `https://hacker-news.firebaseio.com/v0`
- Fonts: Space Grotesk (display) · Inter (body) · JetBrains Mono (data)

## Run locally

```bash
python3 -m http.server 8099
# open http://localhost:8099
```

## Deploy

One-click on Vercel: import `BllytheGoat/echo-hn`. It's static — no config
needed beyond the included `vercel.json`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Structure |
| `styles.css` | The dark "signal" design system |
| `app.js` | HN fetching, velocity math, rendering |
| `manifest.json` / `icon.svg` | PWA shell |
| `vercel.json` | Static deploy config |

---

*Built with the `frontend-design` skill — distinctive, not templated.*
