import { prisma } from "../../../../../lib/prisma";
import { error, handler } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth";
import { presignGet } from "../../../../../lib/r2";

// GET /api/vault/media/[id][?download=1]
// Used for downloads with the original filename (and as a fallback link).
// Ownership is checked, then the browser is redirected to a 1-hour presigned
// R2 URL — the file itself never passes through this function.
export const GET = handler(async (request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return error(404, "Not found.");
  const media = await prisma.mediaFile.findFirst({
    where: { id, chat: { userId: user.id } },
    select: { key: true, mime: true, name: true },
  });
  if (!media) return error(404, "Not found.");

  const download = request.nextUrl.searchParams.get("download") === "1";
  const url = await presignGet(media.key, {
    expiresSec: 3600,
    contentType: media.mime,
    downloadName: download ? media.name : undefined,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, max-age=3000" },
  });
});
