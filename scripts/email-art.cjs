// Draws the seasonal email artwork (header banners + dividers) for campaign
// themes (lib/campaignThemes.ts) and writes:
//   public/email-art/<theme>-header.jpg   (1200×360, shown at 600 wide)
//   public/email-art/<theme>-divider.png  (1200×56, transparent)
//   lib/emailArtData.ts                   (the same files as base64, so the
//                                          server can copy them to Blob)
// Run (needs Playwright's Chromium): node scripts/email-art.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "email-art");
const W = 1200, H = 360, DW = 1200, DH = 56;

// Deterministic randomness so the art is the same every run.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

// ---------------------------------------------------------------- motifs
const leaf = (x, y, s, r, c) =>
  `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0,-30 C6,-22 14,-24 12,-14 C22,-16 24,-6 16,-2 C26,2 22,12 12,10 C14,20 4,22 2,14 L0,30 L-2,14 C-4,22 -14,20 -12,10 C-22,12 -26,2 -16,-2 C-24,-6 -22,-16 -12,-14 C-14,-24 -6,-22 0,-30 Z" fill="${c}"/><path d="M0,-18 L0,28" stroke="rgba(0,0,0,0.18)" stroke-width="1.6"/></g>`;
const oval = (x, y, s, r, c) =>
  `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0,-22 C12,-12 12,12 0,22 C-12,12 -12,-12 0,-22 Z" fill="${c}"/><path d="M0,-16 L0,20" stroke="rgba(0,0,0,0.15)" stroke-width="1.4"/></g>`;
const pumpkin = (x, y, s, c = "#e07a2e") =>
  `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="-14" cy="0" rx="16" ry="22" fill="${c}"/><ellipse cx="14" cy="0" rx="16" ry="22" fill="${c}"/><ellipse cx="0" cy="0" rx="17" ry="24" fill="${shade(c, 12)}"/><path d="M0,-22 C-2,-32 4,-36 8,-38" stroke="#5a6b2e" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M6,-30 C14,-36 20,-30 16,-26" fill="#7b9a3c"/></g>`;
const snowflake = (x, y, s, c = "#ffffff", o = 0.9) => {
  let arms = "";
  for (let i = 0; i < 6; i++) {
    arms += `<g transform="rotate(${i * 60})"><path d="M0,0 L0,-20 M0,-12 L-6,-17 M0,-12 L6,-17 M0,-6 L-4,-10 M0,-6 L4,-10" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></g>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}">${arms}<circle r="2.4" fill="${c}"/></g>`;
};
const heart = (x, y, s, r, c) =>
  `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0,10 C-14,0 -22,-8 -16,-17 C-11,-24 -3,-22 0,-15 C3,-22 11,-24 16,-17 C22,-8 14,0 0,10 Z" fill="${c}"/></g>`;
const flower = (x, y, s, c, center = "#f6d36b") => {
  let p = "";
  for (let i = 0; i < 5; i++) p += `<ellipse cx="0" cy="-11" rx="7" ry="11" fill="${c}" transform="rotate(${i * 72})"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">${p}<circle r="6" fill="${center}"/></g>`;
};
const star = (x, y, s, c) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0,-14 C1.4,-4 4,-1.4 14,0 C4,1.4 1.4,4 0,14 C-1.4,4 -4,1.4 -14,0 C-4,-1.4 -1.4,-4 0,-14 Z" fill="${c}"/></g>`;
const pine = (x, base, h, c, cs) => {
  const w = h * 0.55;
  let t = `<rect x="${x - 5}" y="${base - 14}" width="10" height="16" fill="#6b4a32"/>`;
  for (let i = 0; i < 3; i++) {
    const tb = base - 10 - i * h * 0.24, tt = tb - h * 0.42, tw = (w * (1 - i * 0.24)) / 2;
    t += `<polygon points="${x - tw},${tb} ${x},${tt} ${x},${tb}" fill="${c}"/><polygon points="${x},${tt} ${x + tw},${tb} ${x},${tb}" fill="${cs}"/>`;
  }
  return t;
};
const bat = (x, y, s) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0,0 C-6,-8 -14,-8 -22,-2 C-18,-2 -16,2 -16,6 C-12,2 -8,4 -6,8 C-4,4 -2,2 0,4 C2,2 4,4 6,8 C8,4 12,2 16,6 C16,2 18,-2 22,-2 C14,-8 6,-8 0,0 Z" fill="#0d0814"/></g>`;
const wheat = (x, base, h, c) => {
  let g = `<path d="M${x},${base} C${x + 2},${base - h * 0.5} ${x - 2},${base - h * 0.8} ${x},${base - h}" stroke="${c}" stroke-width="3" fill="none"/>`;
  for (let i = 0; i < 6; i++) {
    const yy = base - h + 8 + i * 12;
    g += `<ellipse cx="${x - 6}" cy="${yy}" rx="4" ry="8" fill="${c}" transform="rotate(-30 ${x - 6} ${yy})"/><ellipse cx="${x + 6}" cy="${yy}" rx="4" ry="8" fill="${c}" transform="rotate(30 ${x + 6} ${yy})"/>`;
  }
  return g;
};
const confetti = (x, y, r, c) => `<rect x="${x}" y="${y}" width="10" height="5" rx="1.5" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`;
const tag = (x, y, s, r, c) =>
  `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M-30,-16 L18,-16 L34,0 L18,16 L-30,16 Z" fill="${c}"/><circle cx="20" cy="0" r="4" fill="#1b1b22"/><text x="-14" y="6" font-family="Arial Black,Arial" font-weight="900" font-size="15" fill="#1b1b22">%</text></g>`;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) - amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) - amt));
  const b = Math.max(0, Math.min(255, (n & 255) - amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
const hills = (cols, base = H) =>
  cols
    .map((c, i) => {
      const y0 = base - 120 + i * 34, a = 22 + i * 6;
      return `<path d="M0,${y0} C200,${y0 - a} 380,${y0 + a} 600,${y0 - 6} C820,${y0 - a - 8} 1000,${y0 + a} 1200,${y0 - 10} L1200,${H} L0,${H} Z" fill="${c}"/>`;
    })
    .join("");
const peaks = (cols) => {
  const P = [[80, 360, 150, 640], [380, 640, 80, 900], [700, 960, 40, 1240], [980, 1180, 120, 1400]];
  return P.map(([l, ax, ay, r], i) => `<polygon points="${l},${H} ${ax},${ay} ${r},${H}" fill="${cols[i % cols.length]}"/><polygon points="${ax},${ay} ${ax + (r - ax) * 0.22},${H} ${r},${H}" fill="rgba(0,0,0,0.12)"/>`).join("");
};

// ---------------------------------------------------------------- themes
const THEMES = {
  classic: {
    sky: ["#eaf3df", "#f9f5ea"],
    draw: (R) => {
      let g = `<circle cx="960" cy="110" r="54" fill="#f6d77a" opacity="0.85"/>`;
      g += peaks(["#b8c7a4", "#9db27f", "#7d9a62", "#85ba45"]);
      g += hills(["#a8c97f", "#85ba45"]);
      for (let i = 0; i < 9; i++) g += star(80 + R() * 1040, 30 + R() * 120, 0.5 + R() * 0.5, "#ffffff");
      return g;
    },
    divider: (R) => [0, 1, 2].map((i) => `<polygon points="${560 + i * 40 - 14},44 ${560 + i * 40},${20 - i * 4} ${560 + i * 40 + 14},44" fill="${["#9aa3a8", "#61676d", "#85ba45"][i]}"/>`).join(""),
  },
  fall: {
    sky: ["#fbe3c4", "#fdf3e4"],
    draw: (R) => {
      let g = `<circle cx="980" cy="96" r="56" fill="#f2b45a" opacity="0.8"/>`;
      g += hills(["#e3a25c", "#c9773a", "#9c5a2c"]);
      for (let i = 0; i < 6; i++) g += pine(90 + i * 210 + R() * 40, H - 26 + R() * 10, 120 + R() * 60, "#7a4a2a", "#5e3820");
      const cols = ["#d9622b", "#e8a23a", "#b8462a", "#c98a2c", "#8f3b22"];
      for (let i = 0; i < 26; i++) g += (i % 3 ? leaf : oval)(40 + R() * 1120, 20 + R() * 230, 0.7 + R() * 0.9, R() * 360, cols[i % cols.length]);
      return g;
    },
    divider: (R) => [0, 1, 2, 3, 4].map((i) => leaf(500 + i * 50, 28, 0.55, -30 + i * 15, ["#d9622b", "#e8a23a", "#b8462a", "#c98a2c", "#d9622b"][i])).join(""),
  },
  halloween: {
    sky: ["#2b2140", "#4a2f5c"],
    draw: (R) => {
      let g = "";
      for (let i = 0; i < 40; i++) g += `<circle cx="${R() * W}" cy="${R() * 200}" r="${1 + R() * 2}" fill="#fff6d6" opacity="${0.4 + R() * 0.6}"/>`;
      g += `<circle cx="930" cy="110" r="66" fill="#f7e2a3"/><circle cx="950" cy="98" r="66" fill="#3a2a52" opacity="0.18"/>`;
      g += hills(["#3a2c4f", "#2a2039"]);
      for (let i = 0; i < 6; i++) g += bat(140 + R() * 900, 50 + R() * 140, 1 + R() * 0.8);
      g += pumpkin(220, H - 52, 1.6) + pumpkin(330, H - 40, 1.1, "#ef8b34") + pumpkin(870, H - 48, 1.4) + pumpkin(990, H - 38, 1, "#ef8b34");
      return g;
    },
    divider: () => bat(560, 28, 1.1) + pumpkin(600, 32, 0.55) + bat(640, 28, 1.1),
  },
  thanksgiving: {
    sky: ["#f6dfb8", "#fbf0dc"],
    draw: (R) => {
      let g = `<circle cx="210" cy="100" r="58" fill="#f3b45c" opacity="0.75"/>`;
      g += hills(["#d9a35a", "#b9783a", "#8d5a2e"]);
      for (let i = 0; i < 14; i++) g += wheat(560 + i * 18 + R() * 6, H - 40, 120 + R() * 50, "#d9a53e");
      g += pumpkin(320, H - 46, 1.4, "#d9722e") + pumpkin(430, H - 36, 1, "#e9a03a") + pumpkin(930, H - 44, 1.3, "#c9632a");
      const cols = ["#b8462a", "#e8a23a", "#9c5a2c"];
      for (let i = 0; i < 12; i++) g += leaf(60 + R() * 1080, 30 + R() * 160, 0.6 + R() * 0.6, R() * 360, cols[i % 3]);
      return g;
    },
    divider: () => wheat(560, 52, 46, "#d9a53e") + pumpkin(600, 32, 0.55, "#d9722e") + wheat(640, 52, 46, "#d9a53e"),
  },
  holiday: {
    sky: ["#1f4a3a", "#2f6b52"],
    draw: (R) => {
      let g = "";
      for (let i = 0; i < 46; i++) g += snowflake(R() * W, R() * 300, 0.25 + R() * 0.45, "#ffffff", 0.35 + R() * 0.5);
      g += hills(["#e9f0ee", "#ffffff"]);
      const P = [[120, 200], [250, 150], [920, 210], [1060, 160], [1150, 120]];
      for (const [x, h] of P) g += pine(x, H - 30, h, "#2e7a4f", "#24603e");
      const orn = ["#d6343a", "#f2c14e", "#ffffff"];
      for (let i = 0; i < 18; i++) g += `<circle cx="${100 + R() * 1080}" cy="${H - 70 - R() * 120}" r="${4 + R() * 4}" fill="${orn[i % 3]}" opacity="0.9"/>`;
      g += `<g transform="translate(600 180)"><rect x="-38" y="-30" width="76" height="60" rx="6" fill="#d6343a"/><rect x="-6" y="-30" width="12" height="60" fill="#f2c14e"/><rect x="-38" y="-6" width="76" height="12" fill="#f2c14e"/><path d="M0,-30 C-20,-56 -36,-40 -10,-30 M0,-30 C20,-56 36,-40 10,-30" stroke="#f2c14e" stroke-width="7" fill="none"/></g>`;
      return g;
    },
    divider: () => [0, 1, 2, 3, 4].map((i) => `<circle cx="${520 + i * 40}" cy="28" r="9" fill="${["#d6343a", "#2e7a4f", "#f2c14e", "#2e7a4f", "#d6343a"][i]}"/>`).join(""),
  },
  winter: {
    sky: ["#cfe3f2", "#f2f8fc"],
    draw: (R) => {
      let g = "";
      g += hills(["#dfeaf3", "#f6fafd", "#ffffff"]);
      for (let i = 0; i < 6; i++) g += pine(80 + i * 220 + R() * 40, H - 40 + R() * 10, 110 + R() * 70, "#7fa6bf", "#5f8aa6");
      for (let i = 0; i < 40; i++) g += snowflake(R() * W, R() * 260, 0.3 + R() * 0.6, "#9cc0db", 0.5 + R() * 0.5);
      return g;
    },
    divider: () => [0, 1, 2].map((i) => snowflake(560 + i * 40, 28, 0.7, "#7fa6bf")).join(""),
  },
  newyear: {
    sky: ["#1d1f3a", "#3a2f5e"],
    draw: (R) => {
      let g = "";
      const gold = ["#f4cf6a", "#ffe9a8", "#d9a93a", "#ffffff", "#c9a5f2"];
      for (let i = 0; i < 70; i++) g += confetti(R() * W, R() * H, R() * 180, gold[i % gold.length]);
      for (let i = 0; i < 16; i++) g += star(R() * W, R() * 240, 0.6 + R() * 1.2, "#ffe9a8");
      for (const [cx, cy] of [[260, 120], [900, 100]]) {
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          g += `<path d="M${cx},${cy} L${cx + Math.cos(a) * 70},${cy + Math.sin(a) * 70}" stroke="${gold[k % 3]}" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`;
        }
      }
      return g;
    },
    divider: () => star(560, 28, 0.9, "#d9a93a") + star(600, 28, 1.2, "#f4cf6a") + star(640, 28, 0.9, "#d9a93a"),
  },
  valentines: {
    sky: ["#fde1e6", "#fff4f6"],
    draw: (R) => {
      let g = hills(["#f8c4cf", "#f3a6b8"]);
      const cols = ["#e5486a", "#f27a95", "#c92f55", "#f9a8ba"];
      for (let i = 0; i < 26; i++) g += heart(40 + R() * 1120, 30 + R() * 250, 0.8 + R() * 1.4, -20 + R() * 40, cols[i % 4]);
      return g;
    },
    divider: () => heart(560, 30, 0.8, -10, "#f27a95") + heart(600, 30, 1.1, 0, "#e5486a") + heart(640, 30, 0.8, 10, "#f27a95"),
  },
  spring: {
    sky: ["#e4f3df", "#f8fbf2"],
    draw: (R) => {
      let g = `<circle cx="980" cy="90" r="50" fill="#f8de7e" opacity="0.8"/>`;
      g += hills(["#bfe0a6", "#9ccd78", "#7ab456"]);
      const cols = ["#f4a6c0", "#ffffff", "#f7d36b", "#c7a6ef"];
      for (let i = 0; i < 30; i++) g += flower(40 + R() * 1120, H - 90 + R() * 70, 0.7 + R() * 0.7, cols[i % 4]);
      for (let i = 0; i < 14; i++) g += oval(60 + R() * 1080, 30 + R() * 140, 0.6 + R() * 0.5, R() * 360, "#f8c9d8");
      return g;
    },
    divider: () => flower(560, 28, 0.8, "#f4a6c0") + flower(600, 28, 1, "#c7a6ef") + flower(640, 28, 0.8, "#f4a6c0"),
  },
  mothersday: {
    sky: ["#f6e6f4", "#fdf6fb"],
    draw: (R) => {
      let g = hills(["#ead2ef", "#dcb8e6"]);
      const cols = ["#e79ac0", "#c79be0", "#f4b6c8", "#ffffff"];
      for (let i = 0; i < 26; i++) g += flower(40 + R() * 1120, H - 110 + R() * 90, 0.8 + R() * 0.8, cols[i % 4]);
      for (let i = 0; i < 10; i++) g += heart(80 + R() * 1040, 40 + R() * 130, 0.7 + R() * 0.6, -15 + R() * 30, "#e79ac0");
      return g;
    },
    divider: () => heart(560, 30, 0.7, -10, "#e79ac0") + flower(600, 28, 0.9, "#c79be0") + heart(640, 30, 0.7, 10, "#e79ac0"),
  },
  summer: {
    sky: ["#bfe6f5", "#f2fbff"],
    draw: (R) => {
      let g = `<circle cx="960" cy="100" r="62" fill="#ffd24d"/>`;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        g += `<path d="M${960 + Math.cos(a) * 78},${100 + Math.sin(a) * 78} L${960 + Math.cos(a) * 104},${100 + Math.sin(a) * 104}" stroke="#ffd24d" stroke-width="6" stroke-linecap="round"/>`;
      }
      g += hills(["#9fd6c2", "#6cbf9e", "#4e9f7f"]);
      g += `<path d="M0,${H - 40} C150,${H - 60} 300,${H - 20} 450,${H - 40} C600,${H - 60} 750,${H - 20} 900,${H - 40} C1050,${H - 60} 1150,${H - 30} 1200,${H - 40} L1200,${H} L0,${H} Z" fill="#5fb3d9" opacity="0.8"/>`;
      return g;
    },
    divider: () => `<circle cx="600" cy="28" r="12" fill="#ffd24d"/>` + [-1, 1].map((d) => `<path d="M${600 + d * 30},28 L${600 + d * 60},28" stroke="#5fb3d9" stroke-width="4" stroke-linecap="round"/>`).join(""),
  },
  blackfriday: {
    sky: ["#16161d", "#2a2a36"],
    draw: (R) => {
      let g = "";
      const cols = ["#f4cf6a", "#ffffff", "#85ba45"];
      for (let i = 0; i < 30; i++) g += star(R() * W, R() * H, 0.4 + R() * 1, cols[i % 3]);
      g += tag(260, 160, 2.2, -14, "#f4cf6a") + tag(940, 150, 2, 12, "#85ba45") + tag(600, 230, 1.4, -4, "#ffffff");
      return g;
    },
    divider: () => tag(600, 28, 0.6, 0, "#f4cf6a"),
  },
};

function headerSvg(key) {
  const t = THEMES[key];
  const R = rng(key.split("").reduce((n, ch) => n + ch.charCodeAt(0), 11));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.sky[0]}"/><stop offset="1" stop-color="${t.sky[1]}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>${t.draw(R)}</svg>`;
}
function dividerSvg(key) {
  const t = THEMES[key];
  const R = rng(7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DW}" height="${DH}" viewBox="0 0 ${DW} ${DH}"><path d="M120,28 L470,28 M730,28 L1080,28" stroke="#d9d4c7" stroke-width="2" stroke-linecap="round"/>${t.divider(R)}</svg>`;
}

(async () => {
  const { chromium } = require("playwright");
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const data = {};
  for (const key of Object.keys(THEMES)) {
    await p.setViewportSize({ width: W, height: H });
    await p.setContent(`<html><body style="margin:0">${headerSvg(key)}</body></html>`);
    const hdr = await p.screenshot({ type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: W, height: H } });
    fs.writeFileSync(path.join(OUT, `${key}-header.jpg`), hdr);
    await p.setViewportSize({ width: DW, height: DH });
    await p.setContent(`<html><body style="margin:0;background:transparent">${dividerSvg(key)}</body></html>`);
    const div = await p.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: DW, height: DH } });
    fs.writeFileSync(path.join(OUT, `${key}-divider.png`), div);
    data[`${key}-header.jpg`] = hdr.toString("base64");
    data[`${key}-divider.png`] = div.toString("base64");
    console.log(key, `header ${Math.round(hdr.length / 1024)} KB`, `divider ${Math.round(div.length / 1024)} KB`);
  }
  await b.close();
  const ts =
    "// Generated by scripts/email-art.cjs — do not edit by hand.\n" +
    "// Seasonal email artwork as base64, so the server can copy it to Blob\n" +
    "// (lib/emailArt.ts) and every inbox can load it.\n" +
    `export const EMAIL_ART: Record<string, string> = ${JSON.stringify(data, null, 0).replace(/","/g, '",\n  "')};\n`;
  fs.writeFileSync(path.join(ROOT, "lib", "emailArtData.ts"), ts);
})();
