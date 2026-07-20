# WhatsApp Chat Viewer (Next.js)

View exported WhatsApp `.txt` chats in a WhatsApp-style UI. 100% client-side — chats are saved in the browser's localStorage and never leave the device.

## Features

### Viewer
- WhatsApp-style UI (bubbles, tails, day dividers, system messages, ✓✓ ticks), dark mode, mobile responsive
- Chat list sidebar with previews, filter, delete; chats persist in localStorage
- Multi-file import, drag & drop, import loader for large files
- Message search (Ctrl/Cmd+F) with highlight + match navigation
- "Me" side selector remembered per chat; emoji-only messages enlarged; links/bold/italic formatting
- Optional signed cloud sync (one-time opt-in banner, per-chat sync badges)

### 📊 Statistics (clickable — every stat jumps to the matching messages, highlighted)
- ❤️ Love score with breakdown · 🎁 Chat Wrapped PNG card
- ⚡ Reply times + slowest reply · 🤝 Chat dynamics (texts first / double-texts / conversation enders)
- 💕 Love & sorry meter (Sorry, I love you, Mohabbat, Pyar, Jaan, Miss you, GM/GN) with per-person split & peak days
- 🔎 Count any custom word/phrase · 🏆 Milestones · ✨ Fun facts
- 🕐 Day×hour heatmap · 📈 Monthly chart · 🗣 Favorite words · Top emojis · Timeline

### 🧭 Insights dashboard (lazy-loaded deep analytics)
- 📖 Conversation chapters (auto-detected & auto-named) · 🎭 Mood timeline (7 rule-based moods)
- 💞 Relationship timeline + custom milestone tracker · 🏷 Nickname evolution
- ✨ Memory explorer ("Surprise me", no repeats) · 📅 This Day in History
- ▶ Chat Replay (movie-style playback, 1–20x, typing indicator, seek)
- 💌 Love language radar · 🤗 Emotional support balance with examples · ⚡ Energy match (morning→late night)
- 🏃 Typing marathon · 🤫 Silent periods · ⚡ Fastest conversations
- 😀 Emoji evolution by year · 📚 Vocabulary growth chart · 🗂 Topic detection + topic evolution
- 🟩 GitHub-style activity calendar · 📦 Monthly Wrapped cards
- 🏅 Awards · 🎖 Achievements · 🎭 Personality cards · 🧠 Message complexity
- 🔮 Prediction engine · ❤️ Conversation health score (explained) · 🔍 Hidden patterns
- 📄 One-click rule-based summary export (Markdown)

Everything is computed locally in the browser — no chat data is sent anywhere unless the user explicitly enables cloud sync.

- Chat list sidebar with previews, filter, and delete
- WhatsApp-style bubbles, day dividers, system messages, dark mode
- Multi-file import + drag & drop
- Message search with match navigation (Ctrl/Cmd+F)
- Statistics: messages/words/media/links, per-person split, top emojis, timeline, chat streak
- 💕 Couple stats: Sorry / I love you / Mohabbat / Pyar / Jaan / Miss you / Good morning / Good night counters — per person, with peak day
- Custom counter: type any word or phrase (e.g. "Mujy ap sy bht mohbbat ha") to count it per person
- Fun facts: who says sorry more, who starts conversations, longest streak, longest message

## Cloud sync (signed uploads, one-time opt-in)

Chats can be backed up to Cloudinary via a **signed server-side upload** (`app/api/backup/route.js`).
The API secret never reaches the browser — the client only calls `/api/backup`.

Consent UX: the **first time** a user imports a chat, a small banner offers "Enable sync / No thanks".
Their choice is remembered and never asked again. When on, every import syncs automatically with a
"☁️ syncing…" badge on the chat, then ☁️✓. The ☁ button in the sidebar toggles it anytime.

Setup — get your credentials from Cloudinary Dashboard → Settings → **API Keys**
(Cloud name is at the top; click "Generate New API Key" if you need a fresh key/secret pair).
Then set in `.env.local` (and Vercel → Project Settings → Environment Variables):

```
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your-secret
```

No `NEXT_PUBLIC_` prefix — these are server-only. Files upload as raw `.txt` under `chat-backups/`.

> ⚠️ Privacy: with sync enabled you are collecting users' private conversations. Keep the
> one-time consent banner, and mention the backup in a privacy policy. Never upload without
> the user's opt-in — that would violate user trust and privacy laws (GDPR etc.).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy on Vercel

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com/new, import the repo — Vercel auto-detects Next.js.
3. Click Deploy. Done.

Or with the CLI: `npx vercel` from this folder.
