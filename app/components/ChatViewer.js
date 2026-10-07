"use client";

// The per-chat viewer shared by local mode (/) and the vault (/vault):
// header, search, jump bar, message list, stats modal + Wrapped card,
// custom phrase counter, Insights, Replay and Chat Info overlays.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  parseText, formatText, formatDate, escapeHtml, isEmojiOnly,
  initial, avatarColor, computeStatsCached, peekStatsCache,
  formatDuration, DOW, attachment, mediaKind, basename,
} from "../../lib/chat";
import { BRAND_NAME } from "../../lib/brand";
import { IconBack, IconSparkles, IconChart, IconSearch, IconInfo, IconClose, IconUp, IconDown, IconArrowDown } from "./Icons";

// Lazy-loaded heavy views (client-only, no SSR)
const Insights = dynamic(() => import("./Insights"), {
  ssr: false,
  loading: () => <div className="loading-overlay"><div className="spinner" /><div>Crunching your insights…</div></div>,
});
const Replay = dynamic(() => import("./Replay"), { ssr: false });
const ChatInfo = dynamic(() => import("./ChatInfo"), { ssr: false });

/**
 * @param {object}   props
 * @param {{id, name, text, me}|null} props.chat
 * @param {Object<string,string>} props.mediaUrls     filename → URL for inline media
 * @param {Object<string,string>} [props.downloadUrls] filename → URL used for "download" links
 * @param {boolean}  [props.remote]       media come from the network (no preloading)
 * @param {string|{label:string, percent?:number}} [props.loading]
 * @param {Function} [props.onBack]       mobile back button
 * @param {Function} [props.onSetMe]      (senderName) => void
 * @param {Function} [props.onMediaError] a media element failed to load (e.g. expired link)
 * @param {React.ReactNode} [props.emptyState]
 */
export default function ChatViewer({
  chat, mediaUrls = {}, downloadUrls, remote = false, loading = null,
  onBack, onSetMe, onMediaError, emptyState = null,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [matchInfo, setMatchInfo] = useState({ cur: -1, total: 0 });
  const [statsOpen, setStatsOpen] = useState(false);
  const [customPhrase, setCustomPhrase] = useState("");
  const [showToBottom, setShowToBottom] = useState(false);
  const [jump, setJump] = useState(null); // {label, indices, idx, hlRe}
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const chatRef = useRef(null);
  const searchInputRef = useRef(null);
  const marksRef = useRef([]);
  const curIdxRef = useRef(-1);
  const jumpMarksRef = useRef([]);

  // Reset per-chat UI state whenever another chat is opened.
  useEffect(() => {
    setSearchOpen(false); setSearchQ(""); setJump(null); setInfoOpen(false);
    setStatsOpen(false); setInsightsOpen(false); setReplayOpen(false); setCustomPhrase("");
  }, [chat?.id]);

  /* ---------- derived ---------- */
  const messages = useMemo(() => (chat?.text ? parseText(chat.text) : []), [chat?.id, chat?.text]);

  const senders = useMemo(() => {
    const counts = {};
    messages.forEach((m) => { if (m.sender) counts[m.sender] = (counts[m.sender] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [messages]);

  const me = useMemo(() => {
    if (!chat) return "";
    if (chat.me && senders.includes(chat.me)) return chat.me;
    return senders.find((s) => s.toLowerCase() !== String(chat.name).toLowerCase()) || senders[0] || "";
  }, [chat, senders]);

  const mediaCount = Object.keys(mediaUrls).length;
  // Re-render the (expensive) message HTML only when the SET of media changes;
  // refreshed URLs for the same files are patched into the DOM in place below.
  const mediaNamesKey = useMemo(() => Object.keys(mediaUrls).sort().join("\n"), [mediaUrls]);
  const dlUrl = useCallback((name) => (downloadUrls && downloadUrls[name]) || mediaUrls[name], [downloadUrls, mediaUrls]);

  const messagesHtml = useMemo(() => {
    if (!messages.length) return "";
    const preload = remote ? "none" : "metadata";
    let html = "";
    let lastDate = null, lastSender = null, lastType = null;
    messages.forEach((msg, i) => {
      if (msg.date !== lastDate) {
        html += `<div class="day-divider" data-date="${escapeHtml(msg.date)}"><span>${formatDate(msg.date)}</span></div>`;
        lastDate = msg.date; lastSender = null; lastType = null;
      }
      if (msg.system) {
        html += `<div class="system-msg" data-i="${i}"><span>${formatText(msg.text)}</span></div>`;
        lastSender = null; lastType = null;
        return;
      }
      const out = msg.sender === me;
      const first = msg.sender !== lastSender || lastType !== (out ? "out" : "in");
      const showName = !out && first && senders.length > 2;
      const emojiOnly = isEmojiOnly(msg.text);

      // Media attachment — render it inline if we have the file.
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
          body = `<a class="media-file" href="${escapeHtml(dlUrl(name))}" download="${n}"><span class="media-file-ic">📄</span><span>${escapeHtml(att.name)}</span></a>${cap}`;
      } else {
        body = `<span class="msg-text${emojiOnly ? " emoji-only" : ""}">${formatText(msg.text)}</span>`;
      }

      html += `<div class="row ${out ? "out" : "in"}${first ? " first" : ""}" data-i="${i}">
        <div class="bubble">
          ${showName ? `<div class="sender-name" style="color:${avatarColor(msg.sender)}">${escapeHtml(msg.sender)}</div>` : ""}
          ${body}
          <span class="meta">${escapeHtml(msg.time)}${out ? ' <span class="ticks">✓✓</span>' : ""}</span>
        </div>
      </div>`;
      lastSender = msg.sender; lastType = out ? "out" : "in";
    });
    return html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, me, senders, mediaNamesKey, remote]);

  // Swap refreshed media URLs into the existing DOM (keeps scroll position).
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.querySelectorAll("[data-m]").forEach((node) => {
      const url = mediaUrls[node.getAttribute("data-m")];
      if (url && node.getAttribute("src") !== url) node.setAttribute("src", url);
    });
    el.querySelectorAll("[data-mh]").forEach((node) => {
      const url = mediaUrls[node.getAttribute("data-mh")];
      if (url && node.getAttribute("href") !== url) node.setAttribute("href", url);
    });
  }, [mediaUrls]);

  // Report broken media (e.g. an expired signed link) so the parent can refresh.
  useEffect(() => {
    if (!onMediaError) return;
    const onErr = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLImageElement || t instanceof HTMLMediaElement)) return;
      const src = t.currentSrc || t.getAttribute("src") || "";
      if (/^https?:/i.test(src)) onMediaError(src);
    };
    document.addEventListener("error", onErr, true); // media errors don't bubble — capture them
    return () => document.removeEventListener("error", onErr, true);
  }, [onMediaError]);

  /* Stats: cached per chat, computed off the click so the modal opens instantly
     with a loader the first time, and instantly-with-data every time after. */
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!statsOpen || !messages.length) { setStats(null); return; }
    const cached = peekStatsCache(messages);
    if (cached) { setStats(cached); return; }
    setStats(null);
    const t = setTimeout(() => setStats(computeStatsCached(messages)), 30); // let the modal paint first
    return () => clearTimeout(t);
  }, [statsOpen, messages]);

  /* Custom phrase counter: debounced (350ms) + chunked scan over a cached
     lowercase corpus — typing never blocks, big chats show a counting state. */
  const [customStat, setCustomStat] = useState(null);
  const [customBusy, setCustomBusy] = useState(false);
  const corpusRef = useRef(null);
  const scanCancelRef = useRef(null);
  useEffect(() => { corpusRef.current = null; setCustomStat(null); setCustomBusy(false); }, [messages]);
  useEffect(() => {
    scanCancelRef.current?.();
    const q = customPhrase.trim().toLowerCase();
    if (!q || !messages.length) { setCustomStat(null); setCustomBusy(false); return; }
    setCustomBusy(true);
    let cancelled = false;
    scanCancelRef.current = () => { cancelled = true; };
    const deb = setTimeout(() => {
      if (!corpusRef.current) corpusRef.current = messages.map((m) => (m.system ? null : m.text.toLowerCase()));
      const lower = corpusRef.current;
      const perSender = {}, perDay = {}, indices = [];
      let total = 0, i = 0;
      const CHUNK = 25000;
      const step = () => {
        if (cancelled) return;
        const end = Math.min(lower.length, i + CHUNK);
        for (; i < end; i++) {
          const t = lower[i];
          if (!t) continue;
          let at = t.indexOf(q), n = 0;
          while (at !== -1) { n++; at = t.indexOf(q, at + q.length); }
          if (n) {
            total += n;
            if (indices.length < 2000) indices.push(i);
            const m = messages[i];
            perSender[m.sender] = (perSender[m.sender] || 0) + n;
            perDay[m.date] = (perDay[m.date] || 0) + n;
          }
        }
        if (i < lower.length) setTimeout(step, 0); // yield to keep typing smooth
        else {
          const peak = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0] || null;
          setCustomStat({ total, perSender, indices, peakDay: peak ? { date: peak[0], count: peak[1] } : null });
          setCustomBusy(false);
        }
      };
      step();
    }, 350);
    return () => { clearTimeout(deb); cancelled = true; };
  }, [customPhrase, messages]);

  /* ---------- scroll ---------- */
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messagesHtml]);

  const onChatScroll = () => {
    const el = chatRef.current;
    if (el) setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 400);
  };

  /* ---------- jump-to-message (clickable stats) ---------- */
  const scrollToIndex = useCallback((i) => {
    const el = chatRef.current?.querySelector(`[data-i="${i}"] .bubble, .system-msg[data-i="${i}"] span`);
    if (!el) return;
    // smooth scrolling across a 90k-message DOM is very slow — jump instantly on big chats
    el.scrollIntoView({ block: "center", behavior: messages.length > 8000 ? "auto" : "smooth" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1900);
  }, [messages.length]);

  const startJump = useCallback((label, indices, hlRe = null) => {
    if (!indices || !indices.length) return;
    setStatsOpen(false);
    setSearchOpen(false);
    setSearchQ("");
    setJump({ label, indices, idx: 0, hlRe });
    setTimeout(() => scrollToIndex(indices[0]), 80);
  }, [scrollToIndex]);

  /* highlight the matched word/phrase inside jumped-to messages */
  const clearJumpMarks = () => {
    jumpMarksRef.current.forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    jumpMarksRef.current = [];
  };

  useEffect(() => {
    clearJumpMarks();
    if (!jump?.hlRe || !chatRef.current) return;
    const flags = jump.hlRe.flags.includes("g") ? jump.hlRe.flags : jump.hlRe.flags + "g";
    const re = new RegExp(jump.hlRe.source, flags);
    // cap highlighting work on huge match sets — navigation still covers all of them
    for (const idx of jump.indices.slice(0, 400)) {
      const root = chatRef.current.querySelector(`[data-i="${idx}"] .msg-text`);
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.textContent;
        re.lastIndex = 0;
        let m = re.exec(text);
        if (!m) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        while (m) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const mark = document.createElement("mark");
          mark.className = "jhl";
          mark.textContent = m[0] || text.slice(m.index, m.index + 1);
          frag.appendChild(mark);
          last = m.index + (m[0].length || 1);
          if (m[0].length === 0) re.lastIndex++; // safety against zero-length matches
          m = re.exec(text);
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
    jumpMarksRef.current = Array.from(chatRef.current.querySelectorAll("mark.jhl"));
  }, [jump?.label, jump?.hlRe, jump?.indices, messagesHtml]);

  const jumpStep = (dir) => {
    setJump((j) => {
      if (!j) return j;
      const idx = (j.idx + dir + j.indices.length) % j.indices.length;
      scrollToIndex(j.indices[idx]);
      return { ...j, idx };
    });
  };

  const scrollToDate = useCallback((date) => {
    setStatsOpen(false);
    setTimeout(() => {
      const el = chatRef.current?.querySelector(`.day-divider[data-date="${CSS.escape(date)}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 80);
  }, []);

  // build index lists lazily on click
  const phraseIndices = useCallback((re, sender = null, date = null) => {
    const r = new RegExp(re.source, re.flags.replace("g", ""));
    const out = [];
    messages.forEach((m, i) => {
      if (m.system) return;
      if (sender && m.sender !== sender) return;
      if (date && m.date !== date) return;
      if (r.test(m.text)) out.push(i);
    });
    return out;
  }, [messages]);

  /* ---------- message search (direct DOM highlighting) ---------- */
  const unhighlight = () => {
    marksRef.current.forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    marksRef.current = [];
    curIdxRef.current = -1;
  };

  const setCurrent = () => {
    marksRef.current.forEach((m) => m.classList.remove("cur"));
    const m = marksRef.current[curIdxRef.current];
    if (m) {
      m.classList.add("cur");
      m.scrollIntoView({ block: "center", behavior: marksRef.current.length > 500 || messages.length > 8000 ? "auto" : "smooth" });
    }
  };

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const q = searchQ.trim().toLowerCase();
    if (!q || !searchOpen) { unhighlight(); setMatchInfo({ cur: -1, total: 0 }); return; }
    // debounce: walking a huge chat DOM on every keystroke would block typing
    const deb = setTimeout(() => runDomSearch(el, q), messages.length > 8000 ? 350 : 120);
    return () => clearTimeout(deb);
  }, [searchQ, searchOpen, messagesHtml]);

  const runDomSearch = (el, q) => {
    unhighlight();
    el.querySelectorAll(".msg-text, .system-msg span, .sender-name").forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.textContent, lower = text.toLowerCase();
        let i = lower.indexOf(q);
        if (i === -1) continue;
        const frag = document.createDocumentFragment();
        let last = 0;
        while (i !== -1) {
          if (i > last) frag.appendChild(document.createTextNode(text.slice(last, i)));
          const mark = document.createElement("mark");
          mark.className = "hl";
          mark.textContent = text.slice(i, i + q.length);
          frag.appendChild(mark);
          last = i + q.length;
          i = lower.indexOf(q, last);
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    });
    marksRef.current = Array.from(el.querySelectorAll("mark.hl"));
    if (marksRef.current.length) {
      curIdxRef.current = marksRef.current.length - 1;
      setCurrent();
    }
    setMatchInfo({ cur: curIdxRef.current, total: marksRef.current.length });
  };

  const step = (dir) => {
    const n = marksRef.current.length;
    if (!n) return;
    curIdxRef.current = (curIdxRef.current + dir + n) % n;
    setCurrent();
    setMatchInfo({ cur: curIdxRef.current, total: n });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && messages.length) {
        e.preventDefault();
        setJump(null);
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [messages.length]);

  const jumpToMessage = useCallback((i) => {
    setInfoOpen(false);
    setJump(null);
    setTimeout(() => scrollToIndex(i), 90);
  }, [scrollToIndex]);

  /* ---------- Chat Wrapped PNG ---------- */
  const downloadWrapped = () => {
    if (!stats || !chat) return;
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#312e81"); g.addColorStop(.5, "#6d28d9"); g.addColorStop(1, "#c026d3");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(W * 0.8, H * 0.15, 20, W * 0.8, H * 0.15, 600);
    glow.addColorStop(0, "rgba(255,255,255,.22)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    const F = "Inter, -apple-system, 'Segoe UI', sans-serif";
    x.textAlign = "center";
    x.fillStyle = "rgba(255,255,255,.85)";
    x.font = `600 34px ${F}`;
    x.fillText("CHAT WRAPPED", W / 2, 110);
    x.fillStyle = "#fff";
    x.font = `800 72px ${F}`;
    x.fillText(chat.name, W / 2, 205, W - 120);
    x.font = `400 32px ${F}`;
    x.fillStyle = "rgba(255,255,255,.85)";
    x.fillText(`${formatDate(stats.first)}  —  ${formatDate(stats.last)}`, W / 2, 258);

    x.fillStyle = "#fff";
    x.font = `800 150px ${F}`;
    x.fillText(stats.total.toLocaleString(), W / 2, 430);
    x.font = `400 36px ${F}`;
    x.fillText("messages", W / 2, 482);

    const cards = [
      [`${stats.words.toLocaleString()}`, "words"],
      [`${stats.streak}`, "day streak 🔥"],
      [`${stats.avgPerDay}`, "msgs / day"],
      [`${stats.media}`, "media 📎"],
    ];
    cards.forEach(([v, l], i) => {
      const cw = 460, ch = 150, gx = 40;
      const cx = W / 2 + (i % 2 === 0 ? -cw - gx / 2 : gx / 2);
      const cy = 540 + Math.floor(i / 2) * (ch + 26);
      x.fillStyle = "rgba(255,255,255,.13)";
      x.beginPath(); x.roundRect(cx, cy, cw, ch, 26); x.fill();
      x.fillStyle = "#fff";
      x.font = `800 54px ${F}`;
      x.fillText(v, cx + cw / 2, cy + 72);
      x.font = `400 28px ${F}`;
      x.fillStyle = "rgba(255,255,255,.85)";
      x.fillText(l, cx + cw / 2, cy + 116);
    });

    let y = 940;
    if (stats.loveScore) {
      x.fillStyle = "rgba(255,255,255,.18)";
      x.beginPath(); x.roundRect(W / 2 - 480, y - 60, 960, 120, 28); x.fill();
      x.fillStyle = "#fff";
      x.font = `700 46px ${F}`;
      x.fillText(`❤️ Love score: ${stats.loveScore.score} / 100`, W / 2, y + 16);
      y += 130;
    }
    const sortedCounts = Object.entries(stats.counts).sort((p, q) => q[1] - p[1]);
    if (sortedCounts.length >= 2) {
      const [a, b] = sortedCounts;
      x.font = `400 34px ${F}`;
      x.fillStyle = "rgba(255,255,255,.9)";
      x.fillText(`${a[0]}: ${a[1].toLocaleString()}   ·   ${b[0]}: ${b[1].toLocaleString()}`, W / 2, y + 10, W - 100);
      y += 70;
    }
    if (stats.topEmojis.length) {
      x.font = `400 58px ${F}`;
      x.fillStyle = "#fff";
      x.fillText(stats.topEmojis.slice(0, 6).map(([e]) => e).join("  "), W / 2, y + 30);
    }
    x.font = `500 26px ${F}`;
    x.fillStyle = "rgba(255,255,255,.65)";
    x.fillText(`made with ${BRAND_NAME}`, W / 2, H - 50);

    const link = document.createElement("a");
    link.download = `${chat.name.replace(/\s+/g, "-")}-wrapped.png`;
    link.href = c.toDataURL("image/png");
    link.click();
  };

  /* ---------- fun facts ---------- */
  const funFacts = useMemo(() => {
    if (!stats || senders.length < 2) return [];
    const facts = [];
    const [a, b] = senders;
    const pick = (per) => {
      const ea = per?.[a] || 0, eb = per?.[b] || 0;
      if (ea === eb) return null;
      return ea > eb ? [a, ea, b, eb] : [b, eb, a, ea];
    };
    const sorry = stats.phrases.find((p) => p.key === "sorry");
    if (sorry?.total) {
      const w = pick(sorry.perSender);
      if (w) facts.push({
        node: <>🙏 <b>{w[0]}</b> says sorry more ({w[1]} vs {w[3]}) — the peacemaker!</>,
        onClick: () => startJump(`🙏 Sorry — ${w[0]}`, phraseIndices(sorry.re, w[0]), sorry.re),
      });
    }
    const love = stats.phrases.find((p) => p.key === "iloveyou");
    if (love?.total) {
      const w = pick(love.perSender);
      if (w) facts.push({
        node: <>❤️ <b>{w[0]}</b> says &quot;I love you&quot; more ({w[1]} vs {w[3]}).</>,
        onClick: () => startJump(`❤️ I love you — ${w[0]}`, phraseIndices(love.re, w[0]), love.re),
      });
    }
    const starter = Object.entries(stats.firstOfDay || {}).sort((x, y) => y[1] - x[1])[0];
    if (starter) facts.push({ node: <>💬 <b>{starter[0]}</b> starts the conversation most days ({starter[1]} days).</> });
    const dbl = pick(stats.doubleTexts);
    if (dbl) facts.push({ node: <>📲 <b>{dbl[0]}</b> double-texts more ({dbl[1]} vs {dbl[3]}) — the chaser 😄</> });
    const ender = pick(stats.enders);
    if (ender) facts.push({ node: <>🔚 <b>{ender[0]}</b> ends conversations more often ({ender[1]} vs {ender[3]}).</> });
    if (stats.streak > 1) facts.push({
      node: <>🔥 Longest streak: <b>{stats.streak} days</b> non-stop (ending {formatDate(stats.streakEnd)}).</>,
      onClick: () => scrollToDate(stats.streakEnd),
    });
    if (stats.longest) facts.push({
      node: <>📜 Longest message: <b>{stats.longest.sender}</b> — {stats.longest.words} words.</>,
      onClick: () => startJump("📜 Longest message", [stats.longest.index]),
    });
    if (stats.slowestReply) facts.push({
      node: <>🐢 Slowest reply: <b>{stats.slowestReply.sender}</b> took {formatDuration(stats.slowestReply.ms)}.</>,
      onClick: () => startJump("🐢 Slowest reply", [stats.slowestReply.index]),
    });
    return facts;
  }, [stats, senders, startJump, scrollToDate, phraseIndices]);

  const maxHeat = stats ? Math.max(1, ...stats.heatmap.flat()) : 1;
  const maxMonthly = stats?.monthly.length ? Math.max(...stats.monthly.map((m) => m.count)) : 1;

  const loadingLabel = loading ? (typeof loading === "string" ? loading : loading.label) : null;
  const loadingPct = loading && typeof loading === "object" && loading.percent != null ? loading.percent : null;

  /* ================= render ================= */
  return (
    <main className="main">
      {(chat || loadingLabel) && (
        <div className="header">
          <button className="back-btn icon-btn" title="Back to chats" onClick={onBack}><IconBack size={22} /></button>
          <div
            className={`header-id${chat ? " clickable" : ""}`}
            onClick={() => chat && setInfoOpen(true)}
            title={chat ? "Chat info — media, links & docs" : undefined}
          >
            <div className="avatar" style={chat ? { background: avatarColor(chat.name) } : {}}>
              {chat ? initial(chat.name) : "…"}
            </div>
            <div className="header-info">
              <h2>{chat ? chat.name : "Opening chat…"}</h2>
              <p>
                {chat
                  ? `${messages.length.toLocaleString()} messages${mediaCount ? ` · ${mediaCount.toLocaleString()} media` : ""} · tap for info`
                  : loadingLabel}
              </p>
            </div>
          </div>
          {chat && senders.length > 1 && (
            <select className="me-select" value={me} onChange={(e) => onSetMe?.(e.target.value)} title="Which sender is you? (shown on the right)">
              {senders.map((s) => <option key={s} value={s}>Me: {s}</option>)}
            </select>
          )}
          {chat && (
            <div className="header-actions">
              <button className="icon-btn" title="Insights dashboard" onClick={() => setInsightsOpen(true)}><IconSparkles /></button>
              <button className="icon-btn" title="Chat statistics" onClick={() => setStatsOpen(true)}><IconChart /></button>
              <button
                className={`icon-btn${searchOpen ? " active" : ""}`} title="Search messages (Ctrl/⌘+F)"
                onClick={() => {
                  const next = !searchOpen;
                  setJump(null);
                  setSearchOpen(next);
                  if (next) setTimeout(() => searchInputRef.current?.focus(), 0);
                  else setSearchQ("");
                }}
              ><IconSearch /></button>
              <button className="icon-btn hide-sm" title="Chat info — media, links & docs" onClick={() => setInfoOpen(true)}><IconInfo /></button>
            </div>
          )}
        </div>
      )}

      {searchOpen && chat && (
        <div className="search-bar">
          <IconSearch size={17} className="search-ic" />
          <input
            ref={searchInputRef}
            placeholder="Search messages…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
              if (e.key === "Escape") { setSearchOpen(false); setSearchQ(""); }
            }}
          />
          <span className="count">
            {searchQ.trim() ? (matchInfo.total ? `${matchInfo.cur + 1} of ${matchInfo.total}` : "No results") : ""}
          </span>
          <button title="Previous match (older)" disabled={matchInfo.total < 2} onClick={() => step(-1)}><IconUp size={18} /></button>
          <button title="Next match (newer)" disabled={matchInfo.total < 2} onClick={() => step(1)}><IconDown size={18} /></button>
          <button title="Close search" onClick={() => { setSearchOpen(false); setSearchQ(""); }}><IconClose size={18} /></button>
        </div>
      )}

      {jump && chat && (
        <div className="search-bar">
          <span className="jump-label">{jump.label}</span>
          <span className="count">{jump.idx + 1} of {jump.indices.length}</span>
          <button title="Previous" disabled={jump.indices.length < 2} onClick={() => jumpStep(-1)}><IconUp size={18} /></button>
          <button title="Next" disabled={jump.indices.length < 2} onClick={() => jumpStep(1)}><IconDown size={18} /></button>
          <button title="Back to statistics" onClick={() => { setJump(null); setStatsOpen(true); }}><IconChart size={18} /></button>
          <button title="Close" onClick={() => setJump(null)}><IconClose size={18} /></button>
        </div>
      )}

      {loadingLabel && !chat ? (
        <div className="chat chat-center">
          <div className="opening-card">
            <div className="spinner" />
            <div className="opening-title">{loadingLabel}</div>
            {loadingPct != null && (
              <div className="progress-track small"><div className="progress-fill" style={{ width: `${Math.round(loadingPct)}%` }} /></div>
            )}
          </div>
        </div>
      ) : chat ? (
        <div className="chat" ref={chatRef} onScroll={onChatScroll} dangerouslySetInnerHTML={{ __html: messagesHtml }} />
      ) : (
        <div className="chat chat-center">{emptyState}</div>
      )}

      {showToBottom && chat && (
        <button
          className="to-bottom" title="Scroll to latest"
          onClick={() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })}
        ><IconArrowDown size={18} /></button>
      )}

      {/* ============ Insights dashboard (lazy) ============ */}
      {insightsOpen && chat && (
        <Insights
          chatName={chat.name}
          messages={messages}
          senders={senders}
          onJump={startJump}
          onJumpDate={scrollToDate}
          onReplay={() => setReplayOpen(true)}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {/* ============ Chat replay (lazy) ============ */}
      {replayOpen && chat && (
        <Replay chatName={chat.name} messages={messages} me={me} onClose={() => setReplayOpen(false)} />
      )}

      {/* ============ Chat info · media / links / docs (lazy) ============ */}
      {infoOpen && chat && (
        <ChatInfo
          chatName={chat.name}
          messages={messages}
          mediaUrls={mediaUrls}
          downloadUrls={downloadUrls}
          remote={remote}
          onJump={jumpToMessage}
          onClose={() => setInfoOpen(false)}
        />
      )}

      {/* ============ Stats modal ============ */}
      {statsOpen && !stats && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setStatsOpen(false); }}>
          <div className="modal" style={{ textAlign: "center", padding: "44px 22px" }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>Crunching {messages.length.toLocaleString()} messages…<br /><small>only the first time — it&apos;s cached after this</small></div>
          </div>
        </div>
      )}
      {statsOpen && stats && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setStatsOpen(false); }}>
          <div className="modal">
            <h3>
              Chat statistics
              <button className="icon-btn" onClick={() => setStatsOpen(false)}><IconClose /></button>
            </h3>
            <div className="hint">Tip: click any stat to jump to the matching messages 👆</div>

            {stats.loveScore && (
              <div className="love-score">
                <div className="big">{stats.loveScore.score}<small>/100</small></div>
                <div className="parts">
                  <span>⚖️ Balance {stats.loveScore.parts.balance}%</span>
                  <span>❤️ Love words {stats.loveScore.parts.love}%</span>
                  <span>⚡ Reply speed {stats.loveScore.parts.speed}%</span>
                  <span>📅 Consistency {stats.loveScore.parts.consistency}%</span>
                </div>
              </div>
            )}

            <button className="wrapped-btn" onClick={downloadWrapped}>🎁 Download &quot;Chat Wrapped&quot; card (PNG)</button>

            <div className="stat-grid">
              <div className="stat-card"><div className="val">{stats.total.toLocaleString()}</div><div className="lbl">Messages</div></div>
              <div className="stat-card"><div className="val">{stats.words.toLocaleString()}</div><div className="lbl">Words</div></div>
              <div className="stat-card"><div className="val">{stats.media}</div><div className="lbl">Media</div></div>
              <div className="stat-card"><div className="val">{stats.links}</div><div className="lbl">Links</div></div>
              <div className="stat-card"><div className="val">{stats.activeDays}</div><div className="lbl">Active days</div></div>
              <div className="stat-card"><div className="val">{stats.avgPerDay}</div><div className="lbl">Msgs / day</div></div>
            </div>

            <div className="section-title">Messages per person</div>
            {Object.entries(stats.counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <div className="sender-row" key={s}>
                <div className="top"><span>{s}</span><span>{n.toLocaleString()} ({Math.round((n / stats.total) * 100)}%)</span></div>
                <div className="bar-bg">
                  <div className="bar" style={{ width: `${Math.round((n / Math.max(...Object.values(stats.counts))) * 100)}%` }} />
                </div>
              </div>
            ))}

            {Object.keys(stats.replyAvg).length > 0 && (
              <>
                <div className="section-title">⚡ Reply times</div>
                <table className="mini-table"><tbody>
                  {Object.entries(stats.replyAvg).sort((a, b) => a[1] - b[1]).map(([s, ms]) => (
                    <tr key={s}><td>{s} — average reply ({stats.replyCounts[s]} replies)</td><td>{formatDuration(ms)}</td></tr>
                  ))}
                  {stats.slowestReply && (
                    <tr className="clickable" onClick={() => startJump("🐢 Slowest reply", [stats.slowestReply.index])}>
                      <td>🐢 Slowest reply — {stats.slowestReply.sender}</td>
                      <td>{formatDuration(stats.slowestReply.ms)}</td>
                    </tr>
                  )}
                </tbody></table>
              </>
            )}

            <div className="section-title">🤝 Chat dynamics</div>
            <table className="mini-table"><tbody>
              {Object.entries(stats.firstOfDay).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <tr key={"f" + s}><td>💬 {s} texted first</td><td>{n} days</td></tr>
              ))}
              {Object.entries(stats.doubleTexts).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <tr key={"d" + s}><td>📲 {s} double-texted</td><td>{n}×</td></tr>
              ))}
              {Object.entries(stats.enders).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <tr key={"e" + s}><td>🔚 {s} ended the conversation</td><td>{n}×</td></tr>
              ))}
            </tbody></table>

            <div className="section-title">📵 Days you didn&apos;t talk</div>
            <div className="stat-grid">
              <div className="stat-card"><div className="val">{stats.missedDays}</div><div className="lbl">Missed days</div></div>
              <div className="stat-card"><div className="val">{stats.talkedPct}%</div><div className="lbl">Days you talked</div></div>
              <div className="stat-card"><div className="val">{stats.spanDays}</div><div className="lbl">Total days span</div></div>
            </div>
            {stats.topGaps.length > 0 ? (
              <table className="mini-table"><tbody>
                {stats.topGaps.map((g, i) => (
                  <tr key={i} className="clickable" onClick={() => scrollToDate(g.to)}>
                    <td>🤫 No chat for <b>{g.days} day{g.days > 1 ? "s" : ""}</b> — {formatDate(g.from)} → {formatDate(g.to)}</td>
                    <td>open →</td>
                  </tr>
                ))}
              </tbody></table>
            ) : (
              <div className="fun-fact" style={{ color: "var(--text-secondary)" }}>You never skipped a day 🔥</div>
            )}

            <div className="section-title">💕 Love &amp; sorry meter</div>
            {stats.phrases.filter((p) => p.total > 0).map((p) => (
              <div
                className="phrase-card clickable" key={p.key}
                onClick={() => startJump(`${p.emoji} ${p.label}`, p.indices, p.re)}
                title="Click to jump to these messages"
              >
                <div className="head">
                  <span className="title">{p.emoji} {p.label}</span>
                  <span className="total">{p.total}×</span>
                </div>
                <div className="split">
                  {Object.entries(p.perSender).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                    <span
                      key={s} className="clickable"
                      onClick={(e) => { e.stopPropagation(); startJump(`${p.emoji} ${p.label} — ${s}`, phraseIndices(p.re, s), p.re); }}
                    ><b>{s}</b>: {n}×</span>
                  ))}
                </div>
                {p.peakDay && (
                  <div
                    className="peak clickable"
                    onClick={(e) => { e.stopPropagation(); startJump(`${p.emoji} ${p.label} — ${formatDate(p.peakDay.date)}`, phraseIndices(p.re, null, p.peakDay.date), p.re); }}
                  >📅 Peak day: {formatDate(p.peakDay.date)} ({p.peakDay.count}×)</div>
                )}
              </div>
            ))}
            {stats.phrases.every((p) => !p.total) && (
              <div className="fun-fact" style={{ color: "var(--text-secondary)" }}>
                No love/sorry phrases found in this chat yet 🙂
              </div>
            )}

            <div className="section-title">🔎 Count any word or phrase</div>
            <div className="custom-phrase">
              <input
                placeholder='e.g. "Mujy ap sy bht mohbbat ha"'
                value={customPhrase}
                onChange={(e) => setCustomPhrase(e.target.value)}
              />
            </div>
            {customBusy && <div className="hint" style={{ marginTop: 6 }}>⏳ counting…</div>}
            {customStat && (
              <div
                className={`phrase-card${customStat.total ? " clickable" : ""}`}
                onClick={() => customStat.total && startJump(
                  `🔎 "${customPhrase.trim()}"`, customStat.indices,
                  new RegExp(customPhrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
                )}
              >
                <div className="head">
                  <span className="title">&quot;{customPhrase.trim()}&quot;</span>
                  <span className="total">{customStat.total}×</span>
                </div>
                <div className="split">
                  {Object.entries(customStat.perSender).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                    <span key={s}><b>{s}</b>: {n}×</span>
                  ))}
                  {!customStat.total && <span>Not found in this chat</span>}
                </div>
                {customStat.peakDay && (
                  <div className="peak">📅 Peak day: {formatDate(customStat.peakDay.date)} ({customStat.peakDay.count}×)</div>
                )}
              </div>
            )}

            {stats.milestones.length > 0 && (
              <>
                <div className="section-title">🏆 Milestones</div>
                {stats.milestones.map((m, i) => (
                  <div key={i} className="milestone clickable" onClick={() => startJump(m.label, [m.index])}>
                    <span>{m.label}</span>
                    <span className="when">{m.detail}</span>
                  </div>
                ))}
              </>
            )}

            {funFacts.length > 0 && (
              <>
                <div className="section-title">✨ Fun facts</div>
                <div className="fun-fact">
                  {funFacts.map((f, i) => (
                    <div key={i} className={f.onClick ? "clickable" : ""} onClick={f.onClick}>{f.node}</div>
                  ))}
                </div>
              </>
            )}

            <div className="section-title">🕐 When you talk (heatmap)</div>
            <div className="heatmap-wrap">
              <div className="heatmap">
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={"h" + h} className="hour">{h % 6 === 0 ? h : ""}</div>
                ))}
                {stats.heatmap.map((row, d) => [
                  <div key={"d" + d} className="dow">{DOW[d]}</div>,
                  ...row.map((v, h) => (
                    <div
                      key={`${d}-${h}`} className="cell"
                      title={`${DOW[d]} ${h}:00 — ${v} messages`}
                      style={v ? { background: `rgba(var(--accent-rgb), ${0.15 + 0.85 * (v / maxHeat)})` } : {}}
                    />
                  )),
                ])}
              </div>
            </div>

            {stats.monthly.length > 1 && (
              <>
                <div className="section-title">📈 Messages over time</div>
                <div className="chart">
                  {stats.monthly.map((m) => (
                    <div
                      key={m.key} className="bar-col"
                      title={`${m.label}: ${m.count} messages — click to jump`}
                      onClick={() => startJump(`📈 ${m.label}`, [m.firstIndex])}
                    >
                      <div className="vbar" style={{ height: `${Math.max(3, Math.round((m.count / maxMonthly) * 90))}%` }} />
                      <div className="xlab">{m.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {Object.keys(stats.topWords).length > 0 && (
              <>
                <div className="section-title">🗣 Favorite words</div>
                {Object.entries(stats.topWords).map(([s, words]) => (
                  <div key={s}>
                    <div className="word-person">{s}</div>
                    <div className="word-chips">
                      {words.map(([w, n]) => (
                        <span
                          key={w} className="clickable"
                          onClick={() => {
                            const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
                            startJump(`🗣 "${w}" — ${s}`, phraseIndices(re, s), re);
                          }}
                        >{w}<small>×{n}</small></span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {stats.topEmojis.length > 0 && (
              <>
                <div className="section-title">Top emojis</div>
                <div className="emoji-cloud">
                  {stats.topEmojis.map(([e, n]) => (
                    <span key={e} className="clickable" onClick={() => startJump(`${e} messages`, stats.emojiIdx[e] || [], new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"))}>
                      {e}<small>×{n}</small>
                    </span>
                  ))}
                </div>
              </>
            )}

            <div className="section-title">Timeline</div>
            <div className="fun-fact">
              First message: <b className="clickable" onClick={() => scrollToDate(stats.first)}>{formatDate(stats.first)}</b><br />
              Last message: <b className="clickable" onClick={() => scrollToDate(stats.last)}>{formatDate(stats.last)}</b><br />
              Busiest day:{" "}
              <b className="clickable" onClick={() => stats.busiest && scrollToDate(stats.busiest[0])}>
                {stats.busiest ? `${formatDate(stats.busiest[0])} (${stats.busiest[1]} messages)` : "—"}
              </b>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
