"use client";

// Upload a WhatsApp export to the vault: drop zone → calm full-panel progress
// → success. Used by /onboarding and the /vault upload dialog.

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareExport, uploadPrepared, formatBytes, formatEta } from "../../lib/vaultUpload";
import { IconUpload, IconCheck, IconAlert, IconLock } from "./Icons";

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export default function UploadPanel({ initialFile = null, onUploaded, onCancel, onBusyChange, title = "Upload a chat" }) {
  const [state, setState] = useState("idle"); // idle | preparing | uploading | success | error
  const [progress, setProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [over, setOver] = useState(false);
  const ctrlRef = useRef(null);
  const inputRef = useRef(null);
  const startedRef = useRef(false);

  const busy = state === "preparing" || state === "uploading";
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!busy) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const start = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);
    setErrorMsg("");
    setProgress(null);
    setState("preparing");
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const prep = await prepareExport(file);
      if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setProgress({ phase: "starting", bytesDone: 0, bytesTotal: prep.totalBytes, filesDone: 0, filesTotal: prep.media.length + 1, speed: 0, eta: null });
      setState("uploading");
      const { chat } = await uploadPrepared(prep, { signal: ctrl.signal, onProgress: setProgress });
      setState("success");
      setTimeout(() => onUploaded?.(chat), 1400);
    } catch (err) {
      if (err?.name === "AbortError") {
        setState("idle");
        setProgress(null);
        return;
      }
      console.error(err);
      setErrorMsg(err?.message || "Something went wrong during the upload.");
      setState("error");
    } finally {
      ctrlRef.current = null;
    }
  }, [onUploaded]);

  useEffect(() => {
    if (initialFile && !startedRef.current) {
      startedRef.current = true;
      start(initialFile);
    }
  }, [initialFile, start]);

  const cancel = () => {
    if (busy) {
      if (!confirm("Cancel this upload? Files uploaded so far will be removed.")) return;
      ctrlRef.current?.abort();
    } else onCancel?.();
  };

  const pct = progress && progress.bytesTotal ? Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100) : 0;

  if (state === "preparing" || state === "uploading") {
    const p = progress;
    const phaseLabel =
      state === "preparing" ? "Reading your export…" :
      p?.phase === "starting" ? "Preparing upload…" :
      p?.phase === "finishing" ? "Finishing up…" : "Uploading your memories…";
    return (
      <div className="upload-progress">
        <div className="ring-wrap">
          <svg className="ring" width="148" height="148" viewBox="0 0 132 132" aria-hidden="true">
            <circle cx="66" cy="66" r={RING_R} className="ring-bg" />
            <circle
              cx="66" cy="66" r={RING_R} className="ring-fg"
              strokeDasharray={RING_C}
              strokeDashoffset={state === "preparing" ? RING_C * 0.75 : RING_C * (1 - pct / 100)}
              style={state === "preparing" ? { animation: "spin 1.1s linear infinite", transformOrigin: "center" } : undefined}
            />
          </svg>
          <div className="ring-label">{state === "preparing" ? <IconUpload size={30} /> : `${Math.floor(pct)}%`}</div>
        </div>
        <div className="up-title">{phaseLabel}</div>
        <div className="up-sub">Keep this tab open — it&apos;s safe to use other apps.</div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${state === "preparing" ? 2 : pct}%` }} /></div>
        {p && state === "uploading" ? (
          <div className="up-stats">
            <span>{formatBytes(p.bytesDone)} of {formatBytes(p.bytesTotal)}</span>
            <span className="dot">·</span>
            <span>{p.filesDone.toLocaleString()} of {p.filesTotal.toLocaleString()} files</span>
            <span className="dot">·</span>
            <span>{p.phase === "finishing" ? "almost there" : formatEta(p.eta)}{p.speed > 0 && p.phase === "uploading" ? ` · ${formatBytes(p.speed)}/s` : ""}</span>
          </div>
        ) : (
          <div className="up-stats"><span>{fileName}</span></div>
        )}
        <button className="btn btn-ghost" onClick={cancel} disabled={p?.phase === "finishing"}>Cancel</button>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="upload-progress">
        <div className="success-badge"><IconCheck size={40} /></div>
        <div className="up-title">All done — your chat is safely stored</div>
        <div className="up-sub">Opening it now…</div>
      </div>
    );
  }

  return (
    <div className="upload-idle">
      {title && <h3 className="upload-title">{title}</h3>}
      {state === "error" && (
        <div className="alert alert-error">
          <IconAlert size={18} />
          <div><b>Upload failed.</b> {errorMsg}<br /><small>The incomplete upload is listed in your vault — delete it and try again.</small></div>
        </div>
      )}
      <label
        className={`dropzone${over ? " over" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation(); setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) start(f);
        }}
      >
        <input
          ref={inputRef} type="file" accept=".zip,.txt,application/zip,text/plain" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) start(f); }}
        />
        <div className="dz-icon"><IconUpload size={28} /></div>
        <div className="dz-title">Drop your WhatsApp export here</div>
        <div className="dz-sub">A <b>.zip</b> exported <i>with media</i> (or a .txt). Large files are fine.</div>
        <span className="btn btn-primary">Choose file</span>
      </label>
      <div className="dz-foot"><IconLock size={14} /> Uploaded straight to your private, encrypted-at-rest storage.</div>
    </div>
  );
}
