// Random-access, Blob-based ZIP reader for the browser — dependency-free.
//
// Built for WhatsApp "Export chat → Attach media" archives that can be
// hundreds of MB: the archive is NEVER read into memory as a whole.
//   - openZip(blob) reads only the tail (to find the End Of Central Directory,
//     incl. ZIP64) and then just the central directory slice.
//   - readEntry(blob, entry) reads the 30-byte local header to find where the
//     data starts, then returns a zero-copy Blob slice for "stored" entries
//     (method 0 — WhatsApp media are usually stored) or streams "deflated"
//     entries (method 8) through DecompressionStream("deflate-raw").

const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// CP437 (the legacy ZIP filename encoding) for bytes 0x80–0xFF.
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

const utf8 = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes, isUtf8) {
  if (isUtf8) return utf8.decode(bytes);
  // Many tools write UTF-8 without setting the flag — try strict UTF-8 first.
  try {
    return utf8Strict.decode(bytes);
  } catch {
    let s = "";
    for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return s;
  }
}

async function readBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function u64(view, offset) {
  return Number(view.getBigUint64(offset, true));
}

/**
 * Parse the archive's central directory.
 * @param {Blob} blob  the .zip File/Blob
 * @returns {Promise<Array<{name:string, method:number, compressedSize:number, size:number, localHeaderOffset:number, encrypted:boolean}>>}
 *          file entries (directories are skipped)
 */
export async function openZip(blob) {
  const total = blob.size;
  if (total < 22) throw new Error("not a valid ZIP file");

  // EOCD (22 bytes) + max comment (65535) + room for the ZIP64 locator (20) before it.
  const tailLen = Math.min(total, 22 + 0xffff + 20);
  const tailStart = total - tailLen;
  const tail = await readBytes(blob, tailStart, total);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD && i + 22 + tv.getUint16(i + 20, true) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a valid ZIP file");

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  // ZIP64: real values live in the ZIP64 EOCD record, found via the locator.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tv.getUint32(loc, true) === SIG_Z64_LOCATOR) {
      const recOffset = u64(tv, loc + 8);
      const rec = await readBytes(blob, recOffset, recOffset + 56);
      const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      if (rec.length >= 56 && rv.getUint32(0, true) === SIG_Z64_EOCD) {
        count = u64(rv, 32);
        cdSize = u64(rv, 40);
        cdOffset = u64(rv, 48);
      }
    }
  }
  if (cdOffset + cdSize > total) throw new Error("ZIP file is truncated or corrupted");

  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = [];
  let p = 0;

  for (let e = 0; e < count && p + 46 <= cd.length; e++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localHeaderOffset = view.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    let name = decodeName(nameBytes, (flags & 0x0800) !== 0);

    // Extra fields: ZIP64 sizes/offset (0x0001) and Info-ZIP Unicode path (0x7075).
    let ep = p + 46 + nameLen;
    const end = ep + extraLen;
    while (ep + 4 <= end) {
      const id = view.getUint16(ep, true);
      const sz = view.getUint16(ep + 2, true);
      const data = ep + 4;
      if (id === 0x0001) {
        let q = data;
        if (size === 0xffffffff && q + 8 <= data + sz) { size = u64(view, q); q += 8; }
        if (compressedSize === 0xffffffff && q + 8 <= data + sz) { compressedSize = u64(view, q); q += 8; }
        if (localHeaderOffset === 0xffffffff && q + 8 <= data + sz) { localHeaderOffset = u64(view, q); q += 8; }
      } else if (id === 0x7075 && sz > 5 && view.getUint8(data) === 1) {
        try { name = utf8Strict.decode(cd.subarray(data + 5, data + sz)); } catch { /* keep original */ }
      }
      ep = data + sz;
    }

    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // directory
    entries.push({ name, method, compressedSize, size, localHeaderOffset, encrypted: (flags & 1) !== 0 });
  }
  return entries;
}

/**
 * Get one entry's contents as a Blob without touching the rest of the archive.
 * @param {Blob} blob   the archive
 * @param {object} entry from openZip()
 * @param {string} [type] MIME type for the returned Blob
 */
export async function readEntry(blob, entry, type = "") {
  if (entry.encrypted) throw new Error(`"${entry.name}" is encrypted`);
  const h = await readBytes(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || hv.getUint32(0, true) !== SIG_LOCAL) throw new Error(`corrupted entry "${entry.name}"`);
  // The local name/extra lengths can differ from the central directory's.
  const start = entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const raw = blob.slice(start, start + entry.compressedSize, type);

  if (entry.method === 0) return raw; // stored: zero-copy slice of the original file
  if (entry.method === 8) {
    const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream, type ? { headers: { "Content-Type": type } } : undefined).blob();
  }
  throw new Error(`unsupported compression method ${entry.method} for "${entry.name}"`);
}

// True for archive clutter that is never part of the chat (macOS metadata etc.)
export function isJunkEntry(name) {
  const base = name.split("/").pop();
  return name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db";
}

/**
 * Find the chat transcript inside an opened archive and decode it.
 * Prefers "_chat.txt" (iOS); otherwise the .txt with the most parsed messages.
 * @returns {Promise<{entry, text} | null>}
 */
export async function findChatText(blob, entries, parse) {
  const txts = entries.filter((e) => /\.txt$/i.test(e.name) && !isJunkEntry(e.name));
  if (!txts.length) return null;
  const preferred = txts.find((e) => /(^|\/)_chat\.txt$/i.test(e.name));
  if (preferred) return { entry: preferred, text: await (await readEntry(blob, preferred)).text() };
  let best = null;
  for (const e of txts) {
    const text = await (await readEntry(blob, e)).text();
    const n = parse(text).length;
    if (!best || n > best.n) best = { entry: e, text, n };
  }
  return best ? { entry: best.entry, text: best.text } : null;
}
