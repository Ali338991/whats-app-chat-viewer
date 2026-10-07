// Client helpers for chat detail responses (vault + admin viewer).

export async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// filename → URL maps from a chat detail response (full URLs, or the compact form).
// `downloadBase` is the route that serves original-filename downloads.
export function buildMediaMaps(detail, downloadBase = "/api/vault/media/") {
  const mediaUrls = {};
  const downloadUrls = {};
  const s = detail.signing;
  for (const m of detail.media || []) {
    const url = m.url || (s && `${s.base}${m.path}?${s.query}&response-content-type=${encodeURIComponent(m.mime)}&X-Amz-Signature=${m.sig}`);
    if (!url) continue;
    mediaUrls[m.name] = url;
    downloadUrls[m.name] = `${downloadBase}${m.id}?download=1`;
  }
  return { mediaUrls, downloadUrls };
}

// Download the chat text straight from storage, with progress.
export async function fetchText(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the chat (${res.status}).`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body || !total) return res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(100, (got / total) * 100));
  }
  return new TextDecoder("utf-8").decode(await new Blob(chunks).arrayBuffer());
}

export const REFRESH_AFTER_MS = 20 * 3600 * 1000; // presigned media links last 24h
