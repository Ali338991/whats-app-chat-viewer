// Cloudflare R2 (S3-compatible) helpers — server only.
// File bytes never pass through our functions: the browser uploads/downloads
// directly with short-lived presigned URLs. Signing is local HMAC (no network).
import crypto from "node:crypto";
import { AwsClient } from "aws4fetch";
import { HttpError } from "./api";

let client = null;

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  // Optional override for other S3-compatible endpoints (e.g. a local MinIO for development).
  const endpoint = (process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).replace(/\/+$/, "");
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new HttpError(503, "Cloud storage is not configured on the server.");
  }
  if (!client) client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto", retries: 3 });
  return { client, base: `${endpoint}/${bucket}` };
}

export function r2Configured() {
  return !!((process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT) && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

// Keys are ASCII-only and built server-side; encode each path segment anyway.
function objectUrl(base, key) {
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/* ---------------- object keys ---------------- */

export function chatPrefix(userId, chatId) {
  return `u/${userId}/c/${chatId}/`;
}
export function userPrefix(userId) {
  return `u/${userId}/`;
}
export function textKeyFor(userId, chatId) {
  return `${chatPrefix(userId, chatId)}chat.txt`;
}
export function sanitizeName(name) {
  let s = String(name || "file").replace(/[^A-Za-z0-9._-]/g, "_");
  if (s.length > 100) s = s.slice(0, 60) + s.slice(-40); // keep the extension
  return s || "file";
}
export function mediaKeyFor(userId, chatId, index, name) {
  return `${chatPrefix(userId, chatId)}m/${index}_${sanitizeName(name)}`;
}

/* ---------------- presigning ---------------- */

export async function presignPut(key, expiresSec = 3600) {
  const { client, base } = config();
  const url = new URL(objectUrl(base, key));
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function presignGet(key, { expiresSec = 3600, contentType, downloadName } = {}) {
  const { client, base } = config();
  const url = new URL(objectUrl(base, key));
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  if (contentType) url.searchParams.set("response-content-type", contentType);
  if (downloadName) url.searchParams.set("response-content-disposition", contentDisposition(downloadName));
  const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

// Presign many GETs at once with one shared timestamp (pure local HMAC, no
// network). Returns full URLs in the same order as `items` ({key, contentType}).
export async function presignGetMany(items, expiresSec = 3600) {
  const { client, base } = config();
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return Promise.all(
    items.map(async ({ key, contentType }) => {
      const url = new URL(objectUrl(base, key));
      url.searchParams.set("X-Amz-Expires", String(expiresSec));
      if (contentType) url.searchParams.set("response-content-type", contentType);
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true, datetime } });
      return signed.url;
    })
  );
}

// Public base URL of the bucket (used by the compact media-link format).
export function bucketBase() {
  return config().base;
}
export { objectUrl };

/* ---------------- listing & deleting ---------------- */

const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const xmlUnescape = (s) =>
  String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Every key under a prefix (ListObjectsV2, paginated).
export async function listKeys(prefix) {
  const { client, base } = config();
  const keys = [];
  let token = null;
  for (let page = 0; page < 1000; page++) {
    const url = new URL(`${base}/`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client.fetch(url.toString(), { method: "GET" });
    const xml = await res.text();
    if (!res.ok) throw new Error(`R2 list failed (${res.status}): ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(xmlUnescape(m[1]));
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
    if (!truncated || !next) break;
    token = xmlUnescape(next[1]);
  }
  return keys;
}

async function deleteOne(key) {
  const { client, base } = config();
  const res = await client.fetch(objectUrl(base, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}) for ${key}`);
}

async function deleteIndividually(keys, concurrency = 8) {
  let i = 0;
  const failures = [];
  const worker = async () => {
    while (i < keys.length) {
      const key = keys[i++];
      try { await deleteOne(key); } catch (e) { failures.push(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  if (failures.length) throw failures[0];
}

// S3 DeleteObjects in batches of 1000; falls back to single DELETEs.
export async function deleteObjects(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  const { client, base } = config();
  for (let start = 0; start < unique.length; start += 1000) {
    const batch = unique.slice(start, start + 1000);
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>` +
      batch.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("") +
      `</Delete>`;
    const md5 = crypto.createHash("md5").update(body).digest("base64");
    let failed = batch;
    try {
      const res = await client.fetch(`${base}/?delete`, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/xml", "Content-MD5": md5 },
      });
      const xml = await res.text();
      if (res.ok) {
        // Quiet mode only reports errors; retry just those individually.
        failed = [...xml.matchAll(/<Error>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Error>/g)].map((m) => xmlUnescape(m[1]));
      } else {
        console.warn(`R2 DeleteObjects failed (${res.status}); falling back to single deletes`);
      }
    } catch (e) {
      console.warn("R2 DeleteObjects error; falling back to single deletes", e);
    }
    if (failed.length) await deleteIndividually(failed);
  }
}

// Delete everything under a prefix, plus any explicitly known keys
// (covers objects from uploads that never completed).
export async function deletePrefix(prefix, knownKeys = []) {
  let keys = [];
  try {
    keys = await listKeys(prefix);
  } catch (e) {
    console.warn("R2 list failed; deleting known keys only", e);
  }
  await deleteObjects([...keys, ...knownKeys.filter((k) => k.startsWith(prefix))]);
}
