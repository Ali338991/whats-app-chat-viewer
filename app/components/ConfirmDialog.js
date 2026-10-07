"use client";

import { useEffect, useState } from "react";
import { IconAlert } from "./Icons";

// Small confirm modal with custom button labels.
// `requireText`: the user must type this exact text to enable the confirm button.
export default function ConfirmDialog({
  title, message, confirmLabel = "Confirm", cancelLabel = "Cancel",
  danger = false, requireText = null, busy = false, onConfirm, onCancel,
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  const ok = !requireText || typed.trim() === requireText;
  return (
    <div className="modal-bg" style={{ zIndex: 95 }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true">
        <div className={`confirm-ic${danger ? " danger" : ""}`}><IconAlert size={22} /></div>
        <h3 className="confirm-title">{title}</h3>
        {message && <div className="confirm-msg">{message}</div>}
        {requireText && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>Type <b>{requireText}</b> to confirm</span>
            <div className="input-wrap"><input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></div>
          </label>
        )}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} onClick={onConfirm} disabled={!ok || busy} autoFocus={!requireText}>
            {busy ? <><span className="btn-spinner" /> Working…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
