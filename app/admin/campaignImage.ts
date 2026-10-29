// Photos in email campaigns (Marketing → composer "Upload photo", and the photo
// staff sent the Concierge). The file goes straight from this browser into the
// site's Blob store through the same staff-only, audited /api/admin/upload as
// product photos; the message then gets a line the email template turns into an image.

/** Upload a JPEG/PNG/WebP/GIF (already checked and shrunk). Returns its public address. */
export async function uploadCampaignImage(file: Blob, name: string): Promise<string> {
  const { upload } = await import("@vercel/blob/client");
  const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const slug = name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photo";
  const blob = await upload(`media/images/campaign-${slug}.${ext}`, file, {
    access: "public",
    handleUploadUrl: "/api/admin/upload",
    clientPayload: "image",
    contentType: file.type,
  });
  return blob.url;
}

/** A "data:image/jpeg;base64,…" photo (from the chat) as a file. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/** What goes in the message: an image line, or an <img> tag when the message is pasted HTML. */
export function imageLine(url: string, alt: string, body: string): string {
  const html = /<\s*(p|div|h[1-6]|ul|ol|li|table|img|a|br|strong|em|span|section)\b[^>]*>/i.test(body);
  const cleanAlt = alt.replace(/[\[\]()<>"&]/g, "").trim() || "Photo";
  return html
    ? `<div style="text-align:center;margin:1.25rem 0;"><img src="${url}" alt="${cleanAlt}" width="480" style="max-width:100%;height:auto;border-radius:8px;" /></div>`
    : `![${cleanAlt}](${url})`;
}
