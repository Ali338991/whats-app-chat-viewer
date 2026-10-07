// Windowed rendering + data search for huge chats (pure functions, no DOM).
//
// A chat can have 100k+ messages. Rendering all of them at once creates ~1M
// DOM nodes and a tens-of-MB HTML string, which freezes/kills mobile Safari.
// The viewer therefore renders only a window [start, end) of the messages,
// grows it as the user scrolls, trims the far side to stay bounded, and
// searches the parsed data instead of the DOM.

import { formatText, formatDate, escapeHtml, isEmojiOnly, avatarColor, attachment, mediaKind, basename } from "./chat.js"; // explicit extension so plain Node can run the tests

export const WINDOW_INITIAL = 250;  // messages shown when a chat opens (the latest ones)
export const WINDOW_STEP = 250;     // messages added per scroll extension
export const WINDOW_MAX = 1200;     // hard cap; the far side is trimmed beyond this
export const FOCUS_RADIUS = 150;    // messages on each side when jumping to an index
export const SEARCH_HIT_CAP = 100000;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The latest `size` messages. */
export function initialWindow(total, size = WINDOW_INITIAL) {
  return { start: Math.max(0, total - size), end: total };
}

/** Prepend older messages; trims the bottom if the window gets too big. */
export function extendUp(win, total, step = WINDOW_STEP, max = WINDOW_MAX) {
  const start = Math.max(0, win.start - step);
  let end = Math.min(total, win.end);
  if (end - start > max) end = start + max;
  return { start, end };
}

/** Append newer messages; trims the top if the window gets too big. */
export function extendDown(win, total, step = WINDOW_STEP, max = WINDOW_MAX) {
  const end = Math.min(total, win.end + step);
  let start = Math.max(0, win.start);
  if (end - start > max) start = end - max;
  return { start, end };
}

/** A window centred on `index` (clamped to the chat). */
export function windowAround(index, total, radius = FOCUS_RADIUS) {
  if (total <= 0) return { start: 0, end: 0 };
  const i = clampInt(index, 0, total - 1);
  let start = Math.max(0, i - radius);
  let end = Math.min(total, i + radius + 1);
  // keep the full width near the edges
  const want = Math.min(total, radius * 2 + 1);
  if (end - start < want) {
    if (start === 0) end = Math.min(total, want);
    else start = Math.max(0, total - want);
  }
  return { start, end };
}

export const inWindow = (win, index) => index >= win.start && index < win.end;

/** Same window object if `index` is already visible, otherwise one centred on it. */
export function ensureVisibleRange(win, index, total, radius = FOCUS_RADIUS) {
  return inWindow(win, index) ? win : windowAround(index, total, radius);
}

/**
 * Grouping state ("previous message") for rendering a window that starts at
 * `start`, so day dividers and first-in-group bubble tails at the top edge are
 * identical to a full render.
 */
export function edgeState(messages, start, me) {
  const prev = start > 0 ? messages[start - 1] : null;
  if (!prev) return { lastDate: null, lastSender: null, lastType: null };
  if (prev.system) return { lastDate: prev.date, lastSender: null, lastType: null };
  return { lastDate: prev.date, lastSender: prev.sender, lastType: prev.sender === me ? "out" : "in" };
}

/**
 * HTML for messages[start, end). `data-i` is the global message index.
 * ctx: { me, groupChat, mediaUrls, dlUrl(name), remote }
 */
export function renderWindowHtml(messages, start, end, ctx) {
  const { me, groupChat, mediaUrls = {}, dlUrl = (n) => mediaUrls[n], remote = false } = ctx;
  const preload = remote ? "none" : "metadata";
  let { lastDate, lastSender, lastType } = edgeState(messages, start, me);
  const parts = [];
  for (let i = start; i < end; i++) {
    const msg = messages[i];
    if (msg.date !== lastDate) {
      parts.push(`<div class="day-divider" data-date="${escapeHtml(msg.date)}"><span>${formatDate(msg.date)}</span></div>`);
      lastDate = msg.date; lastSender = null; lastType = null;
    }
    if (msg.system) {
      parts.push(`<div class="system-msg" data-i="${i}"><span>${formatText(msg.text)}</span></div>`);
      lastSender = null; lastType = null;
      continue;
    }
    const out = msg.sender === me;
    const type = out ? "out" : "in";
    const first = msg.sender !== lastSender || lastType !== type;
    const showName = !out && first && groupChat;

    const att = attachment(msg.text);
    const name = att ? basename(att.name) : null;
    const url = name ? mediaUrls[name] : null;
    let body;
    if (url) {
      const kind = mediaKind(att.name);
      const n = escapeHtml(name);
      const u = escapeHtml(url);
      const cap = att.caption ? `<span class="msg-text">${formatText(att.caption)}</span>` : "";
      if (kind === "image")
        body = `<a class="media-wrap" href="${u}" data-mh="${n}" target="_blank" rel="noopener"><img class="media-img" src="${u}" data-m="${n}" loading="lazy" decoding="async" alt=""></a>${cap}`;
      else if (kind === "sticker")
        body = `<img class="media-sticker" src="${u}" data-m="${n}" loading="lazy" decoding="async" alt="">${cap}`;
      else if (kind === "video")
        body = `<video class="media-vid" src="${u}" data-m="${n}" controls playsinline preload="${preload}"></video>${cap}`;
      else if (kind === "audio")
        body = `<audio class="media-aud" src="${u}" data-m="${n}" controls preload="${preload}"></audio>${cap}`;
      else
        body = `<a class="media-file" href="${escapeHtml(dlUrl(name) || url)}" data-m="${n}" download="${n}"><span class="media-file-ic">📄</span><span>${escapeHtml(att.name)}</span></a>${cap}`;
    } else {
      body = `<span class="msg-text${isEmojiOnly(msg.text) ? " emoji-only" : ""}">${formatText(msg.text)}</span>`;
    }

    parts.push(
      `<div class="row ${type}${first ? " first" : ""}" data-i="${i}"><div class="bubble">` +
      (showName ? `<div class="sender-name" style="color:${avatarColor(msg.sender)}">${escapeHtml(msg.sender)}</div>` : "") +
      body +
      `<span class="meta">${escapeHtml(msg.time)}${out ? ' <span class="ticks">✓✓</span>' : ""}</span></div></div>`
    );
    lastSender = msg.sender; lastType = type;
  }
  return parts.join("");
}

/* ---------------- search over the data ---------------- */

// Lowercased searchable text per message (what the user can actually read:
// attachment messages contribute their caption and file name).
export function buildSearchCorpus(messages) {
  const out = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const lower = m.text.toLowerCase();
    // cheap pre-check: every attachment pattern contains "attached"
    const att = !m.system && lower.includes("attached") ? attachment(m.text) : null;
    out[i] = att ? `${att.caption || ""} ${att.name}`.toLowerCase() : lower;
  }
  return out;
}

/**
 * Scan corpus[from, to) for `q` (already lowercased), pushing one message index
 * per occurrence into `hits` (stops at `cap`). Returns the index where it stopped
 * — call again from there to continue (chunked, so typing never blocks).
 */
export function scanChunk(corpus, q, from, to, hits, cap = SEARCH_HIT_CAP) {
  const end = Math.min(corpus.length, to);
  let i = from;
  for (; i < end; i++) {
    const t = corpus[i];
    if (!t) continue;
    let at = t.indexOf(q);
    while (at !== -1) {
      if (hits.length >= cap) return corpus.length; // capped: done
      hits.push(i);
      at = t.indexOf(q, at + q.length);
    }
  }
  return i;
}

/** Synchronous full search (tests / small chats). */
export function findMatches(corpus, q, cap = SEARCH_HIT_CAP) {
  const hits = [];
  const needle = String(q || "").toLowerCase();
  if (!needle) return hits;
  scanChunk(corpus, needle, 0, corpus.length, hits, cap);
  return hits;
}

/** Which occurrence inside its message hit #`cur` is (0-based). */
export function occurrenceInMessage(hits, cur) {
  let k = 0;
  for (let j = cur - 1; j >= 0 && hits[j] === hits[cur]; j--) k++;
  return k;
}

/** First message index for each date (for "jump to date"). */
export function firstIndexByDate(messages) {
  const map = new Map();
  for (let i = 0; i < messages.length; i++) {
    const d = messages[i].date;
    if (!map.has(d)) map.set(d, i);
  }
  return map;
}
