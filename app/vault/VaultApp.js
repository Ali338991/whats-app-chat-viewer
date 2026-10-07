"use client";

// The signed-in vault: chats stored in R2 (files) + Postgres (metadata).
// Opening a chat fetches its metadata with ready-made presigned media links,
// then downloads the text straight from R2 and renders it with <ChatViewer remote>.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatViewer from "../components/ChatViewer";
import UploadPanel from "../components/UploadPanel";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatDate, initial, avatarColor } from "../../lib/chat";
import { formatBytes } from "../../lib/vaultUpload";
import { useTheme } from "../../lib/useTheme";
import { BRAND_NAME } from "../../lib/brand";
import { getJson, buildMediaMaps, fetchText, REFRESH_AFTER_MS } from "../../lib/chatDetail";
import { useMediaEventReporter } from "../../lib/mediaEvents";
import {
  IconLogo, IconSun, IconMoon, IconUpload, IconTrash, IconLogout, IconUsers, IconSearch,
  IconClose, IconAlert, IconEdit, IconImage, IconChat, IconCloud, IconLock,
} from "../components/Icons";

// Downloaded chat texts kept in memory: 1 on touch/mobile devices (tight
// per-tab memory limits, e.g. iOS Safari), 3 on desktop.
function textCacheSize() {
  try {
    return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1 ? 1 : 3;
  } catch {
    return 1;
  }
}

export default function VaultApp({ user }) {
  const router = useRouter();
  const [dark, toggleTheme] = useTheme();
  const [chats, setChats] = useState([]);
  const [usage, setUsage] = useState(null);
  const [listState, setListState] = useState("loading"); // loading | ready | error
  const [listError, setListError] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null); // {id, name, text, me}
  const [maps, setMaps] = useState({ mediaUrls: {}, downloadUrls: {} });
  const [opening, setOpening] = useState(null); // {label, percent}
  const [openError, setOpenError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textCache = useRef(new Map()); // id -> text (small LRU)
  const reportMedia = useMediaEventReporter(active?.id); // activity log (vault only)
  const fetchedAt = useRef(0);
  const lastRefresh = useRef(0);
  const openSeq = useRef(0);
  const dragDepth = useRef(0);

  /* ---------- chat list ---------- */
  const loadList = useCallback(async () => {
    try {
      const d = await getJson("/api/vault/chats");
      setChats(d.chats);
      setUsage(d.usage);
      setListState("ready");
      return d.chats;
    } catch (err) {
      if (err.status === 401) { router.replace("/login"); return []; }
      setListError(err.message);
      setListState("error");
      return [];
    }
  }, [router]);

  /* ---------- open a chat ---------- */
  const openChat = useCallback(async (id) => {
    const seq = ++openSeq.current;
    setActiveId(id);
    setMobileOpen(true);
    setOpenError("");
    setActive(null);
    setMaps({ mediaUrls: {}, downloadUrls: {} });
    setOpening({ label: "Opening chat…" });
    try {
      const detail = await getJson(`/api/vault/chats/${id}`);
      if (seq !== openSeq.current) return;
      let text = textCache.current.get(id);
      if (text == null) {
        setOpening({ label: "Downloading messages…", percent: 0 });
        text = await fetchText(detail.textUrl, (p) => seq === openSeq.current && setOpening({ label: "Downloading messages…", percent: p }));
        textCache.current.set(id, text);
        while (textCache.current.size > textCacheSize()) textCache.current.delete(textCache.current.keys().next().value);
      }
      if (seq !== openSeq.current) return;
      setOpening({ label: "Preparing your chat…" });
      await new Promise((r) => setTimeout(r, 20)); // let the label paint before parsing
      fetchedAt.current = Date.now();
      setMaps(buildMediaMaps(detail));
      setActive({ id, name: detail.chat.name, text, me: detail.chat.me });
      setOpening(null);
    } catch (err) {
      if (seq !== openSeq.current) return;
      if (err.status === 401) { router.replace("/login"); return; }
      setOpening(null);
      setOpenError(err.message || "Couldn't open this chat.");
    }
  }, [router]);

  useEffect(() => {
    (async () => {
      const list = await loadList();
      const want = new URLSearchParams(window.location.search).get("chat");
      if (want && list.some((c) => c.id === want && c.status === "READY")) {
        openChat(want);
        window.history.replaceState(null, "", "/vault");
      }
    })();
  }, [loadList, openChat]);

  /* ---------- keep presigned media links fresh ---------- */
  const refreshLinks = useCallback(async () => {
    const id = active?.id;
    if (!id || Date.now() - lastRefresh.current < 60_000) return;
    lastRefresh.current = Date.now();
    const seq = openSeq.current;
    try {
      const detail = await getJson(`/api/vault/chats/${id}?refresh=1`);
      if (seq === openSeq.current) {
        fetchedAt.current = Date.now();
        setMaps(buildMediaMaps(detail));
      }
    } catch (err) {
      if (err.status === 401) router.replace("/login");
    }
  }, [active?.id, router]);

  useEffect(() => {
    if (!active) return;
    const check = () => { if (Date.now() - fetchedAt.current > REFRESH_AFTER_MS) refreshLinks(); };
    const t = setInterval(check, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, [active, refreshLinks]);

  /* ---------- actions ---------- */
  const setMe = async (val) => {
    if (!active) return;
    setActive((a) => (a ? { ...a, me: val } : a));
    setChats((cs) => cs.map((c) => (c.id === active.id ? { ...c, me: val } : c)));
    try { await getJson(`/api/vault/chats/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ me: val }) }); } catch {}
  };

  const renameChat = async (e, c) => {
    e.stopPropagation();
    const name = prompt("Rename chat", c.name);
    if (!name || !name.trim() || name.trim() === c.name) return;
    try {
      const d = await getJson(`/api/vault/chats/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, name: d.chat.name } : x)));
      if (active?.id === c.id) setActive((a) => ({ ...a, name: d.chat.name }));
    } catch (err) { alert(err.message); }
  };

  const [removing, setRemoving] = useState(null); // chat awaiting "Remove" confirmation

  const deleteChat = (e, c) => {
    e.stopPropagation();
    setRemoving(c);
  };

  const confirmRemove = async () => {
    const c = removing;
    setRemoving(null);
    if (!c) return;
    setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, deleting: true } : x)));
    try {
      await getJson(`/api/vault/chats/${c.id}`, { method: "DELETE" });
      textCache.current.delete(c.id);
      if (activeId === c.id) { openSeq.current++; setActiveId(null); setActive(null); setOpening(null); setMobileOpen(false); }
      await loadList();
    } catch (err) {
      alert(err.message);
      setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, deleting: false } : x)));
    }
  };

  const signOut = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    router.replace("/login");
    router.refresh();
  };

  const startUpload = (file = null) => {
    setUploadFile(file);
    setUploadOpen(true);
  };

  const onUploaded = async (chat) => {
    setUploadOpen(false);
    setUploadFile(null);
    await loadList();
    if (chat?.id) openChat(chat.id);
  };

  // Refresh the list when an upload ends (success, failure or cancel).
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !uploadBusy) loadList();
    wasBusy.current = uploadBusy;
  }, [uploadBusy, loadList]);

  /* ---------- window drag & drop → upload ---------- */
  useEffect(() => {
    const enter = (e) => { if (!e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
    const leave = (e) => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } };
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && !uploadBusy) startUpload(f);
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
  }, [uploadBusy]);

  /* ---------- derived ---------- */
  const q = listQuery.trim().toLowerCase();
  const shown = chats.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.preview || "").toLowerCase().includes(q));
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const usedPct = usage?.limitBytes ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100) : 0;

  const empty = useMemo(() => (
    <div className="hero hero-vault">
      <div className="hero-icon"><IconCloud size={30} /></div>
      <h1 className="hero-title small">{chats.some((c) => c.status === "READY") ? "Pick a chat to relive it" : "Your vault is ready"}</h1>
      <p className="hero-sub">
        {chats.some((c) => c.status === "READY")
          ? "Choose a chat from the list — messages, photos, videos and voice notes load straight from your private storage."
          : "Upload a WhatsApp export (.zip with media) and it will be kept safe here — then you can delete it from your phone."}
      </p>
      <button className="btn btn-primary btn-lg" onClick={() => startUpload()}><IconUpload size={18} /> Upload a chat</button>
    </div>
  ), [chats]);

  const errorState = openError ? (
    <div className="hero hero-vault">
      <div className="hero-icon warn"><IconAlert size={28} /></div>
      <h1 className="hero-title small">Couldn&apos;t open this chat</h1>
      <p className="hero-sub">{openError}</p>
      <button className="btn btn-primary" onClick={() => activeId && openChat(activeId)}>Try again</button>
    </div>
  ) : null;

  return (
    <div className={`app${mobileOpen ? " chat-open" : ""}`}>
      <aside className="sidebar">
        <div className="side-header">
          <Link href="/vault" className="brand"><IconLogo size={30} /><span>{BRAND_NAME}</span></Link>
          {user.role === "ADMIN" && (
            <Link className="icon-btn" href="/admin" title="Admin panel — users & their chats"><IconUsers /></Link>
          )}
          <button className="icon-btn" title="Toggle dark mode" onClick={toggleTheme}>{dark ? <IconSun /> : <IconMoon />}</button>
          <div className="user-menu">
            <button className="user-chip" onClick={() => setMenuOpen((o) => !o)} title={fullName}>
              <span className="avatar sm" style={{ background: avatarColor(fullName) }}>{initial(user.firstName || user.email)}</span>
            </button>
            {menuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu">
                  <div className="menu-head">
                    <b>{fullName}</b>
                    <small>{user.email}</small>
                  </div>
                  {user.role === "ADMIN" && <Link className="menu-item" href="/admin"><IconUsers size={17} /> Admin</Link>}
                  <Link className="menu-item" href="/"><IconLock size={17} /> Private local mode</Link>
                  <button className="menu-item" onClick={signOut}><IconLogout size={17} /> Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="side-upload">
          <button className="btn btn-primary btn-block" onClick={() => startUpload()}><IconUpload size={17} /> Upload chat</button>
        </div>

        <div className="side-search">
          <IconSearch size={16} className="side-search-ic" />
          <input placeholder="Search your vault…" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
        </div>
        <div className="side-label">Your chats{chats.length ? ` · ${chats.length}` : ""}</div>

        <div className="chat-list">
          {listState === "loading" ? (
            <div className="list-skeleton">{[0, 1, 2].map((i) => <div key={i} className="sk-row"><i /><div><b /><s /></div></div>)}</div>
          ) : listState === "error" ? (
            <div className="side-empty"><b>Couldn&apos;t load your chats</b><span>{listError}</span><button className="btn btn-ghost btn-sm" onClick={loadList}>Retry</button></div>
          ) : !chats.length ? (
            <div className="side-empty">
              <div className="side-empty-ic"><IconCloud size={26} /></div>
              <b>No chats yet</b>
              <span>Upload your first WhatsApp export to keep it safe forever.</span>
            </div>
          ) : !shown.length ? (
            <div className="side-empty">No chats match &quot;{listQuery}&quot;</div>
          ) : (
            shown.map((c) => {
              const ready = c.status === "READY";
              return (
                <div
                  key={c.id}
                  className={`chat-item vault${c.id === activeId ? " active" : ""}${ready ? "" : " not-ready"}${c.deleting ? " deleting" : ""}`}
                  onClick={() => ready && !c.deleting && openChat(c.id)}
                >
                  <div className="avatar" style={{ background: avatarColor(c.name) }}>{initial(c.name)}</div>
                  <div className="info">
                    <div className="top-line">
                      <span className="name">{c.name}</span>
                      {c.status === "UPLOADING" && <span className="badge badge-info">Uploading</span>}
                      {c.status === "FAILED" && <span className="badge badge-error">Upload failed</span>}
                    </div>
                    <div className="preview">
                      {c.firstDate && c.lastDate ? `${formatDate(c.firstDate)} – ${formatDate(c.lastDate)}` : c.preview}
                    </div>
                    <div className="chat-meta">
                      <span><IconChat size={12} /> {c.messageCount.toLocaleString()}</span>
                      <span><IconImage size={12} /> {c.mediaCount.toLocaleString()}</span>
                      <span>{formatBytes(c.totalBytes)}</span>
                    </div>
                  </div>
                  <div className="item-actions">
                    {ready && <button className="del" title="Rename" onClick={(e) => renameChat(e, c)}><IconEdit size={15} /></button>}
                    <button className={`del${ready ? "" : " always"}`} title="Remove from vault" onClick={(e) => deleteChat(e, c)} disabled={c.deleting}><IconTrash size={15} /></button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {usage && (
          <div className="usage">
            <div className="usage-top">
              <span>Storage</span>
              <span>{formatBytes(usage.usedBytes)}{usage.limitBytes != null ? ` of ${formatBytes(usage.limitBytes)}` : " · unlimited"}</span>
            </div>
            {usage.limitBytes != null && (
              <div className="usage-bar"><div className={usedPct > 90 ? "warn" : ""} style={{ width: `${Math.max(usedPct, usage.usedBytes ? 1.5 : 0)}%` }} /></div>
            )}
          </div>
        )}
      </aside>

      <ChatViewer
        chat={active}
        mediaUrls={maps.mediaUrls}
        downloadUrls={maps.downloadUrls}
        remote
        loading={opening}
        onBack={() => setMobileOpen(false)}
        onSetMe={setMe}
        onMediaError={refreshLinks}
        onMediaEvent={reportMedia}
        emptyState={errorState || empty}
      />

      {removing && (
        <ConfirmDialog
          title="Remove this chat from your vault?"
          message={<>&ldquo;{removing.name}&rdquo; will no longer appear in your vault and won&apos;t count toward your storage.</>}
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}

      {uploadOpen && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget && !uploadBusy) { setUploadOpen(false); setUploadFile(null); } }}>
          <div className="modal upload-modal">
            {!uploadBusy && (
              <button className="icon-btn modal-x" title="Close" onClick={() => { setUploadOpen(false); setUploadFile(null); }}><IconClose /></button>
            )}
            <UploadPanel
              key={uploadFile ? uploadFile.name + uploadFile.size : "picker"}
              initialFile={uploadFile}
              onBusyChange={setUploadBusy}
              onUploaded={onUploaded}
              onCancel={() => { setUploadOpen(false); setUploadFile(null); }}
            />
          </div>
        </div>
      )}

      {dragging && !uploadBusy && (
        <div className="drop-overlay">
          <div className="drop-card">
            <IconUpload size={40} />
            <div>Drop your WhatsApp export to upload it to your vault</div>
          </div>
        </div>
      )}
    </div>
  );
}
