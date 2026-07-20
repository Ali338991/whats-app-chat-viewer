"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

// Lazy-loaded heavy views (client-only, no SSR)
const Insights = dynamic(() => import("./components/Insights"), { ssr: false, loading: () => <div className="loading-overlay"><div className="spinner" /><div>Crunching your insights…</div></div> });
const Replay = dynamic(() => import("./components/Replay"), { ssr: false });
import {
  parseText, formatText, formatDate, escapeHtml, isEmojiOnly,
  initial, avatarColor, previewText, computeStats, countPhrase,
  formatDuration, DOW,
} from "../lib/chat";

const STORE_KEY = "wa_viewer_chats";
const THEME_KEY = "wa_viewer_theme";
const BACKUP_KEY = "wa_viewer_cloud_backup"; // "on" | "off" | absent = not asked yet

export default function Home() {
  const [chats, setChats] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [dark, setDark] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [matchInfo, setMatchInfo] = useState({ cur: -1, total: 0 });
  const [statsOpen, setStatsOpen] = useState(false);
  const [customPhrase, setCustomPhrase] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupPref, setBackupPref] = useState("off"); // "on" | "off" | null (never asked)
  const [uploadStatus, setUploadStatus] = useState({}); // chatId -> "uploading" | "done" | "error"
  const [showToBottom, setShowToBottom] = useState(false);
  const [jump, setJump] = useState(null); // {label, indices, idx}
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);

  const chatRef = useRef(null);
  const fileRef = useRef(null);
  const searchInputRef = useRef(null);
  const marksRef = useRef([]);
  const curIdxRef = useRef(-1);
  const jumpMarksRef = useRef([]);
  const dragDepth = useRef(0);
  const chatsRef = useRef([]);
  const cloudBackupRef = useRef(false);

  /* ---------- storage ---------- */
  useEffect(() => {
    try { setChats(JSON.parse(localStorage.getItem(STORE_KEY)) || []); } catch {}
    try { setDark(localStorage.getItem(THEME_KEY) === "dark"); } catch {}
    try { setBackupPref(localStorage.getItem(BACKUP_KEY)); } catch { setBackupPref(null); }
    setLoaded(true);
  }, []);

  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { cloudBackupRef.current = backupPref === "on"; }, [backupPref]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(chats)); }
    catch {
      alert("Browser storage is full — the chat is open for viewing but could not be saved. Try deleting an older chat.");
    }
  }, [chats, loaded]);

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
  }, [dark]);

  /* ---------- derived ---------- */
  const activeChat = chats.find((c) => c.id === activeId) || null;

  const messages = useMemo(
    () => (activeChat ? parseText(activeChat.text) : []),
    [activeChat?.id, activeChat?.text]
  );

  const senders = useMemo(() => {
    const counts = {};
    messages.forEach((m) => { if (m.sender) counts[m.sender] = (counts[m.sender] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }, [messages]);

  const me = useMemo(() => {
    if (!activeChat) return "";
    if (activeChat.me && senders.includes(activeChat.me)) return activeChat.me;
    return senders.find((s) => s.toLowerCase() !== activeChat.name.toLowerCase()) || senders[0] || "";
  }, [activeChat, senders]);

  const messagesHtml = useMemo(() => {
    if (!messages.length) return "";
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
      html += `<div class="row ${out ? "out" : "in"}${first ? " first" : ""}" data-i="${i}">
        <div class="bubble">
          ${showName ? `<div class="sender-name">${escapeHtml(msg.sender)}</div>` : ""}
          <span class="msg-text${emojiOnly ? " emoji-only" : ""}">${formatText(msg.text)}</span>
          <span class="meta">${escapeHtml(msg.time)}${out ? ' <span class="ticks">✓✓</span>' : ""}</span>
        </div>
      </div>`;
      lastSender = msg.sender; lastType = out ? "out" : "in";
    });
    return html;
  }, [messages, me, senders]);

  const stats = useMemo(
    () => (statsOpen && messages.length ? computeStats(messages) : null),
    [statsOpen, messages]
  );

  const customStat = useMemo(() => {
    const q = customPhrase.trim();
    if (!q || !messages.length) return null;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return countPhrase(messages, re);
  }, [customPhrase, messages]);

  /* ---------- cloud backup (signed, server-side; opt-in once via banner) ---------- */
  const uploadToCloud = useCallback(async (chat) => {
    if (!cloudBackupRef.current) return;
    setUploadStatus((s) => ({ ...s, [chat.id]: "uploading" }));
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: chat.name, id: chat.id, text: chat.text }),
      });
      if (!res.ok) throw new Error("upload failed");
      setUploadStatus((s) => ({ ...s, [chat.id]: "done" }));
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, backedUp: true } : c)));
    } catch {
      setUploadStatus((s) => ({ ...s, [chat.id]: "error" }));
    }
  }, []);

  const setBackup = (pref) => {
    setBackupPref(pref);
    try { localStorage.setItem(BACKUP_KEY, pref); } catch {}
    cloudBackupRef.current = pref === "on";
    if (pref === "on") {
      chatsRef.current.filter((c) => !c.backedUp).forEach((c) => uploadToCloud(c));
    }
  };

  const cloudBackup = backupPref === "on";
  const showBackupBanner = loaded && backupPref !== "on" && backupPref !== "off" && chats.length > 0;
  const uploadingCount = Object.values(uploadStatus).filter((s) => s === "uploading").length;

  /* ---------- import ---------- */
  const importFiles = useCallback((fileList) => {
    const files = Array.from(fileList).filter((f) => /\.txt$/i.test(f.name));
    if (!files.length) { alert("Please select .txt files exported from WhatsApp."); return; }
    setImporting(true);
    let remaining = files.length;
    const finishOne = () => { if (--remaining <= 0) setImporting(false); };
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onerror = finishOne;
      reader.onload = () => {
        // defer heavy parsing a tick so the loader can paint first
        setTimeout(() => {
          try {
            const text = String(reader.result);
            const msgs = parseText(text);
            if (!msgs.length) { alert(`"${f.name}" doesn't look like a WhatsApp chat export — skipped.`); return; }
            const name = f.name.replace(/^WhatsApp Chat with /i, "").replace(/\.txt$/i, "");
            const last = [...msgs].reverse().find((m) => !m.system);
            const existing = chatsRef.current.find((c) => c.name === name);
            const id = existing ? existing.id : Date.now() + "_" + Math.random().toString(36).slice(2, 7);
            const entry = {
              id, name, text,
              addedAt: Date.now(),
              me: existing?.me || null,
              count: msgs.length,
              preview: last ? previewText(last) : "",
              lastDate: msgs[msgs.length - 1].date,
            };
            setChats((prev) =>
              prev.some((c) => c.id === id) ? prev.map((c) => (c.id === id ? entry : c)) : [entry, ...prev]
            );
            setActiveId(id);
            setMobileOpen(true);
            uploadToCloud(entry); // no-op unless the user enabled cloud backup
          } finally {
            finishOne();
          }
        }, 30);
      };
      reader.readAsText(f, "utf-8");
    });
  }, [uploadToCloud]);

  /* ---------- drag & drop ---------- */
  useEffect(() => {
    const enter = (e) => { e.preventDefault(); dragDepth.current++; setDragging(true); };
    const leave = (e) => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } };
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);

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
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1900);
  }, []);

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
    for (const idx of jump.indices) {
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
      m.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    unhighlight();
    const q = searchQ.trim().toLowerCase();
    if (!q || !searchOpen) { setMatchInfo({ cur: -1, total: 0 }); return; }
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
  }, [searchQ, searchOpen, messagesHtml]);

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

  /* ---------- actions ---------- */
  const openChat = (id) => {
    setActiveId(id);
    setMobileOpen(true);
    setSearchOpen(false);
    setSearchQ("");
    setJump(null);
  };

  const deleteChat = (e, c) => {
    e.stopPropagation();
    if (!confirm(`Delete "${c.name}" from saved chats?`)) return;
    setChats((prev) => prev.filter((x) => x.id !== c.id));
    if (activeId === c.id) { setActiveId(null); setMobileOpen(false); setJump(null); }
  };

  const setMe = (val) => {
    setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, me: val } : c)));
  };

  const shownChats = chats.filter(
    (c) => !listQuery.trim() ||
      c.name.toLowerCase().includes(listQuery.trim().toLowerCase()) ||
      (c.preview || "").toLowerCase().includes(listQuery.trim().toLowerCase())
  );

  const storageKb = useMemo(() => {
    try { return Math.round(((localStorage.getItem(STORE_KEY) || "").length * 2) / 1024); }
    catch { return 0; }
  }, [chats]);

  /* ---------- Chat Wrapped PNG ---------- */
  const downloadWrapped = () => {
    if (!stats || !activeChat) return;
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#075e54"); g.addColorStop(.55, "#0b7d6c"); g.addColorStop(1, "#00a884");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = "rgba(255,255,255,.08)";
    for (let i = 0; i < 26; i++) {
      x.beginPath();
      x.arc((i * 173) % W, (i * 311) % H, 14 + (i % 5) * 9, 0, Math.PI * 2);
      x.fill();
    }
    x.textAlign = "center";
    x.fillStyle = "#fff";
    x.font = "600 44px -apple-system, 'Segoe UI', sans-serif";
    x.fillText("💬 CHAT WRAPPED", W / 2, 110);
    x.font = "800 74px -apple-system, 'Segoe UI', sans-serif";
    x.fillText(activeChat.name, W / 2, 210);
    x.font = "400 32px -apple-system, 'Segoe UI', sans-serif";
    x.fillStyle = "rgba(255,255,255,.85)";
    x.fillText(`${formatDate(stats.first)}  —  ${formatDate(stats.last)}`, W / 2, 262);

    x.fillStyle = "#fff";
    x.font = "800 150px -apple-system, 'Segoe UI', sans-serif";
    x.fillText(stats.total.toLocaleString(), W / 2, 430);
    x.font = "400 36px -apple-system, 'Segoe UI', sans-serif";
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
      x.beginPath(); x.roundRect(cx, cy, cw, ch, 22); x.fill();
      x.fillStyle = "#fff";
      x.font = "800 54px -apple-system, 'Segoe UI', sans-serif";
      x.fillText(v, cx + cw / 2, cy + 72);
      x.font = "400 28px -apple-system, 'Segoe UI', sans-serif";
      x.fillStyle = "rgba(255,255,255,.85)";
      x.fillText(l, cx + cw / 2, cy + 116);
    });

    let y = 940;
    if (stats.loveScore) {
      x.fillStyle = "rgba(233,30,99,.85)";
      x.beginPath(); x.roundRect(W / 2 - 480, y - 60, 960, 120, 24); x.fill();
      x.fillStyle = "#fff";
      x.font = "700 46px -apple-system, 'Segoe UI', sans-serif";
      x.fillText(`❤️ Love score: ${stats.loveScore.score} / 100`, W / 2, y + 16);
      y += 130;
    }
    const sortedCounts = Object.entries(stats.counts).sort((p, q) => q[1] - p[1]);
    if (sortedCounts.length >= 2) {
      const [a, b] = sortedCounts;
      x.font = "400 34px -apple-system, 'Segoe UI', sans-serif";
      x.fillStyle = "rgba(255,255,255,.9)";
      x.fillText(`${a[0]}: ${a[1].toLocaleString()}   ·   ${b[0]}: ${b[1].toLocaleString()}`, W / 2, y + 10);
      y += 70;
    }
    if (stats.topEmojis.length) {
      x.font = "400 58px -apple-system, 'Segoe UI', sans-serif";
      x.fillStyle = "#fff";
      x.fillText(stats.topEmojis.slice(0, 6).map(([e]) => e).join("  "), W / 2, y + 30);
    }
    x.font = "400 26px -apple-system, 'Segoe UI', sans-serif";
    x.fillStyle = "rgba(255,255,255,.6)";
    x.fillText("made with WhatsApp Chat Viewer", W / 2, H - 50);

    const link = document.createElement("a");
    link.download = `${activeChat.name.replace(/\s+/g, "-")}-wrapped.png`;
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

  /* ================= render ================= */
  return (
    <div className={`app${mobileOpen ? " chat-open" : ""}`}>
      {/* ============ Sidebar ============ */}
      <aside className="sidebar">
        <div className="side-header">
          <h1>Chats</h1>
          <button
            className={`icon-btn${cloudBackup ? " active" : ""}`}
            title={cloudBackup ? "Cloud sync is ON — imported chats are backed up to the cloud. Click to turn off." : "Enable cloud sync (backs up your chats to the cloud)"}
            onClick={() => setBackup(cloudBackup ? "off" : "on")}
          >{cloudBackup ? "☁️" : "☁"}</button>
          <button className="icon-btn" title="Toggle dark mode" onClick={() => setDark(!dark)}>
            {dark ? "☀️" : "🌙"}
          </button>
          <button className="icon-btn" title="Import chat file(s)" onClick={() => fileRef.current?.click()}>➕</button>
          <input
            type="file" accept=".txt" multiple hidden ref={fileRef}
            onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
        <div className="side-search">
          <input placeholder="Search chats…" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
        </div>
        {showBackupBanner && (
          <div className="backup-banner">
            <div className="txt">☁️ <b>Keep a cloud backup?</b> Your imported chats will be securely uploaded to our cloud so you can restore them anytime. You&apos;ll only be asked once.</div>
            <div className="btns">
              <button className="yes" onClick={() => setBackup("on")}>Enable sync</button>
              <button className="no" onClick={() => setBackup("off")}>No thanks</button>
            </div>
          </div>
        )}
        <div className="chat-list">
          {!chats.length ? (
            <div className="side-empty">
              <div className="big">📥</div>
              No chats yet.<br />Click ➕ above or drag &amp; drop exported .txt files anywhere on this page.
            </div>
          ) : !shownChats.length ? (
            <div className="side-empty">No chats match &quot;{listQuery}&quot;</div>
          ) : (
            shownChats.map((c) => (
              <div key={c.id} className={`chat-item${c.id === activeId ? " active" : ""}`} onClick={() => openChat(c.id)}>
                <div className="avatar" style={{ background: avatarColor(c.name) }}>{initial(c.name)}</div>
                <div className="info">
                  <div className="top-line">
                    <span className="name">
                      {c.name}
                      {uploadStatus[c.id] === "uploading" && <span className="cloud-badge" title="Syncing to cloud…">☁️ syncing…</span>}
                      {uploadStatus[c.id] === "error" && <span className="cloud-badge err" title="Cloud sync failed — will retry on next import">☁️⚠️</span>}
                      {c.backedUp && uploadStatus[c.id] !== "uploading" && uploadStatus[c.id] !== "error" && (
                        <span className="cloud-badge" title="Synced to cloud">☁️✓</span>
                      )}
                    </span>
                    <span className="date">{formatDate(c.lastDate)}</span>
                  </div>
                  <div className="preview">{c.preview}</div>
                </div>
                <button className="del" title="Delete chat" onClick={(e) => deleteChat(e, c)}>🗑</button>
              </div>
            ))
          )}
        </div>
        <div className="storage-note">
          {uploadingCount > 0 && <span className="cloud-status">☁️ Syncing {uploadingCount} chat{uploadingCount > 1 ? "s" : ""} to cloud…<br /></span>}
          {chats.length
            ? `${chats.length} chat${chats.length > 1 ? "s" : ""} saved locally · ${storageKb} KB used${cloudBackup ? " · cloud sync on" : ""}`
            : "Imported chats are saved in this browser only"}
        </div>
      </aside>

      {/* ============ Main ============ */}
      <main className="main">
        <div className="header">
          <button className="back-btn" title="Back to chats" onClick={() => setMobileOpen(false)}>←</button>
          <div className="avatar" style={activeChat ? { background: avatarColor(activeChat.name) } : {}}>
            {activeChat ? initial(activeChat.name) : "💬"}
          </div>
          <div className="header-info">
            <h2>{activeChat ? activeChat.name : "WhatsApp Chat Viewer"}</h2>
            <p>{activeChat ? `${messages.length} messages` : "Import an exported .txt chat file"}</p>
          </div>
          {activeChat && senders.length > 1 && (
            <select value={me} onChange={(e) => setMe(e.target.value)} title="Which sender is you? (shown on right)">
              {senders.map((s) => <option key={s} value={s}>Me: {s}</option>)}
            </select>
          )}
          {activeChat && (
            <>
              <button className="icon-btn" title="Insights dashboard" onClick={() => setInsightsOpen(true)}>🧭</button>
              <button className="icon-btn" title="Chat statistics" onClick={() => setStatsOpen(true)}>📊</button>
              <button
                className="icon-btn" title="Search messages"
                onClick={() => {
                  const next = !searchOpen;
                  setJump(null);
                  setSearchOpen(next);
                  if (next) setTimeout(() => searchInputRef.current?.focus(), 0);
                  else setSearchQ("");
                }}
              >🔍</button>
            </>
          )}
        </div>

        {searchOpen && (
          <div className="search-bar">
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
            <button title="Previous match (older)" disabled={matchInfo.total < 2} onClick={() => step(-1)}>▲</button>
            <button title="Next match (newer)" disabled={matchInfo.total < 2} onClick={() => step(1)}>▼</button>
            <button title="Close search" onClick={() => { setSearchOpen(false); setSearchQ(""); }}>✕</button>
          </div>
        )}

        {jump && (
          <div className="search-bar">
            <span className="jump-label">{jump.label}</span>
            <span className="count">{jump.idx + 1} of {jump.indices.length}</span>
            <button title="Previous" disabled={jump.indices.length < 2} onClick={() => jumpStep(-1)}>▲</button>
            <button title="Next" disabled={jump.indices.length < 2} onClick={() => jumpStep(1)}>▼</button>
            <button title="Back to statistics" onClick={() => { setJump(null); setStatsOpen(true); }}>📊</button>
            <button title="Close" onClick={() => setJump(null)}>✕</button>
          </div>
        )}

        {activeChat ? (
          <div className="chat" ref={chatRef} onScroll={onChatScroll} dangerouslySetInnerHTML={{ __html: messagesHtml }} />
        ) : (
          <div className="chat">
            <div className="empty">
              <div className="big-icon">💬</div>
              <h3>View your WhatsApp chats</h3>
              <p>
                Import one or more WhatsApp exported chat files (.txt) — or drag &amp; drop them anywhere
                on this page. Chats are saved in your browser so they&apos;re still here next time.
                Nothing leaves your device.
              </p>
              <button className="pick-btn" onClick={() => fileRef.current?.click()}>Import .txt file(s)</button>
            </div>
          </div>
        )}

        {showToBottom && (
          <button
            className="to-bottom" title="Scroll to latest"
            onClick={() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })}
          >⬇</button>
        )}
      </main>

      {/* ============ Import loader ============ */}
      {importing && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div>Importing your chat…</div>
        </div>
      )}

      {/* ============ Drag overlay ============ */}
      {dragging && (
        <div className="drop-overlay">
          <div style={{ fontSize: 56 }}>📥</div>
          <div>Drop your WhatsApp .txt file(s) here</div>
        </div>
      )}

      {/* ============ Insights dashboard (lazy) ============ */}
      {insightsOpen && activeChat && (
        <Insights
          chatName={activeChat.name}
          messages={messages}
          senders={senders}
          onJump={startJump}
          onJumpDate={scrollToDate}
          onReplay={() => setReplayOpen(true)}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {/* ============ Chat replay (lazy) ============ */}
      {replayOpen && activeChat && (
        <Replay chatName={activeChat.name} messages={messages} me={me} onClose={() => setReplayOpen(false)} />
      )}

      {/* ============ Stats modal ============ */}
      {statsOpen && stats && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setStatsOpen(false); }}>
          <div className="modal">
            <h3>
              Chat statistics
              <button className="icon-btn" onClick={() => setStatsOpen(false)}>✕</button>
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
                      style={v ? { background: `rgba(0,168,132,${0.15 + 0.85 * (v / maxHeat)})` } : {}}
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
    </div>
  );
}
