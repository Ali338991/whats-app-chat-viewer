import { prisma } from "../../../../lib/prisma";
import { json, error, handler } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth";
import { ownedChat } from "../../../../lib/vault";
import { logEvents, MEDIA_TYPES } from "../../../../lib/audit";

const MAX_EVENTS = 50;

// POST /api/vault/events {chatId, events:[{type, mediaName}]}
// Client-reported media activity (photo views, video/audio plays, doc downloads)
// in the user's own, non-deleted chat. Time/IP/UA are set server-side. Accepts
// text/plain bodies too, because navigator.sendBeacon can't set JSON headers.
export const POST = handler(async (request) => {
  const { user, response } = await requireUser();
  if (response) return response;
  let b = null;
  try { b = JSON.parse(await request.text()); } catch { /* invalid */ }
  if (!b || typeof b !== "object" || !Array.isArray(b.events)) return error(400, "Invalid request.");
  if (b.events.length > MAX_EVENTS) return error(400, `At most ${MAX_EVENTS} events per request.`);
  const chat = await ownedChat(user.id, b.chatId);

  const wanted = b.events.filter(
    (e) => e && MEDIA_TYPES.includes(e.type) && typeof e.mediaName === "string" && e.mediaName && e.mediaName.length <= 255
  );
  if (!wanted.length) return json({ ok: true, logged: 0 });

  const names = [...new Set(wanted.map((e) => e.mediaName))];
  const media = await prisma.mediaFile.findMany({
    where: { chatId: chat.id, name: { in: names } },
    select: { id: true, name: true, kind: true },
  });
  const byName = new Map(media.map((m) => [m.name, m]));
  const rows = [];
  for (const e of wanted) {
    const m = byName.get(e.mediaName);
    if (!m) continue; // unknown file — drop
    rows.push({ type: e.type, chatId: chat.id, chatName: chat.name, mediaId: m.id, mediaName: m.name, mediaKind: m.kind });
  }
  const logged = await logEvents(request, user.id, rows);
  return json({ ok: true, logged, dropped: b.events.length - rows.length });
});
