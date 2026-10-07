import { prisma } from "../../../../../../lib/prisma";
import { json, error, readJson, handler, isInt, HttpError } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth";
import { presignPut, mediaKeyFor } from "../../../../../../lib/r2";
import { ownedChat, MAX_SIGN_BATCH } from "../../../../../../lib/vault";

// POST /api/vault/chats/[id]/sign — presigned PUT URLs for a batch of media
// files ({files:[{index, name}]}, ≤200), and/or the chat text ({text:true}).
// Keys are generated here, so a client can only write inside its own chat folder.
export const POST = handler(async (request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  if (chat.status !== "UPLOADING") throw new HttpError(409, "This upload is no longer active.");

  const b = await readJson(request);
  const files = Array.isArray(b?.files) ? b.files : [];
  if (files.length > MAX_SIGN_BATCH) return error(400, `At most ${MAX_SIGN_BATCH} files per request.`);
  for (const f of files) {
    if (!f || !isInt(f.index, 0, 10_000_000) || typeof f.name !== "string" || !f.name || f.name.length > 500) {
      return error(400, "Invalid file list.");
    }
  }

  // keep the upload "alive" (stale uploads are expired after 24h of inactivity)
  await prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });

  const out = await Promise.all(
    files.map(async (f) => {
      const key = mediaKeyFor(user.id, chat.id, f.index, f.name);
      return { index: f.index, key, url: await presignPut(key) };
    })
  );
  const result = { files: out };
  if (b?.text) result.textUploadUrl = await presignPut(chat.textKey);
  return json(result);
});
