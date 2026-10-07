"use client";

// Read-only admin view of any user's chat (including removed ones). Uses the
// admin detail endpoint; "me" selection is local only (never saved).

import { useCallback, useEffect, useRef, useState } from "react";
import ChatViewer from "../components/ChatViewer";
import { getJson, buildMediaMaps, fetchText, REFRESH_AFTER_MS } from "../../lib/chatDetail";
import { IconBack, IconShield } from "../components/Icons";

const ownerName = (o) => (o ? [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email : "this user");

export default function AdminChatViewer({ chatId, onBack }) {
  const [chat, setChat] = useState(null);
  const [owner, setOwner] = useState(null);
  const [meta, setMeta] = useState(null);
  const [maps, setMaps] = useState({ mediaUrls: {}, downloadUrls: {} });
  const [loading, setLoading] = useState({ label: "Opening chat…" });
  const [err, setErr] = useState("");
  const fetchedAt = useRef(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await getJson(`/api/admin/chats/${chatId}`);
        if (!alive) return;
        setOwner(d.owner);
        setMeta(d.chat);
        setLoading({ label: "Downloading messages…", percent: 0 });
        const text = await fetchText(d.textUrl, (p) => alive && setLoading({ label: "Downloading messages…", percent: p }));
        if (!alive) return;
        fetchedAt.current = Date.now();
        setMaps(buildMediaMaps(d, "/api/admin/media/"));
        setChat({ id: d.chat.id, name: d.chat.name, text, me: d.chat.me });
        setLoading(null);
      } catch (e) {
        if (alive) { setErr(e.message || "Couldn't open this chat."); setLoading(null); }
      }
    })();
    return () => { alive = false; };
  }, [chatId]);

  // Refresh presigned media links (after a load error or ~20h), like the vault.
  const refreshLinks = useCallback(async () => {
    if (Date.now() - lastRefresh.current < 60_000) return;
    lastRefresh.current = Date.now();
    try {
      const d = await getJson(`/api/admin/chats/${chatId}?refresh=1`);
      fetchedAt.current = Date.now();
      setMaps(buildMediaMaps(d, "/api/admin/media/"));
    } catch { /* keep the old links */ }
  }, [chatId]);

  useEffect(() => {
    if (!chat) return;
    const check = () => { if (Date.now() - fetchedAt.current > REFRESH_AFTER_MS) refreshLinks(); };
    const t = setInterval(check, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, [chat, refreshLinks]);

  return (
    <div className="admin-viewer">
      <div className="admin-banner">
        <button className="btn btn-light btn-sm" onClick={onBack}><IconBack size={16} /> Back</button>
        <IconShield size={18} />
        <span className="ab-text">
          Viewing <b>{ownerName(owner)}</b>&apos;s chat as admin{owner?.email ? ` (${owner.email})` : ""} · read-only
          {meta?.deletedAt ? ` · removed by the user ${meta.daysSinceDeleted} day${meta.daysSinceDeleted === 1 ? "" : "s"} ago` : ""}
        </span>
      </div>
      <div className="app chat-open admin-viewer-app">
        <ChatViewer
          chat={chat}
          mediaUrls={maps.mediaUrls}
          downloadUrls={maps.downloadUrls}
          remote
          loading={loading}
          onBack={onBack}
          onSetMe={(v) => setChat((c) => (c ? { ...c, me: v } : c))}
          onMediaError={refreshLinks}
          emptyState={err ? (
            <div className="hero hero-vault">
              <h1 className="hero-title small">Couldn&apos;t open this chat</h1>
              <p className="hero-sub">{err}</p>
              <button className="btn btn-primary" onClick={onBack}>Back</button>
            </div>
          ) : null}
        />
      </div>
    </div>
  );
}
