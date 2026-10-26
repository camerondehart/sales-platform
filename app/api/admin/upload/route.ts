import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { MEDIA, cleanupMedia, isOurMedia, uploadToken, type MediaKind } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Photo & video uploads for products and events.
 *
 * POST: the browser asks for a one-time upload token (staff only). The file
 *       then goes straight from the browser to Blob — it never passes through
 *       here. Each token allows ONE file, of the right type and size, under
 *       media/images/ or media/videos/, valid for 30 minutes.
 * DELETE ?url=: discard an upload that was replaced before it was saved.
 *       Only our own media/ files, and only if nothing uses them.
 */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = uploadToken();
  if (!token) return NextResponse.json({ error: "Uploads need the Vercel Blob store — they work on the live site and stage." }, { status: 503 });
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  // We don't use Blob's "upload finished" callback; only token requests are accepted.
  if (body?.type !== "blob.generate-client-token") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const kind = (clientPayload === "video" ? "video" : clientPayload === "image" ? "image" : null) as MediaKind | null;
        if (!kind) throw new Error("Say whether it's a photo or a video.");
        const m = MEDIA[kind];
        if (!pathname.startsWith(m.dir) || pathname.includes("..") || pathname.length > 200) throw new Error("Bad file name.");
        auditDetail({ action: `media.upload_${kind}`, targetType: "media", targetId: pathname, after: { file: pathname } });
        return {
          allowedContentTypes: m.types,
          maximumSizeInBytes: m.maxBytes,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + 30 * 60_000,
          cacheControlMaxAge: 31536000,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the upload." }, { status: 400 });
  }
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url).searchParams.get("url") || "";
  if (!isOurMedia(url)) return NextResponse.json({ error: "Not an uploaded file." }, { status: 400 });
  const gone = await cleanupMedia([url]);
  auditDetail({ targetType: "media", targetId: url, note: gone.length ? "Discarded an unused upload" : "Kept — still in use" });
  return NextResponse.json({ ok: true, deleted: gone.length > 0 });
}

export const POST = audited("media.upload", "media", POST_handler);
export const DELETE = audited("media.discard", "media", DELETE_handler);
