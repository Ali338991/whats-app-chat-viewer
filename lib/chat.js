// ---------- Parsing & formatting helpers (pure, no React) ----------

// Android: "5/3/26, 4:01 PM - " | iOS: "[05/03/26, 16:01:22] "
const HEAD_ANDROID =
  /^(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\s+-\s+(.*)$/;
const HEAD_IOS =
  /^\[(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\]\s+(.*)$/;

export function cleanText(text) {
  return text.replace(/^﻿/, "").replace(/[‎‏‪-‮]/g, "");
}

export function parseText(text) {
  const lines = cleanText(text).split(/\r?\n/);
  const msgs = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(HEAD_ANDROID) || line.match(HEAD_IOS);
    if (m) {
      if (cur) msgs.push(cur);
      const rest = m[3];
      const ci = rest.indexOf(": ");
      if (ci > -1)
        cur = { date: m[1], time: m[2], sender: rest.slice(0, ci), text: rest.slice(ci + 2), system: false };
      else cur = { date: m[1], time: m[2], sender: null, text: rest, system: true };
    } else if (cur) {
      cur.text += "\n" + line;
    }
  }
  if (cur) msgs.push(cur);
  return msgs;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isEmojiOnly(text) {
  const t = text.trim();
  if (!t || t.length > 12) return false;
  try {
    return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|[‍️\s])+$/u.test(t);
  } catch {
    return false;
  }
}

export function formatText(text) {
  let t = escapeHtml(text);
  const trimmed = text.trim();
  if (/^(You deleted this message|This message was deleted)\.?$/i.test(trimmed))
    return `<span class="deleted">${t}</span>`;
  if (/^&lt;Media omitted&gt;$/.test(t.trim()) || /^(image|video|audio|sticker|GIF|document) omitted$/i.test(trimmed))
    return `<span class="media">📎 ${t}</span>`;
  t = t.replace(/(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)/g, (url) =>
    `<a href="${url.replace(/&amp;/g, "&")}" target="_blank" rel="noopener">${url}</a>`
  );
  t = t
    .replace(/```([^`]+)```/g, "<code>$1</code>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1<b>$2</b>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, "$1<i>$2</i>")
    .replace(/(^|\s)~([^~\n]+)~(?=\s|$|[.,!?])/g, "$1<s>$2</s>");
  return t.replace(/\n/g, "<br>");
}

// ---------- Attachments / media ----------

// Extract the attached file's name (and any caption) from a media message.
//   iOS:     "<attached: 00000042-PHOTO-2021-05-03-16-01-02.jpg>"
//   Android: "IMG-20201010-WA0000.jpg (file attached)"
// (the directional LRM/RLM marks WhatsApp adds are already stripped by cleanText)
export function attachment(text) {
  const t = text.trim();
  let m = t.match(/<attached:\s*([^>]+?)>/i);
  if (m) return { name: m[1].trim(), caption: t.replace(m[0], "").trim() };
  m = t.match(/([^\s][^<>:"/\\|?*\n]*?\.[A-Za-z0-9]{2,4})\s*\((?:file attached|attached)\)/i);
  if (m) return { name: m[1].trim(), caption: t.slice(m.index + m[0].length).trim() };
  return null;
}

export function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

const MEDIA_EXT = {
  image:   ["jpg", "jpeg", "png", "gif", "bmp"],
  sticker: ["webp"],
  video:   ["mp4", "mov", "3gp", "webm", "mkv"],
  audio:   ["opus", "mp3", "m4a", "aac", "ogg", "wav", "amr"],
};
const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp", webm: "video/webm", mkv: "video/x-matroska",
  opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", wav: "audio/wav", amr: "audio/amr", pdf: "application/pdf",
};
function ext(name) {
  return (String(name).split(".").pop() || "").toLowerCase();
}
export function mediaKind(name) {
  const e = ext(name);
  for (const k of Object.keys(MEDIA_EXT)) if (MEDIA_EXT[k].includes(e)) return k;
  return "file";
}
export function mimeFor(name) {
  return MIME[ext(name)] || "application/octet-stream";
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function dateParts(d) {
  const p = String(d).split(/[\/.\-]/).map(Number);
  if (p.length !== 3) return null;
  let day, mon, yr;
  if (p[0] > 999) { [yr, mon, day] = p; }
  else {
    [mon, day] = p[0] > 12 ? [p[1], p[0]] : [p[0], p[1]];
    yr = p[2] < 100 ? 2000 + p[2] : p[2];
  }
  if (mon < 1 || mon > 12) return null;
  return { day, mon, yr };
}

export function formatDate(d) {
  const p = dateParts(d);
  if (!p) return d;
  return `${MONTHS[p.mon - 1]} ${p.day}, ${p.yr}`;
}

export function toJsDate(d) {
  const p = dateParts(d);
  return p ? new Date(p.yr, p.mon - 1, p.day) : null;
}

export function parseTime(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap])?/);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const ap = m[4] ? m[4].toUpperCase() : null;
  if (ap === "P" && h < 12) h += 12;
  if (ap === "A" && h === 12) h = 0;
  return { h, min };
}

export function toTimestamp(m) {
  const d = toJsDate(m.date);
  const t = parseTime(m.time);
  if (!d || !t) return null;
  d.setHours(t.h, t.min, 0, 0);
  return d.getTime();
}

export function formatDuration(ms) {
  if (ms == null) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function initial(name) {
  return (String(name).trim().charAt(0) || "?").toUpperCase();
}

export function avatarColor(name) {
  const colors = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#0ea5e9","#ef4444","#14b8a6"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

const KIND_LABEL = { image: "Photo", sticker: "Sticker", video: "Video", audio: "Audio", file: "Document" };
export function previewText(m) {
  let t = m.text.replace(/\n/g, " ");
  const att = attachment(m.text);
  if (att) t = "📎 " + (att.caption || KIND_LABEL[mediaKind(att.name)] || "Media");
  else if (/<Media omitted>|omitted$/i.test(t.trim())) t = "📎 Media";
  return (m.sender ? m.sender.split(" ")[0] + ": " : "") + t.slice(0, 60);
}

// ---------- Statistics ----------

// Fun phrase trackers — English + Roman Urdu, tuned for couple chats
export const PHRASES = [
  { key: "sorry",   label: "Sorry",        emoji: "🙏", re: /\bsorry\b|\bsry\b|\bsryy+\b|\bmaa?f\b|\bmaafi\b|\bmafi\b|\bmuaf\b/gi },
  { key: "iloveyou",label: "I love you",   emoji: "❤️", re: /i\s*love\s*(you|u)\b|\bily\b|\blove\s*(you|u)\b/gi },
  { key: "mohabbat",label: "Mohabbat",     emoji: "💞", re: /m[ou]h?a?bbat|muhabbat|bht\s*mohbbat/gi },
  { key: "pyar",    label: "Pyar",         emoji: "💕", re: /\bpyaa?r\b|\bpiyar\b|\bpyr\b/gi },
  { key: "jaan",    label: "Jaan / Janu",  emoji: "🥰", re: /\bjaan\b|\bjaanu+\b|\bjanu+\b|\bjaanam\b|\bjanam\b/gi },
  { key: "missyou", label: "Miss you",     emoji: "🥺", re: /miss\s*(you|u)\b|yaad\s*(aa?|a)\s*(rahi|raha|rhi|rha)/gi },
  { key: "gm",      label: "Good morning", emoji: "☀️", re: /good\s*morning|subah\s*ba?khair/gi },
  { key: "gn",      label: "Good night",   emoji: "🌙", re: /good\s*night|shab\s*ba?khair/gi },
];

// counts occurrences; pass the FULL message array so indices match the rendered chat
export function countPhrase(messages, re) {
  const perSender = {};
  const perDay = {};
  const indices = [];
  let total = 0;
  messages.forEach((m, i) => {
    if (m.system) return;
    re.lastIndex = 0;
    const matches = m.text.match(re);
    if (!matches) return;
    const n = matches.length;
    total += n;
    indices.push(i);
    perSender[m.sender] = (perSender[m.sender] || 0) + n;
    perDay[m.date] = (perDay[m.date] || 0) + n;
  });
  const peak = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0] || null;
  return { total, perSender, indices, peakDay: peak ? { date: peak[0], count: peak[1] } : null };
}

const STOPWORDS = new Set(("the a an and or but is are was were be been to of in on for with at by it its this that these those i you he she we they them me my your yours so do did does done not no yes ok okay okey u ur im am if then than just too very can could will would should what when where how why who whom which there here all any some more most other same own s t don ve ll re m d o e g" +
  " hai ha hy hain ho hn han haan nhi nahi nai na ni ka ki ko kya kia kiya ke k se sy mein mai mn ap aap tum tm tu ye yh wo woh bhi b or aur per par pr ab toh ji acha accha achha theek thek thik hnji hanji lo le de do ga gi gy ge raha rahi rhe rha rhi kr kar krna karna kro karo kry hua hui hue tha thi thy kuch koi bs bas phir fir abhi abi waise wese magar lekin q qk kyun kyu kyunke bcz because")
  .split(/\s+/));

function topWordsFor(texts, n = 6) {
  const counts = {};
  for (const t of texts) {
    const cleaned = t.toLowerCase().replace(/https?:\/\/\S+/g, " ");
    for (const w of cleaned.split(/[^a-z؀-ۿ']+/)) {
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// Cache: stats are computed once per chat (keyed by the messages array reference,
// which is stable per chat thanks to useMemo in the page). Reopening the modal is instant.
const statsCache = new WeakMap();
export function computeStatsCached(messages) {
  if (statsCache.has(messages)) return statsCache.get(messages);
  const s = computeStats(messages);
  statsCache.set(messages, s);
  return s;
}
export function peekStatsCache(messages) {
  return statsCache.get(messages) || null;
}

export function computeStats(messages) {
  const counts = {}, dayCounts = {}, emojiCounts = {}, emojiIdx = {}, firstOfDay = {};
  const monthly = {}; // key -> {count, firstIndex, label}
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  const replySums = {}, replyCounts = {}, doubleTexts = {}, enders = {};
  const textsBySender = {};
  const dayFirstIdx = {};
  let media = 0, links = 0, deleted = 0, words = 0, realCount = 0;
  let longest = null, slowestReply = null;
  let seenDay = null;
  let prev = null;
  let firstIdx = -1;

  const GAP_NEW_CONVO = 6 * 3600000;   // 6h+ silence = conversation ended
  const REPLY_CAP = 12 * 3600000;      // replies over 12h don't count toward averages
  const DOUBLE_GAP = 3600000;          // 1h+ follow-up to yourself = double text

  messages.forEach((m, i) => {
    if (m.system) return;
    realCount++;
    if (firstIdx === -1) firstIdx = i;
    counts[m.sender] = (counts[m.sender] || 0) + 1;
    dayCounts[m.date] = (dayCounts[m.date] || 0) + 1;
    if (dayFirstIdx[m.date] === undefined) dayFirstIdx[m.date] = i;
    if (m.date !== seenDay) {
      firstOfDay[m.sender] = (firstOfDay[m.sender] || 0) + 1;
      seenDay = m.date;
    }

    const ts = toTimestamp(m);
    if (ts != null) {
      const d = new Date(ts);
      heatmap[d.getDay()][d.getHours()]++;
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthly[mk]) monthly[mk] = { count: 0, firstIndex: i, label: `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` };
      monthly[mk].count++;

      if (prev && prev.ts != null && ts >= prev.ts) {
        const delta = ts - prev.ts;
        if (m.sender !== prev.sender) {
          if (delta <= REPLY_CAP) {
            replySums[m.sender] = (replySums[m.sender] || 0) + delta;
            replyCounts[m.sender] = (replyCounts[m.sender] || 0) + 1;
          }
          if (delta <= 48 * 3600000 && (!slowestReply || delta > slowestReply.ms))
            slowestReply = { sender: m.sender, ms: delta, index: i };
        } else if (delta >= DOUBLE_GAP) {
          doubleTexts[m.sender] = (doubleTexts[m.sender] || 0) + 1;
        }
        if (delta >= GAP_NEW_CONVO) enders[prev.sender] = (enders[prev.sender] || 0) + 1;
      }
      prev = { sender: m.sender, ts, index: i };
    }

    const t = m.text.trim();
    if (/<Media omitted>|omitted$/i.test(t)) { media++; return; }
    if (/^(You deleted this message|This message was deleted)\.?$/i.test(t)) { deleted++; return; }
    (textsBySender[m.sender] = textsBySender[m.sender] || []).push(t);
    const w = t.split(/\s+/).length;
    words += w;
    if (!longest || w > longest.words) longest = { sender: m.sender, words: w, date: m.date, index: i };
    links += (t.match(/https?:\/\//g) || []).length;
    try {
      for (const e of t.match(/\p{Extended_Pictographic}/gu) || []) {
        emojiCounts[e] = (emojiCounts[e] || 0) + 1;
        (emojiIdx[e] = emojiIdx[e] || []).push(i);
      }
    } catch {}
  });
  if (prev) enders[prev.sender] = (enders[prev.sender] || 0) + 1; // last message of the chat

  // longest streak of consecutive chat days
  const days = Object.keys(dayCounts)
    .map((d) => ({ d, t: toJsDate(d)?.getTime() }))
    .filter((x) => x.t)
    .sort((a, b) => a.t - b.t);
  let streak = 0, best = 0, bestEnd = null;
  for (let i = 0; i < days.length; i++) {
    streak = i > 0 && days[i].t - days[i - 1].t === 86400000 ? streak + 1 : 1;
    if (streak > best) { best = streak; bestEnd = days[i].d; }
  }
  const spanDays = days.length > 1 ? Math.round((days[days.length - 1].t - days[0].t) / 86400000) + 1 : 1;

  // days with no chat at all (gaps between active days)
  const noChatGaps = [];
  for (let i = 1; i < days.length; i++) {
    const gd = Math.round((days[i].t - days[i - 1].t) / 86400000) - 1;
    if (gd > 0) noChatGaps.push({ days: gd, from: days[i - 1].d, to: days[i].d });
  }
  noChatGaps.sort((a, b) => b.days - a.days);
  const missedDays = Math.max(0, spanDays - days.length);
  const talkedPct = Math.round((days.length / Math.max(1, spanDays)) * 100);

  const busiest = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0] || null;
  const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const phrases = PHRASES.map((p) => ({ ...p, ...countPhrase(messages, p.re) }));

  const replyAvg = {};
  for (const s of Object.keys(replyCounts)) replyAvg[s] = replySums[s] / replyCounts[s];

  const topWords = {};
  for (const s of Object.keys(textsBySender)) topWords[s] = topWordsFor(textsBySender[s]);

  // milestones
  const milestones = [];
  if (firstIdx > -1) milestones.push({ label: "🐣 First message ever", detail: formatDate(messages[firstIdx].date), index: firstIdx });
  const addFirst = (key, label) => {
    const idx = phrases.find((p) => p.key === key)?.indices[0];
    if (idx !== undefined) milestones.push({ label, detail: formatDate(messages[idx].date), index: idx });
  };
  addFirst("iloveyou", '❤️ First "I love you"');
  addFirst("jaan", '🥰 First "jaan"');
  addFirst("mohabbat", '💞 First "mohabbat"');
  addFirst("sorry", "🙏 First sorry");
  let nth = 0;
  const marks = [100, 500, 1000, 5000, 10000, 25000, 50000];
  messages.forEach((m, i) => {
    if (m.system) return;
    nth++;
    if (marks.includes(nth)) milestones.push({ label: `🎉 Message #${nth.toLocaleString()}`, detail: formatDate(m.date), index: i });
  });

  // love / compatibility score
  const senderKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let loveScore = null;
  if (senderKeys.length >= 2) {
    const [a, b] = senderKeys;
    const balance = 1 - Math.abs(counts[a] - counts[b]) / (counts[a] + counts[b]);
    const loveTotal = phrases
      .filter((p) => ["iloveyou","mohabbat","pyar","jaan","missyou"].includes(p.key))
      .reduce((s, p) => s + p.total, 0);
    const loveRatio = Math.min(1, loveTotal / Math.max(1, realCount / 50));
    const avgAll = Object.values(replyAvg);
    const speed = avgAll.length
      ? Math.max(0, 1 - avgAll.reduce((s, x) => s + x, 0) / avgAll.length / (30 * 60000))
      : 0.5;
    const consistency = Math.min(1, days.length / Math.max(1, spanDays));
    const score = Math.round(balance * 30 + loveRatio * 30 + speed * 20 + consistency * 20);
    loveScore = {
      score: Math.max(5, Math.min(100, score)),
      parts: {
        balance: Math.round(balance * 100),
        love: Math.round(loveRatio * 100),
        speed: Math.round(speed * 100),
        consistency: Math.round(consistency * 100),
      },
    };
  }

  return {
    total: realCount, words, media, links, deleted,
    activeDays: days.length, spanDays,
    missedDays, talkedPct, topGaps: noChatGaps.slice(0, 3),
    counts, firstOfDay, busiest, topEmojis, emojiIdx, longest,
    streak: best, streakEnd: bestEnd,
    first: messages.find((m) => !m.system)?.date,
    last: [...messages].reverse().find((m) => !m.system)?.date,
    avgPerDay: days.length ? Math.round(realCount / days.length) : 0,
    phrases,
    replyAvg, replyCounts, slowestReply,
    doubleTexts, enders,
    heatmap,
    monthly: Object.keys(monthly).sort().map((k) => ({ key: k, ...monthly[k] })),
    topWords,
    milestones,
    loveScore,
    dayFirstIdx,
  };
}
