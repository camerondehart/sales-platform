import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small markdown renderer for assistant replies.
 *
 * Builds React elements directly — model output is never inserted as HTML,
 * so a reply can't inject markup or script. Supports what a chat reply
 * needs: paragraphs, bullet and numbered lists, **bold**, `code`
 * and [links](url). Links are limited to http(s), mailto and site-relative
 * paths. Images (![alt](url)) are shown only for our own product QR codes
 * (/api/qr/product/…), so a reply can't load images from anywhere else.
 */

function qrSrc(url: string): string | null {
  const u = url.trim();
  if (/^\/api\/qr\/product\/[^/?#]+(\?size=[sml])?$/.test(u)) return u;
  const m = u.match(/^https:\/\/[^/]+(\/api\/qr\/product\/[^/?#]+(\?size=[sml])?)$/);
  return m ? m[1] : null; // always load it from this site
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // image | link | bold | code  (no lookbehind: it's a syntax error on older iOS Safari)
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[2] !== undefined) {
      const src = qrSrc(m[2]);
      if (src) {
        const big = src.replace(/\?size=[sml]$/, "") + "?size=l";
        out.push(
          <span key={k} className="as-qr">
            <img src={src} alt={m[1] || "QR code"} width={140} height={140} />
            <a href={big} download>
              Download QR
            </a>
          </span>
        );
      } else out.push(m[1] || "");
    } else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      if (href) {
        const external = /^https?:/i.test(href) && typeof window !== "undefined" && !href.startsWith(window.location.origin);
        out.push(
          <a key={k} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {m[3]}
          </a>
        );
      } else out.push(m[3]);
    } else if (m[5] !== undefined) out.push(<strong key={k}>{m[5]}</strong>);
    else if (m[6] !== undefined) out.push(<code key={k}>{m[6]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<p key={`h${blocks.length}`} className="as-md-h">{inline(heading[1], `h${blocks.length}`)}</p>);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="as-md">{blocks}</div>;
}
