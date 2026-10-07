"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatBytes } from "../../lib/vaultUpload";
import { initial, avatarColor } from "../../lib/chat";
import { useTheme } from "../../lib/useTheme";
import { BRAND_NAME } from "../../lib/brand";
import {
  IconLogo, IconSun, IconMoon, IconBack, IconPlus, IconTrash, IconKey, IconAlert, IconLock, IconClose, IconEye, IconEyeOff,
  IconChat, IconImage, IconUsers,
} from "../components/Icons";

const AdminChatViewer = dynamic(() => import("./AdminChatViewer"), { ssr: false });

const GB = 1024 ** 3;

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const gbToBytes = (v) => (v === "" || v == null ? null : Math.round(Number(v) * GB));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

function CreateUser({ onCreated, onClose }) {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", password: "", role: "USER", quotaGb: "5" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (f.quotaGb !== "" && (!Number.isFinite(Number(f.quotaGb)) || Number(f.quotaGb) < 0)) { setErr("Quota must be a number of GB (empty = unlimited)."); return; }
    setBusy(true);
    try {
      const d = await api("/api/admin/users", "POST", {
        firstName: f.firstName, lastName: f.lastName, email: f.email, password: f.password, role: f.role,
        storageLimitBytes: gbToBytes(f.quotaGb),
      });
      onCreated(d.user);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal admin-form" onSubmit={submit}>
        <h3>New user <button type="button" className="icon-btn" onClick={onClose}><IconClose /></button></h3>
        {err && <div className="alert alert-error"><IconAlert size={18} /><div>{err}</div></div>}
        <div className="field-row">
          <label className="field"><span>First name</span><div className="input-wrap"><input value={f.firstName} onChange={set("firstName")} required maxLength={60} /></div></label>
          <label className="field"><span>Last name</span><div className="input-wrap"><input value={f.lastName} onChange={set("lastName")} maxLength={60} /></div></label>
        </div>
        <label className="field"><span>Email</span><div className="input-wrap"><input type="email" value={f.email} onChange={set("email")} required maxLength={254} /></div></label>
        <label className="field">
          <span>Password</span>
          <div className="input-wrap">
            <input type={show ? "text" : "password"} value={f.password} onChange={set("password")} required minLength={8} maxLength={72} autoComplete="new-password" placeholder="8–72 characters" />
            <button type="button" className="input-eye" onClick={() => setShow((s) => !s)}>{show ? <IconEyeOff size={18} /> : <IconEye size={18} />}</button>
          </div>
        </label>
        <div className="field-row">
          <label className="field"><span>Role</span>
            <div className="input-wrap"><select value={f.role} onChange={set("role")}><option value="USER">User</option><option value="ADMIN">Admin</option></select></div>
          </label>
          <label className="field"><span>Storage quota (GB)</span>
            <div className="input-wrap"><input type="number" min="0" step="0.5" value={f.quotaGb} onChange={set("quotaGb")} placeholder="Unlimited" /></div>
          </label>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Creating…" : "Create user"}</button>
      </form>
    </div>
  );
}

const fullName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : "");
const ago = (days) => (days == null ? "" : days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`);
const PURGE_DAYS = 30;

/* ---------- one chat row (user detail + deleted list) ---------- */
function ChatRow({ c, showOwner, onOpen, onRestore, onHardDelete, busy }) {
  const ready = c.status === "READY";
  return (
    <div className={`admin-chat-row${busy ? " busy" : ""}`}>
      <span className="avatar" style={{ background: avatarColor(c.name) }}>{initial(c.name)}</span>
      <div className="acr-info">
        <div className="acr-top">
          <b className="acr-name">{c.name}</b>
          {c.status === "UPLOADING" && <span className="badge badge-info">Uploading</span>}
          {c.status === "FAILED" && <span className="badge badge-error">Failed</span>}
          {c.deletedAt && <span className="badge badge-warn">Deleted {ago(c.daysSinceDeleted)}</span>}
          {c.deletedAt && c.daysSinceDeleted >= PURGE_DAYS && <span className="badge badge-error">{PURGE_DAYS}+ days</span>}
        </div>
        <div className="acr-meta">
          {showOwner && c.owner && <span title={c.owner.email}><IconUsers size={12} /> {fullName(c.owner)}</span>}
          <span><IconChat size={12} /> {c.messageCount.toLocaleString()}</span>
          <span><IconImage size={12} /> {c.mediaCount.toLocaleString()}</span>
          <span>{formatBytes(c.totalBytes)}</span>
          <span>Uploaded {fmtDate(c.createdAt)}</span>
        </div>
      </div>
      <div className="acr-actions">
        {ready && <button className="btn btn-ghost btn-xs" onClick={() => onOpen(c)}>Open</button>}
        {c.deletedAt && <button className="btn btn-ghost btn-xs" onClick={() => onRestore(c)}>Restore</button>}
        <button className="btn btn-danger btn-xs" onClick={() => onHardDelete(c)}><IconTrash size={13} /> Delete permanently</button>
      </div>
    </div>
  );
}

/* ---------- shared chat actions (restore / permanent delete with confirm) ---------- */
function useChatActions(onChanged) {
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const restore = async (c) => {
    setBusyId(c.id);
    try { await api(`/api/admin/chats/${c.id}/restore`, "POST"); await onChanged(); }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  };

  const askHardDelete = (c) => setConfirm(c);

  const dialog = confirm ? (
    <ConfirmDialog
      title={`Permanently delete “${confirm.name}”?`}
      message={
        <>
          All messages and {confirm.mediaCount.toLocaleString()} media file{confirm.mediaCount === 1 ? "" : "s"} ({formatBytes(confirm.totalBytes)}) will be erased from storage.
          This can&apos;t be undone.
          {!confirm.deletedAt && <><br /><br /><b>This chat is still active</b> — the owner can currently see it in their vault.</>}
        </>
      }
      confirmLabel="Delete permanently"
      danger
      requireText={confirm.deletedAt ? null : "DELETE"}
      busy={busyId === confirm.id}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        const c = confirm;
        setBusyId(c.id);
        try { await api(`/api/admin/chats/${c.id}`, "DELETE"); setConfirm(null); await onChanged(); }
        catch (e) { alert(e.message); }
        finally { setBusyId(null); }
      }}
    />
  ) : null;

  return { restore, askHardDelete, dialog, busyId };
}

/* ---------- user detail ---------- */
function UserDetail({ userId, onBack, onOpen, onChanged }) {
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState(null);
  const [tab, setTab] = useState("active");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([api(`/api/admin/users/${userId}`), api(`/api/admin/users/${userId}/chats`)]);
      setUser(u.user); setChats(c.chats); setErr("");
    } catch (e) { setErr(e.message); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const { restore, askHardDelete, dialog, busyId } = useChatActions(async () => { await load(); onChanged?.(); });
  const active = (chats || []).filter((c) => !c.deletedAt);
  const removed = (chats || []).filter((c) => c.deletedAt);
  const shown = tab === "active" ? active : removed;
  const pct = user?.storageLimitBytes ? Math.min(100, (user.usedBytes / user.storageLimitBytes) * 100) : 0;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 18 }}><IconBack size={16} /> All users</button>
      {err && <div className="alert alert-error"><IconAlert size={18} /><div>{err}</div></div>}
      {!user && !err && <div className="admin-loading"><div className="spinner" /></div>}
      {user && (
        <>
          <div className="user-profile">
            <span className="avatar lg" style={{ background: avatarColor(fullName(user)) }}>{initial(fullName(user))}</span>
            <div className="up-id">
              <h1>{fullName(user)}</h1>
              <p>{user.email} · {user.role === "ADMIN" ? "Admin" : "User"}{user.active ? "" : " · Disabled"} · joined {fmtDate(user.createdAt)} · last sign-in {fmtDate(user.lastLoginAt)}</p>
            </div>
          </div>
          <div className="usage-cards">
            <div className="usage-card">
              <small>Active storage</small>
              <b>{formatBytes(user.usedBytes)}</b>
              <span>{user.chatCount} chat{user.chatCount === 1 ? "" : "s"} · {user.storageLimitBytes != null ? `quota ${formatBytes(user.storageLimitBytes)}` : "unlimited"}</span>
              {user.storageLimitBytes != null && <div className="usage-bar"><div className={pct > 90 ? "warn" : ""} style={{ width: `${Math.max(pct, user.usedBytes ? 1.5 : 0)}%` }} /></div>}
            </div>
            <div className="usage-card">
              <small>Removed by user</small>
              <b>{formatBytes(user.deletedBytes)}</b>
              <span>{user.deletedCount} chat{user.deletedCount === 1 ? "" : "s"} · not counted toward quota</span>
            </div>
          </div>

          <div className="seg admin-seg">
            <button className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active · {active.length}</button>
            <button className={tab === "deleted" ? "on" : ""} onClick={() => setTab("deleted")}>Deleted · {removed.length}</button>
          </div>
          <div className="admin-chat-list">
            {chats && !shown.length && <div className="admin-empty">{tab === "active" ? "No active chats." : "No removed chats."}</div>}
            {shown.map((c) => (
              <ChatRow key={c.id} c={c} busy={busyId === c.id} onOpen={onOpen} onRestore={restore} onHardDelete={askHardDelete} />
            ))}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}

/* ---------- deleted chats across all users ---------- */
function DeletedChats({ onOpen, onChanged }) {
  const [chats, setChats] = useState(null);
  const [err, setErr] = useState("");
  const [purgeAsk, setPurgeAsk] = useState(false);
  const [purge, setPurge] = useState(null); // {deleted, remaining, running, error}

  const load = useCallback(async () => {
    try { setChats((await api("/api/admin/chats?deleted=1")).chats); setErr(""); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { restore, askHardDelete, dialog, busyId } = useChatActions(async () => { await load(); onChanged?.(); });
  const old = (chats || []).filter((c) => c.daysSinceDeleted >= PURGE_DAYS);
  const oldBytes = old.reduce((s, c) => s + c.totalBytes, 0);
  const totalBytes = (chats || []).reduce((s, c) => s + c.totalBytes, 0);

  const runPurge = async () => {
    setPurgeAsk(false);
    let deleted = 0;
    setPurge({ deleted: 0, remaining: old.length, running: true });
    try {
      for (let guard = 0; guard < 10000; guard++) {
        const r = await api("/api/admin/chats/purge", "POST", { olderThanDays: PURGE_DAYS });
        deleted += r.deleted;
        setPurge({ deleted, remaining: r.remaining, running: r.remaining > 0 });
        if (r.remaining === 0 || r.deleted === 0) break;
      }
      setPurge((p) => ({ ...p, running: false }));
    } catch (e) {
      setPurge({ deleted, remaining: null, running: false, error: e.message });
    }
    await load();
    onChanged?.();
  };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1>Deleted chats</h1>
          <p>
            Chats users removed from their vault. They&apos;re hidden from the owner but still stored ({formatBytes(totalBytes)}) until you delete them permanently.
            Nothing is deleted automatically.
          </p>
        </div>
        <button className="btn btn-danger" disabled={!old.length || purge?.running} onClick={() => setPurgeAsk(true)}>
          <IconTrash size={16} /> Permanently delete all deleted &gt; {PURGE_DAYS} days{old.length ? ` (${old.length})` : ""}
        </button>
      </div>
      {purge && (
        <div className={`alert ${purge.error ? "alert-error" : "alert-info"}`}>
          {purge.running ? <span className="btn-spinner dark" /> : <IconAlert size={18} />}
          <div>
            {purge.error
              ? <>Stopped after deleting {purge.deleted} chat{purge.deleted === 1 ? "" : "s"}: {purge.error}</>
              : purge.running
                ? <>Deleting… {purge.deleted} done, {purge.remaining} remaining</>
                : <>Done — permanently deleted {purge.deleted} chat{purge.deleted === 1 ? "" : "s"}.</>}
          </div>
        </div>
      )}
      {err && <div className="alert alert-error"><IconAlert size={18} /><div>{err}</div></div>}
      {!chats && !err && <div className="admin-loading"><div className="spinner" /></div>}
      <div className="admin-chat-list">
        {chats && !chats.length && <div className="admin-empty">No deleted chats. 🎉</div>}
        {(chats || []).map((c) => (
          <ChatRow key={c.id} c={c} showOwner busy={busyId === c.id} onOpen={onOpen} onRestore={restore} onHardDelete={askHardDelete} />
        ))}
      </div>
      {dialog}
      {purgeAsk && (
        <ConfirmDialog
          title={`Permanently delete ${old.length} chat${old.length === 1 ? "" : "s"}?`}
          message={<>Every chat removed more than {PURGE_DAYS} days ago will be erased from storage ({formatBytes(oldBytes)}). This can&apos;t be undone.</>}
          confirmLabel="Delete permanently"
          danger
          requireText="DELETE"
          onCancel={() => setPurgeAsk(false)}
          onConfirm={runPurge}
        />
      )}
    </div>
  );
}

/* ================= main admin app ================= */
export default function AdminApp({ me }) {
  const [dark, toggleTheme] = useTheme();
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("users"); // users | deleted
  const [selectedUser, setSelectedUser] = useState(null);
  const [viewChat, setViewChat] = useState(null);
  const [removeUser, setRemoveUser] = useState(null);

  const load = useCallback(async () => {
    try { setUsers((await api("/api/admin/users")).users); setErr(""); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (u, body, okMsg) => {
    setBusyId(u.id);
    try {
      const d = await api(`/api/admin/users/${u.id}`, "PATCH", body);
      setUsers((list) => list.map((x) => (x.id === u.id ? d.user : x)));
      if (okMsg) alert(okMsg);
    } catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  };

  const resetPassword = (u) => {
    const pw = prompt(`New password for ${u.email} (8–72 characters).\nThis signs them out everywhere.`);
    if (pw == null) return;
    if (pw.length < 8 || pw.length > 72) { alert("Password must be 8–72 characters."); return; }
    patch(u, { password: pw }, "Password updated.");
  };

  const editQuota = (u) => {
    const cur = u.storageLimitBytes == null ? "" : String(+(u.storageLimitBytes / GB).toFixed(2));
    const v = prompt(`Storage quota for ${u.email} in GB (leave empty for unlimited):`, cur);
    if (v == null) return;
    if (v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) { alert("Enter a number of GB."); return; }
    patch(u, { storageLimitBytes: gbToBytes(v.trim()) });
  };

  const doRemoveUser = async () => {
    const u = removeUser;
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, "DELETE");
      setUsers((list) => list.filter((x) => x.id !== u.id));
      setRemoveUser(null);
    } catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  };

  const totals = users
    ? users.reduce((t, u) => ({ bytes: t.bytes + u.usedBytes, deleted: t.deleted + u.deletedBytes, chats: t.chats + u.chatCount }), { bytes: 0, deleted: 0, chats: 0 })
    : null;

  if (viewChat) return <AdminChatViewer chatId={viewChat.id} onBack={() => setViewChat(null)} />;

  return (
    <div className="admin-page">
      <header className="admin-top">
        <Link href="/vault" className="btn btn-ghost btn-sm"><IconBack size={16} /> Vault</Link>
        <div className="brand"><IconLogo size={28} /><span>{BRAND_NAME} <small className="brand-sub">Admin</small></span></div>
        <button className="icon-btn" title="Toggle dark mode" onClick={toggleTheme}>{dark ? <IconSun /> : <IconMoon />}</button>
      </header>

      <main className="admin-main">
        {!selectedUser && (
          <div className="seg admin-seg">
            <button className={tab === "users" ? "on" : ""} onClick={() => setTab("users")}>Users</button>
            <button className={tab === "deleted" ? "on" : ""} onClick={() => setTab("deleted")}>Deleted chats</button>
          </div>
        )}

        {selectedUser ? (
          <UserDetail userId={selectedUser} onBack={() => { setSelectedUser(null); load(); }} onOpen={setViewChat} onChanged={load} />
        ) : tab === "deleted" ? (
          <DeletedChats onOpen={setViewChat} onChanged={load} />
        ) : (
          <>
            <div className="admin-head">
              <div>
                <h1>Users</h1>
                {totals && <p>{users.length} user{users.length === 1 ? "" : "s"} · {totals.chats} active chat{totals.chats === 1 ? "" : "s"} · {formatBytes(totals.bytes)} active · {formatBytes(totals.deleted)} removed by users</p>}
              </div>
              <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={17} /> New user</button>
            </div>

            {err && <div className="alert alert-error"><IconAlert size={18} /><div>{err}</div></div>}
            {!users && !err && <div className="admin-loading"><div className="spinner" /></div>}

            {users && (
              <div className="user-grid">
                {users.map((u) => {
                  const name = fullName(u);
                  const pct = u.storageLimitBytes ? Math.min(100, (u.usedBytes / u.storageLimitBytes) * 100) : 0;
                  const self = u.id === me.id;
                  return (
                    <div key={u.id} className={`user-card${u.active ? "" : " inactive"}${busyId === u.id ? " busy" : ""}`}>
                      <button className="uc-top uc-link" onClick={() => setSelectedUser(u.id)} title="View chats">
                        <span className="avatar" style={{ background: avatarColor(name) }}>{initial(name)}</span>
                        <div className="uc-id">
                          <b>{name}{self && <small className="you"> (you)</small>}</b>
                          <small>{u.email}</small>
                        </div>
                        <div className="uc-badges">
                          {u.role === "ADMIN" && <span className="badge badge-accent">Admin</span>}
                          {!u.active && <span className="badge badge-error">Disabled</span>}
                          {u.locked && <span className="badge badge-warn">Locked</span>}
                        </div>
                      </button>
                      <div className="uc-usage">
                        <div className="usage-top">
                          <span>{u.chatCount} chat{u.chatCount === 1 ? "" : "s"}{u.deletedCount ? ` · ${u.deletedCount} removed` : ""}</span>
                          <span>{formatBytes(u.usedBytes)} {u.storageLimitBytes != null ? `of ${formatBytes(u.storageLimitBytes)}` : "· unlimited"}</span>
                        </div>
                        <div className="usage-bar"><div className={pct > 90 ? "warn" : ""} style={{ width: `${u.storageLimitBytes != null ? Math.max(pct, u.usedBytes ? 1.5 : 0) : 0}%` }} /></div>
                        {u.deletedBytes > 0 && <div className="uc-meta" style={{ marginTop: 6 }}>+ {formatBytes(u.deletedBytes)} removed by user (not counted)</div>}
                      </div>
                      <div className="uc-meta">Joined {fmtDate(u.createdAt)} · Last sign-in {fmtDate(u.lastLoginAt)}</div>
                      <div className="uc-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => setSelectedUser(u.id)}><IconChat size={14} /> Chats</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => resetPassword(u)}><IconKey size={14} /> Password</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => editQuota(u)}>Quota</button>
                        {!self && (
                          <button className="btn btn-ghost btn-xs" onClick={() => patch(u, { role: u.role === "ADMIN" ? "USER" : "ADMIN" })}>
                            {u.role === "ADMIN" ? "Make user" : "Make admin"}
                          </button>
                        )}
                        {u.locked && <button className="btn btn-ghost btn-xs" onClick={() => patch(u, { unlock: true })}><IconLock size={14} /> Unlock</button>}
                        {!self && (
                          <button className="btn btn-ghost btn-xs" onClick={() => patch(u, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>
                        )}
                        {!self && (
                          <button className="btn btn-danger btn-xs" onClick={() => setRemoveUser(u)}><IconTrash size={14} /> Delete</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(u) => { setCreating(false); setUsers((list) => [...(list || []), u]); }}
        />
      )}
      {removeUser && (
        <ConfirmDialog
          title={`Delete ${removeUser.email}?`}
          message={<>This permanently deletes their account and all {removeUser.chatCount + removeUser.deletedCount} chat(s), including ones they removed — {formatBytes(removeUser.usedBytes + removeUser.deletedBytes)} of stored files. This can&apos;t be undone.</>}
          confirmLabel="Delete user"
          danger
          requireText="DELETE"
          busy={busyId === removeUser.id}
          onCancel={() => setRemoveUser(null)}
          onConfirm={doRemoveUser}
        />
      )}
    </div>
  );
}
