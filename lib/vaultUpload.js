// Browser-side vault upload pipeline.
//
// Exports can be 400–700 MB+, and serverless functions only accept ~4.5 MB
// bodies, so file bytes NEVER go through our API. The browser opens the ZIP
// itself (random access, nothing loaded whole), then PUTs every file straight
// to R2 using short-lived presigned URLs. Our API only handles small JSON.
//
// Order: create chat (UPLOADING) → media files → chat text → complete (READY).

import { openZip, readEntry, isJunkEntry, findChatText } from "./unzip";
import { parseText, previewText, basename, mimeFor } from "./chat";

const CONCURRENCY = 6;
const MAX_RETRIES = 3;
const SIGN_BATCH = 200;
const COMPLETE_CHUNK = 2000;

export class UploadError extends Error {}

async function api(url, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new UploadError("Network error — check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new UploadError(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

function chatNameFrom(fileName, fallback) {
  const clean = (s) => s.replace(/^WhatsApp Chat with /i, "").replace(/^WhatsApp Chat - /i, "").replace(/\.(zip|txt)$/i, "").trim();
  return clean(fileName) || (fallback ? clean(basename(fallback)) : "") || "WhatsApp Chat";
}

/**
 * Open a .zip or .txt export and work out everything needed for the upload,
 * without reading media into memory.
 */
export async function prepareExport(file) {
  const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
  let text, textBlob, chatEntryName = null;
  const media = [];

  if (isZip) {
    let entries;
    try {
      entries = await openZip(file);
    } catch (err) {
      throw new UploadError(`This doesn't look like a valid ZIP export (${err.message}).`);
    }
    const found = await findChatText(file, entries, parseText);
    if (!found) throw new UploadError("No chat .txt file was found inside this ZIP.");
    text = found.text;
    chatEntryName = found.entry.name;
    textBlob = await readEntry(file, found.entry, "text/plain; charset=utf-8");
    const seen = new Set();
    for (const e of entries) {
      if (e === found.entry || /\.txt$/i.test(e.name) || isJunkEntry(e.name) || e.encrypted) continue;
      if (e.method !== 0 && e.method !== 8) continue;
      const name = basename(e.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      media.push({ name, entry: e, size: e.size });
    }
  } else if (/\.txt$/i.test(file.name)) {
    text = await file.text();
    textBlob = file;
  } else {
    throw new UploadError("Please choose a WhatsApp export: a .zip (with media) or a .txt file.");
  }

  const messages = parseText(text);
  if (!messages.length) throw new UploadError("This file doesn't look like a WhatsApp chat export.");
  const lastReal = [...messages].reverse().find((m) => !m.system);
  const mediaBytes = media.reduce((s, m) => s + m.size, 0);

  return {
    file,
    name: chatNameFrom(file.name, chatEntryName),
    text,
    textBlob,
    media,
    meta: {
      messageCount: messages.length,
      firstDate: messages[0].date || null,
      lastDate: messages[messages.length - 1].date || null,
      preview: lastReal ? previewText(lastReal) : "",
    },
    textBytes: textBlob.size,
    totalBytes: mediaBytes + textBlob.size,
  };
}

// PUT a Blob with XHR (fetch has no upload progress).
function putBlob(url, blob, contentType, signal, onLoaded) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => onLoaded?.(e.loaded);
    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const e = new UploadError(`Storage rejected the upload (${xhr.status}).`);
        e.status = xhr.status;
        reject(e);
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      const e = new UploadError("Couldn't reach cloud storage — check your connection (or the bucket's CORS settings).");
      e.status = 0;
      reject(e);
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(blob);
  });
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/**
 * Upload a prepared export to the vault.
 * @param {object} prep   result of prepareExport()
 * @param {object} opts   { signal, onProgress({phase, bytesDone, bytesTotal, filesDone, filesTotal, speed, eta}) }
 * @returns {Promise<{chatId: string, chat: object}>}
 */
export async function uploadPrepared(prep, { signal: userSignal, onProgress } = {}) {
  // Internal controller: aborted by the user's signal, or by us on the first
  // hard failure so the other parallel uploads stop too.
  const ctrl = new AbortController();
  if (userSignal?.aborted) ctrl.abort();
  userSignal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  const signal = ctrl.signal;
  const filesTotal = prep.media.length + 1; // + the chat text
  const bytesTotal = prep.totalBytes;
  let doneBytes = 0;
  let filesDone = 0;
  const inflight = new Map(); // index -> loaded bytes
  const samples = [];
  let phase = "starting";

  const snapshot = () => {
    let loaded = doneBytes;
    for (const v of inflight.values()) loaded += v;
    loaded = Math.min(loaded, bytesTotal);
    const now = performance.now();
    samples.push({ t: now, b: loaded });
    while (samples.length > 2 && now - samples[0].t > 8000) samples.shift();
    const first = samples[0];
    const dt = (now - first.t) / 1000;
    const speed = dt > 0.5 ? Math.max(0, (loaded - first.b) / dt) : 0;
    const eta = speed > 0 ? (bytesTotal - loaded) / speed : null;
    return { phase, bytesDone: loaded, bytesTotal, filesDone, filesTotal, speed, eta };
  };
  const emit = () => onProgress?.(snapshot());
  const ticker = setInterval(emit, 300);

  let chatId = null;
  try {
    phase = "starting";
    emit();
    const created = await api("/api/vault/chats", {
      method: "POST",
      signal,
      body: {
        name: prep.name,
        ...prep.meta,
        mediaCount: prep.media.length,
        totalBytes: prep.totalBytes,
      },
    });
    chatId = created.id;

    /* ---------- media, 6 at a time, presigned lazily in batches ---------- */
    phase = "uploading";
    const files = prep.media.map((m, index) => ({ ...m, index }));
    const batches = new Map(); // batch number -> Promise<Map<index, {key,url}>>
    const signBatch = (b) => {
      if (!batches.has(b)) {
        const slice = files.slice(b * SIGN_BATCH, (b + 1) * SIGN_BATCH);
        const p = api(`/api/vault/chats/${chatId}/sign`, {
          method: "POST",
          signal,
          body: { files: slice.map((f) => ({ index: f.index, name: f.name })) },
        }).then((r) => new Map(r.files.map((x) => [x.index, x])));
        p.catch(() => batches.delete(b)); // allow a retry of a failed batch
        batches.set(b, p);
      }
      return batches.get(b);
    };
    const signOne = async (f) => {
      const r = await api(`/api/vault/chats/${chatId}/sign`, {
        method: "POST",
        signal,
        body: { files: [{ index: f.index, name: f.name }] },
      });
      return r.files[0];
    };

    const uploaded = [];
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const f = files[next++];
        const blob = await readEntry(prep.file, f.entry, mimeFor(f.name));
        let signed = (await signBatch(Math.floor(f.index / SIGN_BATCH))).get(f.index);
        for (let attempt = 0; ; attempt++) {
          try {
            inflight.set(f.index, 0);
            await putBlob(signed.url, blob, mimeFor(f.name), signal, (n) => inflight.set(f.index, n));
            break;
          } catch (err) {
            inflight.delete(f.index);
            if (err?.name === "AbortError" || attempt >= MAX_RETRIES) throw err;
            await sleep(1000 * 2 ** attempt + Math.random() * 400, signal);
            signed = await signOne(f); // fresh URL in case the old one expired
          }
        }
        inflight.delete(f.index);
        doneBytes += blob.size;
        filesDone++;
        uploaded.push({ name: f.name, key: signed.key, size: blob.size });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    /* ---------- chat text last ---------- */
    for (let attempt = 0; ; attempt++) {
      try {
        const { textUploadUrl } = await api(`/api/vault/chats/${chatId}/sign`, {
          method: "POST",
          signal,
          body: { files: [], text: true },
        });
        inflight.set(-1, 0);
        await putBlob(textUploadUrl, prep.textBlob, "text/plain; charset=utf-8", signal, (n) => inflight.set(-1, n));
        break;
      } catch (err) {
        inflight.delete(-1);
        if (err?.name === "AbortError" || attempt >= MAX_RETRIES) throw err;
        await sleep(1000 * 2 ** attempt, signal);
      }
    }
    inflight.delete(-1);
    doneBytes += prep.textBlob.size;
    filesDone++;

    /* ---------- register media + mark READY ---------- */
    phase = "finishing";
    emit();
    for (let i = 0; i < uploaded.length; i += COMPLETE_CHUNK) {
      await api(`/api/vault/chats/${chatId}/complete`, {
        method: "POST",
        signal,
        body: { media: uploaded.slice(i, i + COMPLETE_CHUNK) },
      });
    }
    const done = await api(`/api/vault/chats/${chatId}/complete`, {
      method: "POST",
      signal,
      body: { media: [], final: true, textBytes: prep.textBlob.size },
    });
    phase = "done";
    emit();
    return { chatId, chat: done.chat };
  } catch (err) {
    const cancelled = !!userSignal?.aborted;
    ctrl.abort();
    if (chatId) {
      if (cancelled) {
        // cancelled by the user: remove the partial upload from their vault (soft delete)
        fetch(`/api/vault/chats/${chatId}`, { method: "DELETE" }).catch(() => {});
      } else {
        fetch(`/api/vault/chats/${chatId}/fail`, { method: "POST" }).catch(() => {});
      }
    }
    throw cancelled ? new DOMException("Aborted", "AbortError") : err;
  } finally {
    clearInterval(ticker);
  }
}

export function formatBytes(n) {
  if (n == null) return "Unlimited";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function formatEta(sec) {
  if (sec == null || !isFinite(sec)) return "estimating…";
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s left`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}
