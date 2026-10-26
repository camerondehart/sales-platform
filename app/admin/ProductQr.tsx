"use client";

import { useEffect, useMemo, useState } from "react";
import { qrSvg } from "@/lib/qr";
import { isOwnHost } from "@/lib/brand";

/**
 * A printable QR code for one product. It points at /p/<product id> — a
 * permanent link that never changes even if the product is renamed, repriced
 * or moved between shops, so printed codes keep working. Scanning opens the
 * shop with that product (and its video) showing.
 */
export default function ProductQr({ id, name }: { id: string; name: string }) {
  const [origin, setOrigin] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/p/${encodeURIComponent(id)}` : "";
  const preview = useMemo(() => (url && open ? qrSvg(url, { size: 180 }) : ""), [url, open]);
  const isLive = isOwnHost(origin.replace(/^https?:\/\//, "").replace(/:\d+$/, ""));

  function download() {
    const blob = new Blob([qrSvg(url, { size: 1200, margin: 4 })], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `qr-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || id}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function print() {
    const w = window.open("", "_blank", "width=700,height=900");
    if (!w) return;
    const safe = name.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
    w.document.write(`<!doctype html><html><head><title>${safe}</title>
<style>
  body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:Optima,"Segoe UI",system-ui,sans-serif;color:#2b2f27;text-align:center}
  .wrap{padding:2rem} h1{font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:2rem;margin:0 0 1rem}
  p{font-size:1.1rem;color:#61676d;margin:1rem 0 0} svg{width:min(70vw,480px);height:auto}
</style></head><body><div class="wrap"><h1>${safe}</h1>${qrSvg(url, { size: 480, margin: 3 })}<p>Scan to learn more</p></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  if (!url) return null;
  return (
    <div className="pqr">
      <button type="button" className="ap-linkbtn" onClick={() => setOpen(!open)}>
        {open ? "Hide QR code" : "QR code for this product"}
      </button>
      {open && (
        <div className="pqr-body">
          <div className="pqr-code" dangerouslySetInnerHTML={{ __html: preview }} />
          <div className="pqr-side">
            <div className="pqr-url">{url}</div>
            <div className="field-hint">
              Permanent — safe to print. Scanning opens this product{" "}
              {`(and its video, if it has one)`}.
              {!isLive && " ⚠ You're not on the live site, so this code points here. Print codes from the live dashboard."}
            </div>
            <div className="tpl-actions">
              <button type="button" className="esc-btn" onClick={download}>Download</button>
              <button type="button" className="esc-btn" onClick={print}>Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
