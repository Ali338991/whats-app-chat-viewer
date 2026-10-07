"use client";

// Client-side reporter for media activity in the vault (photo views, video /
// audio plays, document downloads). Used ONLY by /vault — local mode and the
// admin viewer never send anything.
//
// - dedupe: the same type + file counts once per 10 minutes
// - batched: flushed every ~5s, and on tab hide / page hide via sendBeacon
import { useCallback, useEffect, useRef } from "react";

const DEDUPE_MS = 10 * 60 * 1000;
const FLUSH_MS = 5000;
const MAX_BATCH = 50;
const ALLOWED = new Set(["MEDIA_VIEW", "VIDEO_PLAY", "AUDIO_PLAY", "DOC_DOWNLOAD"]);

function send(chatId, events, useBeacon) {
  const body = JSON.stringify({ chatId, events });
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon("/api/vault/events", new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    } catch { /* fall through */ }
  }
  fetch("/api/vault/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => { /* activity logging must never bother the user */ });
}

export function useMediaEventReporter(chatId) {
  const queue = useRef([]); // [{chatId, type, mediaName}]
  const seen = useRef(new Map()); // "chat|type|name" -> timestamp

  const flush = useCallback((useBeacon = false) => {
    if (!queue.current.length) return;
    const items = queue.current;
    queue.current = [];
    const byChat = new Map();
    for (const e of items) {
      if (!byChat.has(e.chatId)) byChat.set(e.chatId, []);
      byChat.get(e.chatId).push({ type: e.type, mediaName: e.mediaName });
    }
    for (const [cid, events] of byChat) {
      for (let i = 0; i < events.length; i += MAX_BATCH) send(cid, events.slice(i, i + MAX_BATCH), useBeacon);
    }
  }, []);

  const report = useCallback((type, mediaName) => {
    if (!chatId || !ALLOWED.has(type) || !mediaName) return;
    const key = `${chatId}|${type}|${mediaName}`;
    const now = Date.now();
    const last = seen.current.get(key);
    if (last && now - last < DEDUPE_MS) return;
    seen.current.set(key, now);
    queue.current.push({ chatId, type, mediaName });
  }, [chatId]);

  useEffect(() => {
    const t = setInterval(() => flush(false), FLUSH_MS);
    const onHide = () => { if (document.visibilityState === "hidden") flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      flush(true);
    };
  }, [flush]);

  return report;
}
