"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconEye, IconEyeOff, IconAlert, IconLogo } from "./Icons";
import { BRAND_NAME } from "../../lib/brand";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function PasswordInput({ id, value, onChange, autoComplete, placeholder, invalid, onBlur }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`input-wrap${invalid ? " invalid" : ""}`}>
      <input
        id={id} type={show ? "text" : "password"} value={value} onChange={onChange} onBlur={onBlur}
        autoComplete={autoComplete} placeholder={placeholder} maxLength={200}
      />
      <button type="button" className="input-eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}>
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}

function MobileBrand() {
  return <Link href="/" className="brand auth-mobile-brand"><IconLogo size={30} /><span>{BRAND_NAME}</span></Link>;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/* ======================= Sign in ======================= */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null); // {msg, locked}

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) { setErr({ msg: "Enter your email and password." }); return; }
    setBusy(true);
    setErr(null);
    try {
      const { res, data } = await postJson("/api/auth/login", { email, password });
      if (!res.ok) {
        setErr({ msg: data.error || "Couldn't sign in. Please try again.", locked: res.status === 429 });
        setBusy(false);
        return;
      }
      router.replace(data.user?.role === "ADMIN" ? "/admin" : data.user?.onboarded ? "/vault" : "/onboarding");
      router.refresh();
    } catch {
      setErr({ msg: "Network error — check your connection and try again." });
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <MobileBrand />
      <h2>Welcome back</h2>
      <p className="auth-lead">Sign in to open your vault.</p>
      {err && (
        <div className={`alert ${err.locked ? "alert-warn" : "alert-error"}`} role="alert">
          <IconAlert size={18} /><div>{err.msg}</div>
        </div>
      )}
      <label className="field">
        <span>Email</span>
        <div className="input-wrap">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" autoFocus maxLength={254} />
        </div>
      </label>
      <label className="field">
        <span>Password</span>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Your password" />
      </label>
      <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
        {busy ? <><span className="btn-spinner" /> Signing in…</> : "Sign in"}
      </button>
      <div className="auth-switch">New here? <Link href="/signup">Create an account</Link></div>
      <div className="auth-alt"><Link href="/">← Use without an account</Link></div>
    </form>
  );
}

/* ======================= Sign up ======================= */
function strength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return { level: 0, label: "Too short — use at least 8 characters" };
  if (score <= 2) return { level: 1, label: "Weak — add length, numbers or symbols" };
  if (score === 3) return { level: 2, label: "Okay — a bit longer would be stronger" };
  if (score === 4) return { level: 3, label: "Strong" };
  return { level: 4, label: "Very strong" };
}

export function SignupForm({ enabled = true }) {
  const router = useRouter();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [serverFields, setServerFields] = useState({});

  const set = (k) => (e) => { setF((s) => ({ ...s, [k]: e.target.value })); setServerFields((s) => ({ ...s, [k]: undefined })); };
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const errors = useMemo(() => {
    const e = {};
    if (!f.firstName.trim()) e.firstName = "Enter your first name.";
    if (!f.lastName.trim()) e.lastName = "Enter your last name.";
    if (!f.email.trim()) e.email = "Enter your email.";
    else if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
    if (!f.password) e.password = "Choose a password.";
    else if (f.password.length < 8) e.password = "Use at least 8 characters.";
    else if (f.password.length > 72 || new TextEncoder().encode(f.password).length > 72) e.password = "Use at most 72 characters.";
    if (!f.confirmPassword) e.confirmPassword = "Confirm your password.";
    else if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match.";
    return e;
  }, [f]);

  const show = (k) => (submitted || touched[k]) && (errors[k] || serverFields[k]) ? (serverFields[k] || errors[k]) : null;
  const st = strength(f.password);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setServerErr("");
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const { res, data } = await postJson("/api/auth/signup", { ...f, email: f.email.trim() });
      if (!res.ok) {
        setServerFields(data.fields || {});
        if (!data.fields) setServerErr(data.error || "Couldn't create your account. Please try again.");
        setBusy(false);
        return;
      }
      router.replace("/onboarding");
      router.refresh();
    } catch {
      setServerErr("Network error — check your connection and try again.");
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className="auth-form">
        <MobileBrand />
        <h2>Sign-ups are closed</h2>
        <p className="auth-lead">We&apos;re not accepting new accounts right now. If you already have one, sign in below.</p>
        <Link href="/login" className="btn btn-primary btn-block btn-lg">Sign in</Link>
        <div className="auth-alt"><Link href="/">← Use without an account</Link></div>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <MobileBrand />
      <h2>Create your vault</h2>
      <p className="auth-lead">Keep your chats — and every photo, video and voice note — safe forever.</p>
      {serverErr && <div className="alert alert-error" role="alert"><IconAlert size={18} /><div>{serverErr}</div></div>}
      <div className="field-row">
        <label className="field">
          <span>First name</span>
          <div className={`input-wrap${show("firstName") ? " invalid" : ""}`}>
            <input value={f.firstName} onChange={set("firstName")} onBlur={touch("firstName")} autoComplete="given-name" maxLength={60} autoFocus />
          </div>
          {show("firstName") && <small className="field-err">{show("firstName")}</small>}
        </label>
        <label className="field">
          <span>Last name</span>
          <div className={`input-wrap${show("lastName") ? " invalid" : ""}`}>
            <input value={f.lastName} onChange={set("lastName")} onBlur={touch("lastName")} autoComplete="family-name" maxLength={60} />
          </div>
          {show("lastName") && <small className="field-err">{show("lastName")}</small>}
        </label>
      </div>
      <label className="field">
        <span>Email</span>
        <div className={`input-wrap${show("email") ? " invalid" : ""}`}>
          <input type="email" value={f.email} onChange={set("email")} onBlur={touch("email")} autoComplete="email" placeholder="you@example.com" maxLength={254} />
        </div>
        {show("email") && <small className="field-err">{show("email")}</small>}
      </label>
      <label className="field">
        <span>Password</span>
        <PasswordInput value={f.password} onChange={set("password")} onBlur={touch("password")} autoComplete="new-password" placeholder="8–72 characters" invalid={!!show("password")} />
        {st && !show("password") && (
          <div className={`strength s${st.level}`}>
            <div className="strength-bars">{[0, 1, 2, 3].map((i) => <i key={i} className={i < st.level ? "on" : ""} />)}</div>
            <small>{st.label}</small>
          </div>
        )}
        {show("password") && <small className="field-err">{show("password")}</small>}
      </label>
      <label className="field">
        <span>Confirm password</span>
        <PasswordInput value={f.confirmPassword} onChange={set("confirmPassword")} onBlur={touch("confirmPassword")} autoComplete="new-password" placeholder="Type it again" invalid={!!show("confirmPassword")} />
        {show("confirmPassword") && <small className="field-err">{show("confirmPassword")}</small>}
      </label>
      <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
        {busy ? <><span className="btn-spinner" /> Creating account…</> : "Create account"}
      </button>
      <div className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></div>
      <div className="auth-alt"><Link href="/">← Use without an account</Link></div>
    </form>
  );
}
