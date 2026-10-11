"use client";

import { useEffect, useState } from "react";
import { PasswordInput, StrengthMeter } from "./AuthForms";
import { IconAlert, IconClose, IconCheck } from "./Icons";

async function send(url, method, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function pwProblem(pw) {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72 || new TextEncoder().encode(pw).length > 72) return "Password must be at most 72 characters.";
  return null;
}

function Dialog({ title, onClose, busy, onSubmit, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="modal-bg" style={{ zIndex: 95 }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal admin-form" onSubmit={onSubmit} noValidate>
        <h3>{title} <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><IconClose /></button></h3>
        {children}
      </form>
    </div>
  );
}

function ErrorBox({ msg }) {
  return msg ? <div className="alert alert-error"><IconAlert size={18} /><div>{msg}</div></div> : null;
}

function Done({ title, text, onClose }) {
  return (
    <div className="dialog-done">
      <div className="dialog-done-ic"><IconCheck size={26} /></div>
      <b>{title}</b>
      <p>{text}</p>
      <button type="button" className="btn btn-primary btn-block" onClick={onClose} autoFocus>Done</button>
    </div>
  );
}

/* ---------- signed-in user: change own password ---------- */
export function ChangePasswordDialog({ onClose }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.current) return setErr("Enter your current password.");
    const p = pwProblem(f.next);
    if (p) return setErr(p);
    if (f.next !== f.confirm) return setErr("The new passwords don't match.");
    if (f.next === f.current) return setErr("Choose a password different from your current one.");
    setBusy(true);
    try {
      await send("/api/auth/password", "POST", { currentPassword: f.current, newPassword: f.next });
      setDone(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Change password" onClose={onClose} busy={busy} onSubmit={submit}>
      {done ? (
        <Done title="Password updated" text="You're still signed in here. Any other devices have been signed out." onClose={onClose} />
      ) : (
        <>
          <ErrorBox msg={err} />
          <label className="field">
            <span>Current password</span>
            <PasswordInput value={f.current} onChange={set("current")} autoComplete="current-password" />
          </label>
          <label className="field">
            <span>New password</span>
            <PasswordInput value={f.next} onChange={set("next")} autoComplete="new-password" placeholder="8–72 characters" />
            <StrengthMeter password={f.next} />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <PasswordInput value={f.confirm} onChange={set("confirm")} autoComplete="new-password" invalid={!!f.confirm && f.confirm !== f.next} />
            {f.confirm && f.confirm !== f.next && <small className="field-err">Passwords don&apos;t match.</small>}
          </label>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
        </>
      )}
    </Dialog>
  );
}

/* ---------- admin: set a new password for a user ---------- */
export function SetPasswordDialog({ user, onClose, onSaved }) {
  const [f, setF] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const p = pwProblem(f.next);
    if (p) return setErr(p);
    if (f.next !== f.confirm) return setErr("The passwords don't match.");
    setBusy(true);
    try {
      const d = await send(`/api/admin/users/${user.id}`, "PATCH", { password: f.next });
      onSaved?.(d.user, "Password updated — they've been signed out everywhere.");
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Set new password" onClose={onClose} busy={busy} onSubmit={submit}>
      <p className="dialog-sub">For <b>{user.email}</b>. They&apos;ll be signed out on every device and must use the new password.</p>
      <ErrorBox msg={err} />
      <label className="field">
        <span>New password</span>
        <PasswordInput value={f.next} onChange={set("next")} autoComplete="new-password" placeholder="8–72 characters" />
        <StrengthMeter password={f.next} />
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <PasswordInput value={f.confirm} onChange={set("confirm")} autoComplete="new-password" invalid={!!f.confirm && f.confirm !== f.next} />
        {f.confirm && f.confirm !== f.next && <small className="field-err">Passwords don&apos;t match.</small>}
      </label>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
    </Dialog>
  );
}

/* ---------- admin: change a user's email ---------- */
export function ChangeEmailDialog({ user, onClose, onSaved }) {
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return setErr("Enter a valid email address.");
    if (v === user.email) return onClose();
    setBusy(true);
    try {
      const d = await send(`/api/admin/users/${user.id}`, "PATCH", { email: v });
      onSaved?.(d.user, `Email changed — they now sign in with ${v}.`);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Change email" onClose={onClose} busy={busy} onSubmit={submit}>
      <p className="dialog-sub">Currently <b>{user.email}</b>. The new email becomes their sign-in ID; their password stays the same.</p>
      <ErrorBox msg={err} />
      <label className="field">
        <span>New email</span>
        <div className="input-wrap"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoFocus autoComplete="off" /></div>
      </label>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Change email"}</button>
    </Dialog>
  );
}
