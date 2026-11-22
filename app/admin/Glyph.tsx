// Line glyphs for the staff dashboard (tabs, section cards, settings tiles,
// buttons). Same 24px stroke style as QaIcon/NavIcon, drawn in currentColor so
// they follow the text colour in light and dark. Used instead of emoji, which
// render as full-colour pictures and look different on every device.
export type GlyphName =
  | "overview" | "analytics" | "orders" | "members" | "products" | "events" | "marketing"
  | "ambassadors" | "retail" | "assistant" | "settings"
  | "book" | "external" | "mail" | "inbox" | "tag" | "basket" | "megaphone" | "chart"
  | "hand" | "chat" | "pencil" | "sliders" | "clock" | "key" | "lock" | "wrench" | "tree"
  | "gift" | "question" | "pin" | "scroll" | "leaf" | "pushpin" | "play" | "upload"
  | "download" | "refresh" | "alert" | "cash" | "box" | "bag" | "image" | "button" | "camera" | "sparkles";

const P: Record<GlyphName, JSX.Element> = {
  overview: (<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15M9.5 12h11" /></>),
  analytics: (<><circle cx="12" cy="12" r="8" /><path d="M12 4v8h8" /></>),
  orders: (<><path d="M6.5 3.5h11v17l-2.75-1.6-2.75 1.6-2.75-1.6-2.75 1.6z" /><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" /></>),
  members: (<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14.7c1.8.5 3 2.1 3.5 4.8" /></>),
  products: (<><path d="M3.5 12.5a8.5 8 0 0 1 17 0z" /><path d="M9.5 12.5V18a2.5 2.5 0 0 0 5 0v-5.5" /><path d="M9 8.6v.1M14.6 7.6v.1M12 10.2v.1" /></>),
  events: (<><path d="M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.6v3.4h-17v-3.4a1.8 1.8 0 0 0 0-3.6z" /><path d="M14.5 8v1.2M14.5 11.4v1.2M14.5 14.8V16" /></>),
  marketing: (<path d="M12 4c.7 4.9 2.6 7.3 8 8-5.4.7-7.3 3.1-8 8-.7-4.9-2.6-7.3-8-8 5.4-.7 7.3-3.1 8-8z" />),
  ambassadors: (<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z" />),
  retail: (<><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5a2.67 2.2 0 0 0 5.33 0 2.67 2.2 0 0 0 5.34 0 2.67 2.2 0 0 0 5.33 0" /><path d="M5.5 11.5v8h13v-8" /><path d="M10 19.5V15h4v4.5" /></>),
  assistant: (<><path d="M10 4.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5z" /><path d="M17.5 14c.25 1.8.95 2.5 2.75 2.75-1.8.25-2.5.95-2.75 2.75-.25-1.8-.95-2.5-2.75-2.75 1.8-.25 2.5-.95 2.75-2.75z" /></>),
  settings: (<g transform="translate(1.2 1.2) scale(0.9)"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></g>),
  book: (<><path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z" /><path d="M12 6.5v13" /></>),
  external: (<><path d="M13.5 4.5h6v6M19.5 4.5l-8 8" /><path d="M17.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10" /></>),
  mail: (<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>),
  inbox: (<><path d="M3.5 13.5 6 5.5h12l2.5 8v5h-17z" /><path d="M3.5 13.5h5l1 2h5l1-2h5" /></>),
  tag: (<><path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z" /><circle cx="8" cy="9" r="1.4" /></>),
  basket: (<><path d="M3.5 10h17l-1.6 8.2a1.5 1.5 0 0 1-1.5 1.3H6.6a1.5 1.5 0 0 1-1.5-1.3z" /><path d="m8 10 3-5.5M16 10l-3-5.5M9.5 13.5v3M14.5 13.5v3" /></>),
  megaphone: (<><path d="M4 10v4h3l7 4V6L7 10z" /><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" /></>),
  chart: (<><path d="M4 20h16" /><path d="M7 16.5v-4M12 16.5V7.5M17 16.5v-7" /></>),
  hand: (<path d="M8 13V7a1.5 1.5 0 0 1 3 0v4M11 10.5V5.5a1.5 1.5 0 0 1 3 0V11M14 10.5V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.8-2.4l-1.9-2.6a1.5 1.5 0 0 1 2.4-1.8L8 15" />),
  chat: (<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8.5L6 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />),
  pencil: (<><path d="M15.5 5.5l3 3-10 10-4 1 1-4z" /><path d="M13.5 7.5l3 3" /></>),
  sliders: (<><path d="M6 4v5M6 13v7M12 4v9M12 17v3M18 4v3M18 11v9" /><circle cx="6" cy="11" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="18" cy="9" r="2" /></>),
  clock: (<><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>),
  key: (<><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>),
  wrench: (<path d="M14.6 6.6a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3-3a5.5 5.5 0 0 1-7.3 7.3l-6.3 6.3a2 2 0 0 1-2.8-2.8l6.3-6.3a5.5 5.5 0 0 1 7.3-7.3z" />),
  tree: (<><path d="M12 3.5 7 9.5h2.5L5.5 15h13l-4-5.5H17z" /><path d="M12 15v5.5" /></>),
  gift: (<><rect x="4" y="9" width="16" height="4" rx="1" /><path d="M5.5 13v6.5h13V13M12 9v10.5" /><path d="M12 9c-1.5-3.5-5.5-4-5.5-1.8C6.5 9 12 9 12 9zM12 9c1.5-3.5 5.5-4 5.5-1.8 0 1.8-5.5 1.8-5.5 1.8z" /></>),
  question: (<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6" /><path d="M12 16.8v.1" /></>),
  pin: (<><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>),
  scroll: (<><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4M9.5 11.5h5M9.5 15h5" /></>),
  leaf: (<><path d="M5 19c0-8 5-13.5 14.5-14-.3 9.5-6 14.5-14 14z" /><path d="M5 19l8-8" /></>),
  pushpin: (<><path d="M9 4.5h6l-1 5 3 3H7l3-3z" /><path d="M12 12.5v7" /></>),
  play: (<path d="M8 5.5v13l10.5-6.5z" />),
  upload: (<><path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9" /><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" /></>),
  download: (<><path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5" /><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" /></>),
  refresh: (<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>),
  alert: (<><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.5M12 17v.1" /></>),
  cash: (<><rect x="3" y="6.5" width="18" height="11" rx="1.8" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 9.5v.1M17.5 14.5v.1" /></>),
  box: (<><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></>),
  bag: (<><path d="M5.5 8h13l-1 12h-11z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>),
  image: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></>),
  button: (<><rect x="3.5" y="8" width="17" height="8" rx="4" /><path d="M9 12h6" /></>),
  camera: (<><path d="M4 8.5h3.5L9 6h6l1.5 2.5H20v10H4z" /><circle cx="12" cy="13" r="3.2" /></>),
  sparkles: (<><path d="M10 4.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5z" /><path d="M17.5 14c.25 1.8.95 2.5 2.75 2.75-1.8.25-2.5.95-2.75 2.75-.25-1.8-.95-2.5-2.75-2.75 1.8-.25 2.5-.95 2.75-2.75z" /></>),
};

/** A line glyph sized to the surrounding text (1em) unless the parent sizes `.glyph`. */
export default function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={className ? `glyph ${className}` : "glyph"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}
