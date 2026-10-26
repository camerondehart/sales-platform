"use client";

import { useEffect, useRef, useState } from "react";

// "Upload" button for a photo or video field (products and events).
// The file goes straight from this browser into the site's Blob store; the
// field is then filled with the file's address, exactly as if it had been
// pasted. Pasting a link still works.

type Kind = "image" | "video";

const RULES: Record<Kind, { accept: string; types: string[]; maxMb: number; hint: string }> = {
  image: { accept: "image/jpeg,image/png,image/webp,image/gif", types: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"], maxMb: 15, hint: "JPEG, PNG, WebP or GIF" },
  video: { accept: "video/mp4", types: ["video/mp4"], maxMb: 250, hint: "MP4, up to 250 MB" },
};

const slug = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "file";

/** Phone photos are often 4000px+ and 3–8 MB. Shrink big JPEGs to 2400px so pages stay fast. */
async function shrinkJpeg(file: File): Promise<File> {
  if (file.type !== "image/jpeg" || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const long = Math.max(bmp.width, bmp.height);
    if (long <= 2400 && file.size <= 2.5 * 1024 * 1024) return file;
    const scale = Math.min(1, 2400 / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob && blob.size < file.size ? new File([blob], file.name, { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export default function MediaUpload({ kind, value, onUploaded }: { kind: Kind; value: string; onUploaded: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  // An upload that's in the field but not saved yet. If it's replaced by
  // another upload before saving, the first one is discarded.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending && value !== pending) setPending(null);
  }, [value, pending]);

  async function pick(file: File) {
    setErr("");
    const r = RULES[kind];
    if (kind === "video" && /quicktime|mov/i.test(file.type + file.name)) {
      setErr("That's an iPhone .mov video. Export it as MP4 first (or set iPhone Settings → Camera → Formats → Most Compatible).");
      return;
    }
    if (/heic|heif/i.test(file.type + file.name)) {
      setErr("That's an iPhone HEIC photo. Share it as JPEG (or set iPhone Settings → Camera → Formats → Most Compatible).");
      return;
    }
    if (!r.types.includes(file.type)) {
      setErr(`Use ${r.hint}.`);
      return;
    }
    const f = kind === "image" ? await shrinkJpeg(file) : file;
    if (f.size > r.maxMb * 1024 * 1024) {
      setErr(`That file is ${(f.size / 1024 / 1024).toFixed(0)} MB — the limit is ${r.maxMb} MB.${kind === "video" ? " Try a shorter clip, or use an unlisted YouTube link." : ""}`);
      return;
    }
    setPct(0);
    try {
      const { upload } = await import("@vercel/blob/client");
      const ext = kind === "video" ? "mp4" : f.type.split("/")[1].replace("jpeg", "jpg");
      const blob = await upload(`media/${kind === "video" ? "videos" : "images"}/${slug(file.name)}.${ext}`, f, {
        access: "public",
        handleUploadUrl: "/api/admin/upload",
        clientPayload: kind,
        contentType: f.type,
        multipart: f.size > 20 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setPct(Math.round(percentage)),
      });
      const replaced = pending && value === pending ? pending : null;
      onUploaded(blob.url);
      setPending(blob.url);
      if (replaced) fetch(`/api/admin/upload?url=${encodeURIComponent(replaced)}`, { method: "DELETE" }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErr(/content type|size|exceed/i.test(msg) ? `That file wasn't accepted (${r.hint}).` : msg || "Upload failed — check the connection and try again.");
    }
    setPct(null);
  }

  return (
    <div className="media-up">
      <input
        ref={input}
        type="file"
        accept={RULES[kind].accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) pick(f);
        }}
      />
      <button type="button" className="media-up-btn" disabled={pct !== null} onClick={() => input.current?.click()}>
        {pct !== null ? `Uploading… ${pct}%` : kind === "video" ? "⬆ Upload video" : "⬆ Upload photo"}
      </button>
      {pct !== null && (
        <span className="media-up-bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
      {pct === null && !err && <span className="media-up-hint">{value ? "or paste a link above" : RULES[kind].hint}</span>}
      {err && <span className="media-up-err">{err}</span>}
    </div>
  );
}
