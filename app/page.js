"use client";

// Local mode (default): analyze a WhatsApp export privately — everything stays
// in this browser (IndexedDB). Signing in opens the cloud vault at /vault.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import ChatViewer from "./components/ChatViewer";
import { parseText, formatDate, initial, avatarColor, previewText, mimeFor, basename } from "../lib/chat";
import { openZip, readEntry, isJunkEntry, findChatText } from "../lib/unzip";
import { idbGetAll, idbSaveAll } from "../lib/db";
import { useTheme } from "../lib/useTheme";
import { BRAND_NAME, BRAND_TAGLINE } from "../lib/brand";
import {
  IconLogo, IconSun, IconMoon, IconPlus, IconTrash, IconUpload, IconShield, IconLock,
  IconImage, IconSparkles, IconChart, IconCloud, IconSearch,
} from "./components/Icons";

const STORE_KEY = "wa_viewer_chats";

export default function Home() {
  const [chats, setChats] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [dark, toggleTheme] = useTheme();
  const [listQuery, setListQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [me, setMeUser] = useState(undefined); // undefined = checking, null = signed out

  const fileRef = useRef(null);
  const dragDepth = useRef(0);
  const chatsRef = useRef([]);

  /* ---------- who's signed in (for the header buttons) ---------- */
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMeUser(d.user || null)).catch(() => setMeUser(null));
  }, []);

  /* ---------- storage ---------- */
  useEffect(() => {
    (async () => {
      // Primary storage: IndexedDB (fits huge chats). Migrate any old localStorage data once.
      let list = await idbGetAll();
      if (list === null) {
        try { list = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
        catch { try { list = JSON.parse(sessionStorage.getItem(STORE_KEY)) || []; } catch { list = []; } }
      } else {
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch {}
        if (legacy.length) {
          const ids = new Set(list.map((c) => c.id));
          list = [...list, ...legacy.filter((c) => !ids.has(c.id))];
          idbSaveAll(list);
          try { localStorage.removeItem(STORE_KEY); } catch {}
        }
      }
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      setChats(list);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { chatsRef.current = chats; }, [chats]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const ok = await idbSaveAll(chats);
      if (!ok) {
        const json = JSON.stringify(chats);
        try { localStorage.setItem(STORE_KEY, json); }
        catch {
          try { sessionStorage.setItem(STORE_KEY, json); }
          catch { console.warn("Could not persist chats — storage unavailable."); }
        }
      }
    })();
  }, [chats, loaded]);

  /* ---------- derived ---------- */
  const activeChat = chats.find((c) => c.id === activeId) || null;

  /* Object URLs for this chat's media (from the imported .zip), keyed by filename. */
  const mediaUrls = useMemo(() => {
    const map = {};
    const media = activeChat?.media;
    if (media) {
      for (const name of Object.keys(media)) {
        try { map[name] = URL.createObjectURL(media[name]); } catch {}
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id]);

  useEffect(() => () => {
    Object.values(mediaUrls).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
  }, [mediaUrls]);

  const viewerChat = useMemo(
    () => (activeChat ? { id: activeChat.id, name: activeChat.name, text: activeChat.text, me: activeChat.me } : null),
    [activeChat?.id, activeChat?.text, activeChat?.me, activeChat?.name]
  );

  /* ---------- import ---------- */
  const importFiles = useCallback((fileList) => {
    const files = Array.from(fileList).filter((f) => /\.(txt|zip)$/i.test(f.name));
    if (!files.length) { alert("Please select a .txt or .zip file exported from WhatsApp."); return; }
    setImporting(true);
    let remaining = files.length;
    const finishOne = () => { if (--remaining <= 0) setImporting(false); };

    const addChat = (rawName, text, media) => {
      const msgs = parseText(text);
      if (!msgs.length) return false;
      const name = rawName || "WhatsApp Chat";
      const last = [...msgs].reverse().find((m) => !m.system);
      const existing = chatsRef.current.find((c) => c.name === name);
      const id = existing ? existing.id : Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const entry = {
        id, name, text,
        media: media && Object.keys(media).length ? media : undefined,
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
      return true;
    };

    const importTxt = async (f) => {
      try {
        const text = await f.text();
        const name = f.name.replace(/^WhatsApp Chat with /i, "").replace(/\.txt$/i, "");
        if (!addChat(name, text, null)) alert(`"${f.name}" doesn't look like a WhatsApp chat export — skipped.`);
      } finally { finishOne(); }
    };

    // Random-access ZIP reading: only the central directory and each needed
    // entry are read — the archive is never loaded into memory as a whole.
    const importZip = async (f) => {
      try {
        const entries = await openZip(f);
        const found = await findChatText(f, entries, parseText);
        if (!found) { alert(`"${f.name}" has no chat .txt inside — skipped.`); return; }
        const media = {};
        for (const e of entries) {
          if (e === found.entry || /\.txt$/i.test(e.name) || isJunkEntry(e.name) || e.encrypted) continue;
          try { media[basename(e.name)] = await readEntry(f, e, mimeFor(e.name)); } catch (err) { console.warn(err); }
        }
        const name =
          f.name.replace(/^WhatsApp Chat with /i, "").replace(/\.zip$/i, "") ||
          basename(found.entry.name).replace(/^WhatsApp Chat with /i, "").replace(/\.txt$/i, "");
        if (!addChat(name, found.text, media)) alert(`"${f.name}" doesn't contain a readable WhatsApp chat — skipped.`);
      } catch (err) {
        console.error(err);
        alert(`Couldn't read "${f.name}" as a ZIP (${err.message}).`);
      } finally { finishOne(); }
    };

    files.forEach((f) => (/\.zip$/i.test(f.name) ? importZip(f) : importTxt(f)));
  }, []);

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

  /* ---------- actions ---------- */
  const openChat = (id) => { setActiveId(id); setMobileOpen(true); };

  const deleteChat = (e, c) => {
    e.stopPropagation();
    if (!confirm(`Delete "${c.name}" from this browser?`)) return;
    setChats((prev) => prev.filter((x) => x.id !== c.id));
    if (activeId === c.id) { setActiveId(null); setMobileOpen(false); }
  };

  const setMe = (val) => setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, me: val } : c)));

  const q = listQuery.trim().toLowerCase();
  const shownChats = chats.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.preview || "").toLowerCase().includes(q));

  const storageKb = useMemo(
    () => Math.round(chats.reduce((s, c) => s + (c.text?.length || 0) * 2, 0) / 1024),
    [chats]
  );

  const authButtons = me === undefined ? null : me ? (
    <Link href="/vault" className="btn btn-primary btn-sm"><IconShield size={16} /> Open my vault</Link>
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
      <Link href="/signup" className="btn btn-primary btn-sm">Create account</Link>
    </>
  );

  const hero = (
    <div className="hero">
      <div className="hero-badge"><IconSparkles size={14} /> {BRAND_TAGLINE}</div>
      <h1 className="hero-title">Relive every conversation, <span className="grad-text">beautifully.</span></h1>
      <p className="hero-sub">
        Open a WhatsApp export to read it like the real thing — with photos, videos and voice notes —
        plus deep stats, insights and a movie-style replay.
      </p>
      <div className="hero-cards">
        <div className="hero-card">
          <div className="hc-icon"><IconLock size={20} /></div>
          <h3>Analyze privately</h3>
          <p>Drop a <b>.zip</b> or <b>.txt</b> export. Everything stays in this browser — nothing is uploaded.</p>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><IconUpload size={17} /> Open an export</button>
          <small className="hc-hint">or drag &amp; drop it anywhere</small>
        </div>
        <div className="hero-card accent">
          <div className="hc-icon"><IconCloud size={20} /></div>
          <h3>Keep it forever</h3>
          <p>Store chats with all their media in your password-protected vault, then free up your phone.</p>
          {me ? (
            <Link href="/vault" className="btn btn-light">Open my vault</Link>
          ) : (
            <div className="hc-actions">
              <Link href="/signup" className="btn btn-light">Create account</Link>
              <Link href="/login" className="btn btn-outline-light">Sign in</Link>
            </div>
          )}
        </div>
      </div>
      <div className="hero-feats">
        <span><IconImage size={15} /> Photos, videos &amp; voice notes</span>
        <span><IconChart size={15} /> Stats &amp; Chat Wrapped</span>
        <span><IconSparkles size={15} /> Insights &amp; replay</span>
        <span><IconSearch size={15} /> Instant search</span>
      </div>
    </div>
  );

  /* ================= render ================= */
  return (
    <div className={`app${mobileOpen ? " chat-open" : ""}`}>
      <aside className="sidebar">
        <div className="side-header">
          <Link href="/" className="brand"><IconLogo size={30} /><span>{BRAND_NAME}</span></Link>
          <button className="icon-btn" title="Toggle dark mode" onClick={toggleTheme}>{dark ? <IconSun /> : <IconMoon />}</button>
          <button className="icon-btn" title="Open chat export(s)" onClick={() => fileRef.current?.click()}><IconPlus /></button>
          <input
            type="file" accept=".txt,.zip" multiple hidden ref={fileRef}
            onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
        <div className="side-auth">{authButtons}</div>
        <div className="side-search">
          <IconSearch size={16} className="side-search-ic" />
          <input placeholder="Search chats…" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
        </div>
        <div className="side-label">On this device</div>
        <div className="chat-list">
          {!chats.length ? (
            <div className="side-empty">
              <div className="side-empty-ic"><IconUpload size={26} /></div>
              <b>No chats yet</b>
              <span>Open an exported .txt or .zip (with media), or drag &amp; drop it anywhere on this page.</span>
              <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>Open an export</button>
            </div>
          ) : !shownChats.length ? (
            <div className="side-empty">No chats match &quot;{listQuery}&quot;</div>
          ) : (
            shownChats.map((c) => (
              <div key={c.id} className={`chat-item${c.id === activeId ? " active" : ""}`} onClick={() => openChat(c.id)}>
                <div className="avatar" style={{ background: avatarColor(c.name) }}>{initial(c.name)}</div>
                <div className="info">
                  <div className="top-line">
                    <span className="name">{c.name}</span>
                    <span className="date">{formatDate(c.lastDate)}</span>
                  </div>
                  <div className="preview">{c.preview}</div>
                </div>
                <button className="del" title="Delete chat" onClick={(e) => deleteChat(e, c)}><IconTrash size={16} /></button>
              </div>
            ))
          )}
        </div>
        <div className="storage-note">
          <IconLock size={13} />
          {chats.length
            ? `${chats.length} chat${chats.length > 1 ? "s" : ""} on this device · ${storageKb > 1024 ? (storageKb / 1024).toFixed(1) + " MB" : storageKb + " KB"} of text`
            : "Private mode — chats stay in this browser"}
        </div>
      </aside>

      <ChatViewer
        chat={viewerChat}
        mediaUrls={mediaUrls}
        onBack={() => setMobileOpen(false)}
        onSetMe={setMe}
        emptyState={hero}
      />

      {importing && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div>Opening your chat…</div>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <IconUpload size={40} />
            <div>Drop your WhatsApp .zip or .txt to open it privately</div>
          </div>
        </div>
      )}
    </div>
  );
}
