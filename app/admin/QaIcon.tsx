// Line icons for Overview → Quick actions (same 24px stroke style as NavIcon).
export type QaIconName =
  | "orders" | "clock" | "plus" | "box" | "pin" | "megaphone" | "tag" | "calendar"
  | "star" | "spark" | "key" | "book" | "chart" | "file" | "users";

const PATHS: Record<QaIconName, JSX.Element> = {
  orders: (<><path d="M6.5 3.5h11v17l-2.75-1.6-2.75 1.6-2.75-1.6-2.75 1.6z" /><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" /></>),
  clock: (<><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>),
  plus: (<><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></>),
  box: (<><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></>),
  pin: (<><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>),
  megaphone: (<><path d="M4 10v4h3l7 4V6L7 10z" /><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" /></>),
  tag: (<><path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z" /><circle cx="8" cy="9" r="1.4" /></>),
  calendar: (<><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>),
  star: (<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z" />),
  spark: (<><path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z" /><path d="M18.5 16v4M16.5 18h4" /></>),
  key: (<><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" /></>),
  book: (<><path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z" /><path d="M12 6.5v13" /></>),
  chart: (<><path d="M4 20h16" /><path d="M7 16.5v-4M12 16.5V7.5M17 16.5v-7" /></>),
  file: (<><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4M12 11v6M9.5 14.5 12 17l2.5-2.5" /></>),
  users: (<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14.7c1.8.5 3 2.1 3.5 4.8" /></>),
};

export default function QaIcon({ name }: { name: QaIconName }) {
  return (
    <svg className="qa-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
