# ◈ ECHO — read the room on Hacker News

A Hacker News reader that doesn't just list stories — it **reads the room**.
ECHO shows what HN is *actually talking about right now*, in plain language,
so even a first-time visitor gets it.

Built for the Deeperlife hackathon — fast, opinionated, beginner-friendly.

## What makes it different

- **🔥 Hot right now** — sorts the front page by how fast replies are arriving
  *this minute* (delta velocity), not by total karma. Surfaces what's exploding now.
- **Velocity meter** — "how fast people are replying" in plain words, per story.
- **✨ Summarize the debate** — one click runs an LLM (Groq) over the top
  comments and tells you what people are agreeing / arguing about.
- **★ My rooms** — save stories into named rooms (e.g. "AI watch"), stored
  on your device. No account needed.
- **Beginner-friendly** — onboarding strip, help modal, plain labels, big taps.
- **Zero backend** — talks straight to the official HN Firebase API + Groq for summaries.

## Stack

- Static PWA — HTML + CSS + vanilla JS (no framework, no build step)
- Hacker News API: `https://hacker-news.firebaseio.com/v0`
- Groq (`groq/compound-mini`) for debate summaries
- Fonts: Space Grotesk (display) · Inter (body) · JetBrains Mono (data)

## Run locally

```bash
python3 -m http.server 8099
# open http://localhost:8099
```

## Deploy

Connected to Vercel — push to `main` and it redeploys automatically.
Live at: **https://echo-hn.vercel.app**

## Files

| File | Purpose |
|------|---------|
| `index.html` | Structure + onboarding + help |
| `styles.css` | Dark "signal" design system, beginner-tuned |
| `app.js` | HN fetching, hot/velocity logic, Groq summaries, rooms |
| `manifest.json` / `icon.svg` | PWA shell |
| `vercel.json` | Static deploy config |

---

*Built with the `frontend-design` skill — distinctive, not templated.*

<!-- deploy trigger -->
