import { prisma } from "../../../../../../lib/prisma";
import { json, error, handler } from "../../../../../../lib/api";
import { requireAdmin } from "../../../../../../lib/auth";
import { ACTIVITY_TYPES, pageEvents, cursorParam } from "../../../../../../lib/audit";

// GET /api/admin/users/[id]/activity?type=&chatId=&cursor= — chat/media activity
// (newest first, 50/page) + a 30-day summary and the 5 most-viewed media.
export const GET = handler(async (request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return error(404, "User not found.");
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return error(404, "User not found.");

  const sp = request.nextUrl.searchParams;
  const type = sp.get("type");
  const chatId = sp.get("chatId");
  if (type && !ACTIVITY_TYPES.includes(type)) return error(400, "Unknown event type.");
  const where = {
    userId: id,
    type: type ? type : { in: ACTIVITY_TYPES },
    ...(chatId ? { chatId: chatId.slice(0, 64) } : {}),
  };
  const cursor = cursorParam(request);
  const page = await pageEvents(where, cursor);

  let summary = null;
  if (!cursor) {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const [counts, top, chats] = await Promise.all([
      prisma.auditEvent.groupBy({ by: ["type"], where: { userId: id, type: { in: ACTIVITY_TYPES }, createdAt: { gte: since30 } }, _count: { _all: true } }),
      prisma.auditEvent.groupBy({
        by: ["mediaId", "mediaName", "mediaKind", "chatName"],
        where: { userId: id, mediaId: { not: null }, type: { in: ["MEDIA_VIEW", "VIDEO_PLAY", "AUDIO_PLAY", "DOC_DOWNLOAD"] } },
        _count: { _all: true },
        orderBy: { _count: { mediaId: "desc" } },
        take: 5,
      }),
      // chats this user has activity in (for the filter dropdown)
      prisma.auditEvent.groupBy({ by: ["chatId", "chatName"], where: { userId: id, chatId: { not: null }, type: { in: ACTIVITY_TYPES } }, orderBy: { chatName: "asc" } }),
    ]);
    const c = Object.fromEntries(counts.map((r) => [r.type, r._count._all]));
    summary = {
      last30Days: {
        chatsOpened: c.CHAT_OPEN || 0,
        photosViewed: c.MEDIA_VIEW || 0,
        videosPlayed: c.VIDEO_PLAY || 0,
        audioPlayed: c.AUDIO_PLAY || 0,
        docsDownloaded: c.DOC_DOWNLOAD || 0,
      },
      topMedia: top.map((t) => ({ mediaId: t.mediaId, mediaName: t.mediaName, mediaKind: t.mediaKind, chatName: t.chatName, count: t._count._all })),
      chats: chats.map((r) => ({ chatId: r.chatId, chatName: r.chatName })),
    };
  }
  return json({ ...page, summary });
});
