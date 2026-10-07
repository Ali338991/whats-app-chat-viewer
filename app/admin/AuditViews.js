"use client";

// Admin audit views: a user's Logins + Activity, and the global Audit log feed.

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconLock, IconImage, IconVideo, IconMic, IconFile, IconChat, IconClose, IconShield } from "../components/Icons";

async function api(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const pad = (n) => String(n).padStart(2, "0");
export function fmtDateTime(d) {
  if (!d) return "—";
  const x = new Date(d);
  return `${x.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export function relTime(d) {
  if (!d) return "";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const mo = Math.round(days / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.round(days / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}
const name = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : "");
const place = (e) => [e.city, e.country].filter(Boolean).join(", ") || "—";

// Paginated loader for the audit endpoints (cursor based).
function useFeed(url) {
  const [events, setEvents] = useState(null);
  const [summary, setSummary] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (more = false, cur = null) => {
    setBusy(true);
    try {
      const sep = url.includes("?") ? "&" : "?";
      const d = await api(more && cur ? `${url}${sep}cursor=${cur}` : url);
      setEvents((prev) => (more ? [...(prev || []), ...d.events] : d.events));
      if (!more) setSummary(d.summary || null);
      setCursor(d.nextCursor);
      setErr("");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [url]);

  useEffect(() => { setEvents(null); load(false); }, [load]);
  return { events, summary, err, busy, hasMore: !!cursor, loadMore: () => load(true, cursor) };
}

function Stat({ label, value, sub }) {
  return (
    <div className="usage-card stat-tile">
      <small>{label}</small>
      <b>{value}</b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function When({ at }) {
  return (
    <div className="when-cell">
      <span>{fmtDateTime(at)}</span>
      <small>{relTime(at)}</small>
    </div>
  );
}

function LoadMore({ feed }) {
  if (!feed.events) return <div className="admin-loading"><div className="spinner" /></div>;
  if (!feed.hasMore) return null;
  return (
    <div className="load-more">
      <button className="btn btn-ghost btn-sm" disabled={feed.busy} onClick={feed.loadMore}>{feed.busy ? "Loading…" : "Load more"}</button>
    </div>
  );
}

/* ======================= Logins ======================= */
const LOGIN_LABEL = { LOGIN: "Signed in", SIGNUP: "Signed up", LOGOUT: "Signed out", LOGIN_FAILED: "Failed attempt" };

export function UserLogins({ userId }) {
  const feed = useFeed(`/api/admin/users/${userId}/logins`);
  const s = feed.summary;
  return (
    <div>
      {feed.err && <div className="alert alert-error"><IconAlert size={18} /><div>{feed.err}</div></div>}
      {s && (
        <div className="stat-grid-cards">
          <Stat label="Total sign-ins" value={s.totalLogins.toLocaleString()} />
          <Stat label="Last sign-in" value={s.lastLogin ? relTime(s.lastLogin) : "Never"} sub={s.lastLogin ? fmtDateTime(s.lastLogin) : ""} />
          <Stat label="First seen" value={fmtDateTime(s.firstSeen).split(" ").slice(0, 3).join(" ")} sub={relTime(s.firstSeen)} />
          <Stat label="Failed (30 days)" value={s.failedLast30Days} />
          <Stat label="Devices" value={s.distinctDevices} sub={s.devices.slice(0, 2).join(", ")} />
        </div>
      )}
      {feed.events && !feed.events.length && <div className="admin-empty">No sign-ins recorded yet.</div>}
      {feed.events && feed.events.length > 0 && (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>When</th><th>Event</th><th>Device</th><th>IP</th><th>Location</th></tr></thead>
            <tbody>
              {feed.events.map((e) => (
                <tr key={e.id}>
                  <td><When at={e.createdAt} /></td>
                  <td>
                    <span className={`ev-pill ev-${e.type.toLowerCase()}`}>{LOGIN_LABEL[e.type] || e.type}</span>
                    {e.meta?.locked && <span className="badge badge-error lock-badge"><IconLock size={11} /> Locked</span>}
                    {e.meta?.whileLocked && <span className="badge badge-warn lock-badge">While locked</span>}
                    {e.meta?.disabled && <span className="badge badge-warn lock-badge">Disabled</span>}
                  </td>
                  <td title={e.userAgent || ""}>{e.device.label}</td>
                  <td className="mono">{e.ip || "—"}</td>
                  <td>{place(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore feed={feed} />
    </div>
  );
}

/* ======================= Activity ======================= */
const ACT_FILTERS = [
  ["", "All activity"], ["CHAT_OPEN", "Chats opened"], ["MEDIA_VIEW", "Photos viewed"],
  ["VIDEO_PLAY", "Videos played"], ["AUDIO_PLAY", "Voice notes / audio"], ["DOC_DOWNLOAD", "Documents"],
];
const ACT_ICON = { CHAT_OPEN: IconChat, MEDIA_VIEW: IconImage, VIDEO_PLAY: IconVideo, AUDIO_PLAY: IconMic, DOC_DOWNLOAD: IconFile };

function activityText(e) {
  const chat = <b>{e.chatName || "a chat"}</b>;
  const file = <span className="mono file-name">{e.mediaName}</span>;
  switch (e.type) {
    case "CHAT_OPEN": return <>Opened chat {chat}</>;
    case "MEDIA_VIEW": return <>Viewed {e.mediaKind === "sticker" ? "sticker" : "photo"} {file} in {chat}</>;
    case "VIDEO_PLAY": return <>Played video {file} in {chat}</>;
    case "AUDIO_PLAY": return <>Played {/\.opus$/i.test(e.mediaName || "") ? "voice note" : "audio"} {file} in {chat}</>;
    case "DOC_DOWNLOAD": return <>Downloaded document {file} from {chat}</>;
    default: return e.type;
  }
}

// Thumbnail via the admin media redirect; placeholder if the file was purged.
function Thumb({ mediaId, onOpen }) {
  const [broken, setBroken] = useState(false);
  if (!mediaId || broken) return <span className="act-thumb ph"><IconImage size={16} /></span>;
  return (
    <button className="act-thumb" onClick={() => onOpen(mediaId)} title="Open full size">
      <img src={`/api/admin/media/${mediaId}`} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </button>
  );
}

export function UserActivity({ userId }) {
  const [type, setType] = useState("");
  const [chatId, setChatId] = useState("");
  const [chats, setChats] = useState([]);
  const [full, setFull] = useState(null);
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(chatId ? { chatId } : {}) }).toString();
  const feed = useFeed(`/api/admin/users/${userId}/activity${qs ? `?${qs}` : ""}`);
  const s = feed.summary;
  useEffect(() => { if (s?.chats && !type && !chatId) setChats(s.chats); }, [s, type, chatId]);
  const isImage = (e) => e.type === "MEDIA_VIEW" && e.mediaId;

  return (
    <div>
      {feed.err && <div className="alert alert-error"><IconAlert size={18} /><div>{feed.err}</div></div>}
      {s && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>Last 30 days</div>
          <div className="stat-grid-cards">
            <Stat label="Chats opened" value={s.last30Days.chatsOpened} />
            <Stat label="Photos viewed" value={s.last30Days.photosViewed} />
            <Stat label="Videos played" value={s.last30Days.videosPlayed} />
            <Stat label="Audio played" value={s.last30Days.audioPlayed} />
            <Stat label="Docs downloaded" value={s.last30Days.docsDownloaded} />
          </div>
          {s.topMedia.length > 0 && (
            <>
              <div className="section-title">Most viewed</div>
              <div className="top-media">
                {s.topMedia.map((m) => (
                  <div key={m.mediaId} className="top-media-item">
                    {m.mediaKind === "image" || m.mediaKind === "sticker"
                      ? <Thumb mediaId={m.mediaId} onOpen={setFull} />
                      : <span className="act-thumb ph">{m.mediaKind === "video" ? <IconVideo size={16} /> : m.mediaKind === "audio" ? <IconMic size={16} /> : <IconFile size={16} />}</span>}
                    <div className="tm-info"><span className="mono file-name">{m.mediaName}</span><small>{m.chatName} · {m.count}×</small></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="audit-filters">
        <div className="input-wrap"><select value={type} onChange={(e) => setType(e.target.value)}>{ACT_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="input-wrap">
          <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
            <option value="">All chats</option>
            {chats.map((c) => <option key={c.chatId} value={c.chatId}>{c.chatName || c.chatId}</option>)}
          </select>
        </div>
      </div>

      {feed.events && !feed.events.length && <div className="admin-empty">No activity recorded{type || chatId ? " for this filter" : " yet"}.</div>}
      <div className="timeline">
        {(feed.events || []).map((e) => {
          const Ic = ACT_ICON[e.type] || IconChat;
          return (
            <div key={e.id} className="tl-item">
              <span className="tl-ic"><Ic size={15} /></span>
              <div className="tl-body">
                <div className="tl-text">{activityText(e)}</div>
                <div className="tl-meta">{fmtDateTime(e.createdAt)} · {relTime(e.createdAt)}{e.ip ? ` · ${e.ip}` : ""}{e.device ? ` · ${e.device.label}` : ""}</div>
              </div>
              {isImage(e) && <Thumb mediaId={e.mediaId} onOpen={setFull} />}
            </div>
          );
        })}
      </div>
      <LoadMore feed={feed} />

      {full && (
        <div className="lightbox" onClick={(e) => { if (e.target === e.currentTarget) setFull(null); }}>
          <div className="lb-top"><span /><div className="lb-actions"><button className="icon-btn" onClick={() => setFull(null)}><IconClose /></button></div></div>
          <div className="lb-stage" onClick={(e) => { if (e.target === e.currentTarget) setFull(null); }}>
            <img src={`/api/admin/media/${full}`} alt="" className="lb-media" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================= Global audit log ======================= */
const AUDIT_FILTERS = [
  ["", "All events"], ["ADMIN", "Admin actions"], ["LOGIN", "Sign-ins"], ["LOGIN_FAILED", "Failed sign-ins"],
  ["SIGNUP", "Sign-ups"], ["LOGOUT", "Sign-outs"], ["CHAT_OPEN", "Chats opened"], ["MEDIA_VIEW", "Photos viewed"],
  ["VIDEO_PLAY", "Videos played"], ["AUDIO_PLAY", "Audio played"], ["DOC_DOWNLOAD", "Documents downloaded"],
  ["ADMIN_CHAT_OPEN", "Admin opened chat"], ["ADMIN_CHAT_RESTORE", "Admin restored chat"], ["ADMIN_CHAT_DELETE", "Admin deleted chat"],
  ["ADMIN_PURGE", "Admin purge"], ["ADMIN_USER_CREATE", "Admin created user"], ["ADMIN_USER_UPDATE", "Admin updated user"],
  ["ADMIN_USER_DELETE", "Admin deleted user"],
];

function describe(e) {
  const chat = <b>{e.chatName || "a chat"}</b>;
  const tgt = e.target ? <b>{name(e.target) || e.target.email || "a user"}{e.target.deleted ? " (deleted)" : ""}</b> : <b>a user</b>;
  switch (e.type) {
    case "LOGIN": return "signed in";
    case "SIGNUP": return "signed up";
    case "LOGOUT": return "signed out";
    case "LOGIN_FAILED": return <>failed to sign in{e.meta?.locked ? " — account locked" : e.meta?.whileLocked ? " (while locked)" : e.meta?.disabled ? " (account disabled)" : ""}</>;
    case "ADMIN_CHAT_OPEN": return <>opened {tgt}&apos;s chat {chat}</>;
    case "ADMIN_CHAT_RESTORE": return <>restored {tgt}&apos;s chat {chat}</>;
    case "ADMIN_CHAT_DELETE": return <>permanently deleted {tgt}&apos;s chat {chat}</>;
    case "ADMIN_PURGE": return <>purged {e.meta?.count ?? "?"} deleted chat{e.meta?.count === 1 ? "" : "s"} older than {e.meta?.days ?? "?"} days</>;
    case "ADMIN_USER_CREATE": return <>created user {tgt}</>;
    case "ADMIN_USER_UPDATE": return <>updated {tgt}: {(e.meta?.fields || []).join(", ")}</>;
    case "ADMIN_USER_DELETE": return <>deleted user <b>{e.meta?.email || "unknown"}</b></>;
    default: return activityText(e);
  }
}

export function AuditLog({ users = [] }) {
  const [type, setType] = useState("");
  const [userId, setUserId] = useState("");
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(userId ? { userId } : {}) }).toString();
  const feed = useFeed(`/api/admin/audit${qs ? `?${qs}` : ""}`);
  return (
    <div>
      <div className="admin-head">
        <div>
          <h1>Audit log</h1>
          <p>Every sign-in, chat open, media view and admin action. Kept indefinitely.</p>
        </div>
      </div>
      <div className="audit-filters">
        <div className="input-wrap"><select value={type} onChange={(e) => setType(e.target.value)}>{AUDIT_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="input-wrap">
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{name(u)} ({u.email})</option>)}
          </select>
        </div>
      </div>
      {feed.err && <div className="alert alert-error"><IconAlert size={18} /><div>{feed.err}</div></div>}
      {feed.events && !feed.events.length && <div className="admin-empty">No events{type || userId ? " for this filter" : " yet"}.</div>}
      {feed.events && feed.events.length > 0 && (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Device / IP</th></tr></thead>
            <tbody>
              {feed.events.map((e) => (
                <tr key={e.id} className={e.type.startsWith("ADMIN_") ? "row-admin" : ""}>
                  <td><When at={e.createdAt} /></td>
                  <td>
                    <div className="who">
                      {e.type.startsWith("ADMIN_") && <IconShield size={13} />}
                      <span>{name(e.actor) || "—"}</span>
                    </div>
                    <small className="muted">{e.actor?.email}</small>
                  </td>
                  <td>{describe(e)}</td>
                  <td><span>{e.device.label}</span><br /><small className="muted mono">{e.ip || "—"}{e.city || e.country ? ` · ${place(e)}` : ""}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore feed={feed} />
    </div>
  );
}
