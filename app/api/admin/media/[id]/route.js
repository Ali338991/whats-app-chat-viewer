import { prisma } from "../../../../../lib/prisma";
import { error, handler } from "../../../../../lib/api";
import { requireAdmin } from "../../../../../lib/auth";
import { presignGet } from "../../../../../lib/r2";

// GET /api/admin/media/[id][?download=1] — admin download of any media file
// (redirect to a 1-hour presigned URL, original filename when download=1).
export const GET = handler(async (request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return error(404, "Not found.");
  const media = await prisma.mediaFile.findUnique({ where: { id }, select: { key: true, mime: true, name: true } });
  if (!media) return error(404, "Not found.");
  const download = request.nextUrl.searchParams.get("download") === "1";
  const url = await presignGet(media.key, { expiresSec: 3600, contentType: media.mime, downloadName: download ? media.name : undefined });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=3000" } });
});
