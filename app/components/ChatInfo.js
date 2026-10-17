"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  attachment, mediaKind, basename, formatDate, formatText,
  escapeHtml, initial, avatarColor,
} from "../../lib/chat";
import { IconTrash, IconCheck } from "./Icons";

const EMPTY_SET = new Set();

// Pull URLs out of raw message text (trailing punctuation trimmed).
const URL_RE = /https?:\/\/[^\s]+/g;
function cleanUrl(u) {
  return u.replace(/[.,;:!?)\]}'"»]+$/, "");
}

// Grows a list in pages as a sentinel element scrolls into view, so huge chats
// never mount thousands of tiles/rows at once.
const MEDIA_PAGE = 90;
const LIST_PAGE = 100;
function useIncremental(totalCount, page, resetKey) {
  const [count, setCount] = useState(page);
  const sentinelRef = useRef(null);
  useEffect(() => { setCount(page); }, [resetKey, page]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || count >= totalCount) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(totalCount, c + page));
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [count, totalCount, page]);
  return [count, sentinelRef];
}

/**
 * mediaDelete: { mode: "soft" | "hard", onDelete(names[]) => Promise<boolean> } — optional;
 *   absent in local mode (no delete UI at all).
 * deletedMedia: Set of file names deleted from the chat (hidden here).
 * flaggedMedia: Set of file names the user deleted (admin view: shown with a badge).
 */
export default function ChatInfo({
  chatName, messages, mediaUrls, downloadUrls, remote = false, onMediaEvent, onJump, onClose,
  mediaDelete = null, deletedMedia = EMPTY_SET, flaggedMedia = EMPTY_SET,
}) {
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
        } else if (!deletedMedia.has(name) && (url || !remote)) { // vault: hide files that are gone
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
  }, [messages, mediaUrls, deletedMedia]);

  const counts = { media: media.length, links: links.length, docs: docs.length };
  const [mediaShown, mediaSentinel] = useIncremental(media.length, MEDIA_PAGE, `${tab}|${media.length}`);
  const [linksShown, linksSentinel] = useIncremental(links.length, LIST_PAGE, `${tab}|${links.length}`);
  const [docsShown, docsSentinel] = useIncremental(docs.length, LIST_PAGE, `${tab}|${docs.length}`);

  /* ---------- selection + deletion ---------- */
  const canDelete = !!mediaDelete;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setSelecting(false); setSelected(new Set()); }, [tab]);
  const listForTab = tab === "media" ? media : tab === "docs" ? docs.filter((d) => d.url) : [];
  const toggle = (name) => setSelected((sel) => {
    const next = new Set(sel);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const allSelected = listForTab.length > 0 && listForTab.every((x) => selected.has(x.name));
  const exitSelection = () => { setSelecting(false); setSelected(new Set()); };
  const deleteNames = async (names) => {
    if (!mediaDelete || !names.length || deleting) return false;
    setDeleting(true);
    try {
      const ok = await mediaDelete.onDelete(names);
      if (ok) setSelected((sel) => { const next = new Set(sel); names.forEach((n) => next.delete(n)); return next; });
      return ok;
    } finally {
      setDeleting(false);
    }
  };
  const deleteSelected = async () => {
    // keep chat order (not click order)
    const names = listForTab.filter((x) => selected.has(x.name)).map((x) => x.name);
    if (await deleteNames(names)) exitSelection();
  };

  /* ---------- lightbox ---------- */
  const openViewer = useCallback((idx) => setViewer(idx), []);
  const closeViewer = useCallback(() => setViewer(-1), []);
  const stepViewer = useCallback((dir) => {
    setViewer((v) => (v < 0 ? v : (v + dir + media.length) % media.length));
  }, [media.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector(".confirm-modal")) return; // a confirm dialog handles its own keys
      if (viewer >= 0) {
        if (e.key === "Escape") closeViewer();
        else if (e.key === "ArrowRight") stepViewer(1);
        else if (e.key === "ArrowLeft") stepViewer(-1);
      } else if (e.key === "Escape") {
        if (selecting) exitSelection();
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, closeViewer, stepViewer, onClose, selecting]);

  // After a deletion the current item disappears: show the next one, or close.
  useEffect(() => {
    if (viewer >= media.length) setViewer(media.length - 1);
  }, [viewer, media.length]);

  const cur = viewer >= 0 ? media[viewer] : null;

  // Activity reporting (vault only): a photo/sticker shown in the lightbox
  // (opening it or navigating to it) counts as a view.
  useEffect(() => {
    if (cur && onMediaEvent && (cur.kind === "image" || cur.kind === "sticker")) onMediaEvent("MEDIA_VIEW", cur.name);
  }, [cur, onMediaEvent]);

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

        {canDelete && (tab === "media" || tab === "docs") && listForTab.length > 0 && (
          selecting ? (
            <div className="select-bar">
              <span className="sb-count">{selected.size.toLocaleString()} selected</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setSelected(allSelected ? new Set() : new Set(listForTab.map((x) => x.name)))}>
                {allSelected ? "Clear" : `Select all (${listForTab.length.toLocaleString()})`}
              </button>
              <span className="sb-spacer" />
              <button className="btn btn-ghost btn-xs" onClick={exitSelection}>Cancel</button>
              <button className="btn btn-danger-solid btn-xs" disabled={!selected.size || deleting} onClick={deleteSelected}>
                <IconTrash size={13} /> Delete
              </button>
            </div>
          ) : (
            <div className="select-bar idle">
              <span className="sb-spacer" />
              <button className="btn btn-ghost btn-xs" onClick={() => setSelecting(true)}><IconCheck size={13} /> Select</button>
            </div>
          )
        )}

        {tab === "media" && (
          media.length ? (<>
            <div className={`media-grid${selecting ? " selecting" : ""}`}>
              {media.slice(0, mediaShown).map((m, idx) => (
                <button
                  key={m.i}
                  className={`media-cell${selecting && selected.has(m.name) ? " selected" : ""}`}
                  onClick={() => (selecting ? toggle(m.name) : openViewer(idx))}
                  title={`${m.sender} · ${formatDate(m.date)}`}
                  aria-pressed={selecting ? selected.has(m.name) : undefined}
                >
                  {selecting && <span className={`sel-check${selected.has(m.name) ? " on" : ""}`} aria-hidden="true"><IconCheck size={13} /></span>}
                  {flaggedMedia.has(m.name) && <span className="tile-flag">Deleted by user</span>}
                  {m.kind === "video" ? (
                    <>
                      {remote
                        ? <span className="video-tile" aria-hidden="true" />
                        : <video src={m.url} preload="metadata" muted playsInline />}
                      <span className="play-badge">▶</span>
                    </>
                  ) : (
                    <img src={m.url} loading="lazy" decoding="async" alt="" />
                  )}
                </button>
              ))}
            </div>
            <div ref={mediaSentinel} className="list-sentinel" />
          </>) : <div className="info-empty">No photos or videos.<br /><small>Export the chat <b>with media</b> (as a .zip) to see them here.</small></div>
        )}

        {tab === "links" && (
          links.length ? (<>
            <div className="info-list">
              {links.slice(0, linksShown).map((l, idx) => (
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
            <div ref={linksSentinel} className="list-sentinel" />
          </>) : <div className="info-empty">No links in this chat.</div>
        )}

        {tab === "docs" && (
          docs.length ? (<>
            <div className="info-list">
              {docs.slice(0, docsShown).map((d, idx) => (
                <div
                  key={idx}
                  className={`doc-row${selecting && d.url ? " selectable" : ""}${selecting && selected.has(d.name) ? " selected" : ""}`}
                  onClick={selecting && d.url ? () => toggle(d.name) : undefined}
                >
                  {selecting && d.url && <span className={`sel-check inline${selected.has(d.name) ? " on" : ""}`} aria-hidden="true"><IconCheck size={13} /></span>}
                  <div className="doc-icon">📄</div>
                  <div className="doc-info">
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-meta">
                      {d.sender} · {formatDate(d.date)}
                      {flaggedMedia.has(d.name) && <span className="tile-flag inline">Deleted by user</span>}
                    </div>
                  </div>
                  {!selecting && d.url && <a className="doc-dl" href={dl(d.name, d.url)} download={d.name} title="Download" onClick={() => onMediaEvent?.("DOC_DOWNLOAD", d.name)}>⬇</a>}
                  {!selecting && canDelete && d.url && (
                    <button className="doc-del" title="Delete" disabled={deleting} onClick={() => deleteNames([d.name])}><IconTrash size={16} /></button>
                  )}
                  {!selecting && <button className="doc-jump" title="Show in chat" onClick={() => goToMessage(d.i)}>↪</button>}
                </div>
              ))}
            </div>
            <div ref={docsSentinel} className="list-sentinel" />
          </>) : <div className="info-empty">No documents in this chat.</div>
        )}
      </div>

      {/* ---------- full-screen media viewer ---------- */}
      {cur && (
        <div className="lightbox" onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}>
          <div className="lb-top">
            <div className="lb-meta">
              <div className="lb-sender">{cur.sender}</div>
              <div className="lb-date">{formatDate(cur.date)} · {cur.time}{flaggedMedia.has(cur.name) ? " · Deleted by user" : ""}</div>
            </div>
            <div className="lb-actions">
              <button className="icon-btn" title="Show in chat" onClick={() => goToMessage(cur.i)}>↪</button>
              <a className="icon-btn" href={dl(cur.name, cur.url)} download={cur.name} title="Download">⬇</a>
              {canDelete && (
                <button className="icon-btn lb-del" title="Delete" disabled={deleting} onClick={() => deleteNames([cur.name])}><IconTrash size={18} /></button>
              )}
              <button className="icon-btn" title="Close" onClick={closeViewer}>✕</button>
            </div>
          </div>

          <div className="lb-stage">
            {media.length > 1 && <button className="lb-nav prev" title="Previous" onClick={() => stepViewer(-1)}>‹</button>}
            {cur.kind === "video" ? (
              <video key={cur.url} src={cur.url} controls autoPlay playsInline className="lb-media" onPlay={() => onMediaEvent?.("VIDEO_PLAY", cur.name)} />
            ) : (
              <img key={cur.url} src={cur.url} alt="" decoding="async" className="lb-media" />
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
