"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  attachment, mediaKind, basename, formatDate, formatText,
  escapeHtml, initial, avatarColor,
} from "../../lib/chat";

// Pull URLs out of raw message text (trailing punctuation trimmed).
const URL_RE = /https?:\/\/[^\s]+/g;
function cleanUrl(u) {
  return u.replace(/[.,;:!?)\]}'"»]+$/, "");
}

export default function ChatInfo({ chatName, messages, mediaUrls, downloadUrls, remote = false, onJump, onClose }) {
  // Download links: in the vault these go through /api/vault/media/[id]?download=1
  // so the file is saved with its original name.
  const dl = (name, url) => (downloadUrls && downloadUrls[name]) || url;
  const [tab, setTab] = useState("media");
  const [viewer, setViewer] = useState(-1); // index into `media`, or -1 when closed

  // One pass over the chat → photos/videos, links, and documents.
  const { media, links, docs } = useMemo(() => {
    const media = [], links = [], docs = [];
    messages.forEach((m, i) => {
      if (m.system) return;
      const att = attachment(m.text);
      if (att) {
        const name = basename(att.name);
        const url = mediaUrls[name] || null;
        const kind = mediaKind(att.name);
        if (kind === "image" || kind === "sticker" || kind === "video") {
          if (url) media.push({ i, name, url, kind, caption: att.caption, sender: m.sender, date: m.date, time: m.time });
        } else {
          docs.push({ i, name, url, caption: att.caption, sender: m.sender, date: m.date, time: m.time });
        }
      }
      const found = m.text.match(URL_RE);
      if (found) for (const raw of found) {
        const url = cleanUrl(raw);
        if (url) links.push({ i, url, sender: m.sender, date: m.date, time: m.time });
      }
    });
    return { media, links, docs };
  }, [messages, mediaUrls]);

  const counts = { media: media.length, links: links.length, docs: docs.length };

  /* ---------- lightbox ---------- */
  const openViewer = useCallback((idx) => setViewer(idx), []);
  const closeViewer = useCallback(() => setViewer(-1), []);
  const stepViewer = useCallback((dir) => {
    setViewer((v) => (v < 0 ? v : (v + dir + media.length) % media.length));
  }, [media.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (viewer >= 0) {
        if (e.key === "Escape") closeViewer();
        else if (e.key === "ArrowRight") stepViewer(1);
        else if (e.key === "ArrowLeft") stepViewer(-1);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, closeViewer, stepViewer, onClose]);

  const cur = viewer >= 0 ? media[viewer] : null;

  const goToMessage = (i) => { onJump(i); onClose(); };

  const hostname = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

  return (
    <div className="info-overlay">
      <div className="info-head">
        <button className="icon-btn" title="Back to chat" onClick={onClose}>←</button>
        <h2>Chat info</h2>
      </div>

      <div className="info-scroll">
        <div className="info-profile">
          <div className="info-avatar" style={{ background: avatarColor(chatName) }}>{initial(chatName)}</div>
          <div className="info-name">{chatName}</div>
          <div className="info-sub">{messages.length.toLocaleString()} messages</div>
        </div>

        <div className="info-tabs">
          {[["media", `Media ${counts.media}`], ["links", `Links ${counts.links}`], ["docs", `Docs ${counts.docs}`]].map(([k, label]) => (
            <button key={k} className={`info-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === "media" && (
          media.length ? (
            <div className="media-grid">
              {media.map((m, idx) => (
                <button key={m.i} className="media-cell" onClick={() => openViewer(idx)} title={`${m.sender} · ${formatDate(m.date)}`}>
                  {m.kind === "video" ? (
                    <>
                      {remote
                        ? <span className="video-tile" aria-hidden="true" />
                        : <video src={m.url} preload="metadata" muted playsInline />}
                      <span className="play-badge">▶</span>
                    </>
                  ) : (
                    <img src={m.url} loading="lazy" alt="" />
                  )}
                </button>
              ))}
            </div>
          ) : <div className="info-empty">No photos or videos.<br /><small>Export the chat <b>with media</b> (as a .zip) to see them here.</small></div>
        )}

        {tab === "links" && (
          links.length ? (
            <div className="info-list">
              {links.map((l, idx) => (
                <div key={idx} className="link-row">
                  <a className="link-main" href={l.url} target="_blank" rel="noopener noreferrer">
                    <span className="link-host">{hostname(l.url)}</span>
                    <span className="link-url">{l.url}</span>
                  </a>
                  <button className="link-jump" title="Show in chat" onClick={() => goToMessage(l.i)}>
                    <span className="link-meta">{l.sender} · {formatDate(l.date)}</span>
                    <span>↪</span>
                  </button>
                </div>
              ))}
            </div>
          ) : <div className="info-empty">No links in this chat.</div>
        )}

        {tab === "docs" && (
          docs.length ? (
            <div className="info-list">
              {docs.map((d, idx) => (
                <div key={idx} className="doc-row">
                  <div className="doc-icon">📄</div>
                  <div className="doc-info">
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-meta">{d.sender} · {formatDate(d.date)}</div>
                  </div>
                  {d.url && <a className="doc-dl" href={dl(d.name, d.url)} download={d.name} title="Download">⬇</a>}
                  <button className="doc-jump" title="Show in chat" onClick={() => goToMessage(d.i)}>↪</button>
                </div>
              ))}
            </div>
          ) : <div className="info-empty">No documents in this chat.</div>
        )}
      </div>

      {/* ---------- full-screen media viewer ---------- */}
      {cur && (
        <div className="lightbox" onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}>
          <div className="lb-top">
            <div className="lb-meta">
              <div className="lb-sender">{cur.sender}</div>
              <div className="lb-date">{formatDate(cur.date)} · {cur.time}</div>
            </div>
            <div className="lb-actions">
              <button className="icon-btn" title="Show in chat" onClick={() => goToMessage(cur.i)}>↪</button>
              <a className="icon-btn" href={dl(cur.name, cur.url)} download={cur.name} title="Download">⬇</a>
              <button className="icon-btn" title="Close" onClick={closeViewer}>✕</button>
            </div>
          </div>

          <div className="lb-stage">
            {media.length > 1 && <button className="lb-nav prev" title="Previous" onClick={() => stepViewer(-1)}>‹</button>}
            {cur.kind === "video" ? (
              <video key={cur.url} src={cur.url} controls autoPlay playsInline className="lb-media" />
            ) : (
              <img key={cur.url} src={cur.url} alt="" className="lb-media" />
            )}
            {media.length > 1 && <button className="lb-nav next" title="Next" onClick={() => stepViewer(1)}>›</button>}
          </div>

          {cur.caption && (
            <div
              className="lb-caption"
              dangerouslySetInnerHTML={{ __html: formatText(cur.caption) }}
            />
          )}
          <div className="lb-count">{viewer + 1} / {media.length}</div>
        </div>
      )}
    </div>
  );
}
