"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes } from "../../lib/vaultUpload";
import { initial, avatarColor } from "../../lib/chat";
import { useTheme } from "../../lib/useTheme";
import { BRAND_NAME } from "../../lib/brand";
import {
  IconLogo, IconSun, IconMoon, IconBack, IconPlus, IconTrash, IconKey, IconAlert, IconLock, IconClose, IconEye, IconEyeOff,
} from "../components/Icons";

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

export default function AdminApp({ me }) {
  const [dark, toggleTheme] = useTheme();
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

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

  const remove = async (u) => {
    if (!confirm(`Delete ${u.email}?\n\nThis permanently deletes their account, ${u.chatCount} chat(s) and ${formatBytes(u.usedBytes)} of stored files. This can't be undone.`)) return;
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, "DELETE");
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  };

  const totals = users ? users.reduce((t, u) => ({ bytes: t.bytes + u.usedBytes, chats: t.chats + u.chatCount }), { bytes: 0, chats: 0 }) : null;

  return (
    <div className="admin-page">
      <header className="admin-top">
        <Link href="/vault" className="btn btn-ghost btn-sm"><IconBack size={16} /> Vault</Link>
        <div className="brand"><IconLogo size={28} /><span>{BRAND_NAME} <small className="brand-sub">Admin</small></span></div>
        <button className="icon-btn" title="Toggle dark mode" onClick={toggleTheme}>{dark ? <IconSun /> : <IconMoon />}</button>
      </header>

      <main className="admin-main">
        <div className="admin-head">
          <div>
            <h1>Users</h1>
            {totals && <p>{users.length} user{users.length === 1 ? "" : "s"} · {totals.chats} chat{totals.chats === 1 ? "" : "s"} · {formatBytes(totals.bytes)} stored</p>}
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={17} /> New user</button>
        </div>

        {err && <div className="alert alert-error"><IconAlert size={18} /><div>{err}</div></div>}
        {!users && !err && <div className="admin-loading"><div className="spinner" /></div>}

        {users && (
          <div className="user-grid">
            {users.map((u) => {
              const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
              const pct = u.storageLimitBytes ? Math.min(100, (u.usedBytes / u.storageLimitBytes) * 100) : 0;
              const self = u.id === me.id;
              return (
                <div key={u.id} className={`user-card${u.active ? "" : " inactive"}${busyId === u.id ? " busy" : ""}`}>
                  <div className="uc-top">
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
                  </div>
                  <div className="uc-usage">
                    <div className="usage-top">
                      <span>{u.chatCount} chat{u.chatCount === 1 ? "" : "s"}</span>
                      <span>{formatBytes(u.usedBytes)} {u.storageLimitBytes != null ? `of ${formatBytes(u.storageLimitBytes)}` : "· unlimited"}</span>
                    </div>
                    <div className="usage-bar"><div className={pct > 90 ? "warn" : ""} style={{ width: `${u.storageLimitBytes != null ? Math.max(pct, u.usedBytes ? 1.5 : 0) : 0}%` }} /></div>
                  </div>
                  <div className="uc-meta">Joined {fmtDate(u.createdAt)} · Last sign-in {fmtDate(u.lastLoginAt)}</div>
                  <div className="uc-actions">
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
                      <button className="btn btn-danger btn-xs" onClick={() => remove(u)}><IconTrash size={14} /> Delete</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(u) => { setCreating(false); setUsers((list) => [...(list || []), u]); }}
        />
      )}
    </div>
  );
}
