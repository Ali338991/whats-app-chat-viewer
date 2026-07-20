import crypto from "crypto";

// Signed Cloudinary upload — the API secret stays on the server (never sent to the browser).
// Required env vars (server-side only, NO "NEXT_PUBLIC_" prefix):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

export async function POST(req) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) {
    return Response.json({ error: "Backup not configured on server" }, { status: 501 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { name, id, text } = body || {};
  if (!text || typeof text !== "string" || text.length > 15_000_000) {
    return Response.json({ error: "Invalid file" }, { status: 400 });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const safe = (s, fb) => String(s || fb).replace(/[^\w-]+/g, "_").slice(0, 80);
  const publicId = `chat-backups/${safe(name, "chat")}_${safe(id, timestamp)}`;

  // Cloudinary signature: sha1 of alphabetically-sorted params + secret
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const fd = new FormData();
  fd.append("file", new Blob([text], { type: "text/plain" }), `${safe(name, "chat")}.txt`);
  fd.append("api_key", apiKey);
  fd.append("timestamp", String(timestamp));
  fd.append("public_id", publicId);
  fd.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json({ error: data?.error?.message || "Upload failed" }, { status: 502 });
  }
  return Response.json({ ok: true, url: data.secure_url });
}
