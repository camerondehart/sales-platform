"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVoice } from "./useVoice";
import Markdown from "./Markdown";
import EmailPreview from "@/app/components/EmailPreview";
import { rememberChange } from "@/app/admin/recentChanges";
import { track } from "@/lib/track";
import {
  CART_KEYS,
  EVT_ADD_TO_CART,
  EVT_ADMIN_REFRESH,
  EVT_ASK,
  EVT_OPEN,
  EVT_OPEN_CART,
  EVT_USE_DRAFT,
  PHOTO_SLOT,
  EVT_VIEW_PRODUCT,
  SHOP_PATH,
  SUPPORT_EMAIL,
  type ActionProposal,
  type ProductCard,
  type ShopEventDetail,
  type AssistantStatus,
  type CampaignDraft,
  type ChatMessage,
  type ChatReply,
  type WidgetMode,
} from "@/lib/assistant/shared";

type ActionState = "idle" | "running" | "done" | "failed" | "dismissed";

/** Cards whose confirmation sends an email (for the wording of the ✓ line). */
const SENT_KINDS = new Set<string>(["order_message", "member_message", "resend_invoice", "member_password", "manual_invoice", "campaign_send", "campaign_test", "handoff", "report"]);

/**
 * Staff chat: what each earlier reply actually showed (cards + their status,
 * campaign drafts). The server only gets text history, so without this the
 * model can't tell which of its cards exist or were confirmed/dismissed.
 */
const CARD_STATE: Record<ActionState, string> = {
  idle: "waiting for staff to confirm",
  running: "being confirmed",
  done: "CONFIRMED",
  failed: "failed",
  dismissed: "dismissed by staff",
};
const CARD_LEDGER_PREFIX = "[Shown with this reply — recorded by the site:";
function cardLedger(m: Msg): string {
  const rows: string[] = [];
  for (const a of m.actions || []) {
    const st = m.actionState?.[a.id] || { state: "idle" as ActionState };
    rows.push(`- card "${a.title}": ${CARD_STATE[st.state]}${st.note ? ` (${st.note.slice(0, 80)})` : ""}`);
  }
  if (m.draft) rows.push(`- campaign draft "${m.draft.subject}" (opens in the composer; sending happens there)`);
  return rows.length ? `${CARD_LEDGER_PREFIX}\n${rows.slice(0, 12).join("\n")}]` : "";
}

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ActionProposal[];
  actionState?: Record<string, { state: ActionState; note?: string }>;
  draft?: CampaignDraft;
  /** Today-list item this reply came from — ticked off when its cards are dealt with. */
  todayKey?: string;
  /** Products the Concierge recommended, shown as cards. */
  products?: ProductCard[];
  /** Signature that lets this answer be read aloud (voice on). */
  voiceSig?: string;
  /** Small preview of a photo sent with this message (the full photo isn't kept). */
  photoThumb?: string;
  /** Product ids added to the cart from this message's cards. */
  added?: string[];
  error?: boolean;
  /** Local-only notices (not sent back as history). */
  local?: boolean;
};

const STORE_VERSION = 1;
const STORE_TTL = 6 * 3600_000;
const REQUEST_TIMEOUT = 65_000;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const SUGGESTIONS: Record<"public" | "member" | "admin", string[]> = {
  public: [
    "What would you recommend for focus?",
    "How do I become a member?",
    "Where's my order?",
    "I forgot my password",
  ],
  member: [
    "What's in the member collection?",
    "Where's my latest order?",
    "How do loyalty points work?",
    "Any classes coming up?",
  ],
  admin: [
    "What needs my attention today?",
    "Who's waiting for approval?",
    "Draft a newsletter about new arrivals",
    "How do I create a discount code?",
  ],
};

/** One id per conversation (for the 30-day transcript); "New chat" starts a new one. */
function conversationId(mode: WidgetMode, fresh = false): string {
  const k = `fp_assistant_conv_${mode}`;
  try {
    const cur = sessionStorage.getItem(k);
    if (cur && !fresh) return cur;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function storageKey(mode: WidgetMode) {
  return `fp_assistant_${mode}`;
}

function loadThread(mode: WidgetMode): Msg[] {
  try {
    const raw = sessionStorage.getItem(storageKey(mode));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.v !== STORE_VERSION || Date.now() - Number(data.at) > STORE_TTL) return [];
    if (!Array.isArray(data.messages)) return [];
    return (data.messages as Msg[]).slice(-40).map((m) => {
      if (!m.actionState) return m;
      const fixed: Msg["actionState"] = {};
      for (const [k, v] of Object.entries(m.actionState)) {
        fixed[k] = v.state === "running" ? { state: "failed", note: "Interrupted — check the dashboard before trying again." } : v;
      }
      return { ...m, actionState: fixed };
    });
  } catch {
    return [];
  }
}

function saveThread(mode: WidgetMode, messages: Msg[]) {
  try {
    sessionStorage.setItem(storageKey(mode), JSON.stringify({ v: STORE_VERSION, at: Date.now(), messages: messages.slice(-40) }));
  } catch {
    /* storage full or disabled — the chat still works, it just won't persist */
  }
}

function PeaksMark({ light = false }: { light?: boolean }) {
  const c = light ? "#ffffff" : "#6fa336";
  return (
    <svg viewBox="0 0 32 24" width="22" height="17" aria-hidden="true">
      <path d="M1 23 L6 13 L11 23 Z" fill={c} opacity="0.55" />
      <path d="M6 23 L12.5 8 L19 23 Z" fill={c} opacity="0.75" />
      <path d="M12 23 L19 2 L26 23 Z" fill={c} />
      <path d="M21 23 L26 12 L31 23 Z" fill={light ? "#eaf7c9" : "#85ba45"} />
    </svg>
  );
}

/** Shrink a photo on the phone before sending: longest side ≤ max px, JPEG. */
async function shrinkPhoto(file: File, max: number, quality: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = c.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const PHOTO_TAG = "[Photo]";
/** Backup for conversation mode: a short, plain goodbye ends it even if the Concierge forgets its marker. */
const SIGN_OFF = /^(ok(ay)?[, ]+)?(no,? )?(thanks?( you)?( so much)?|thank you|that'?s (all|it)|i'?m (good|all set|done)|bye|goodbye|good ?night|see you|talk (to you )?later)[\s\w',.!]{0,30}$/i;

export default function AssistantWidget({ mode }: { mode: WidgetMode }) {
  const [status, setStatus] = useState<(AssistantStatus & { staffNote?: string }) | null>(null);
  const [path, setPath] = useState("");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped by "new chat" so a reply still in flight can't land in the fresh thread.
  const genRef = useRef(0);
  const loaded = useRef(false);

  // Voice: mic + read aloud (useVoice.ts). Words heard go into the box, not straight to send.
  const voice = useVoice({
    enabled: !!status?.voice,
    mode: mode === "admin" ? "admin" : "site",
    onText: (t) => {
      setInput((prev) => `${prev.trim() ? `${prev.trim()} ` : ""}${t}`.slice(0, 2000));
      setTimeout(() => inputRef.current?.focus(), 30);
    },
    // Conversation mode: what they said goes straight to the Concierge.
    onSend: (t) => sendRef.current(t),
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Photos: one waiting to go with the next message (full size for the
  // Concierge, a small preview for the chat).
  const [photo, setPhoto] = useState<{ full: string; thumb: string } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  // The last photo staff sent, kept in this browser only, so a campaign draft can use it.
  const chatPhotoRef = useRef<{ full: string; thumb: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoNote(null);
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      setPhotoNote("That isn't a photo. Try a picture from your camera or library.");
      return;
    }
    try {
      const [full, thumb] = await Promise.all([shrinkPhoto(file, 1280, 0.82), shrinkPhoto(file, 240, 0.7)]);
      setPhoto({ full, thumb });
      setTimeout(() => inputRef.current?.focus(), 30);
    } catch {
      setPhotoNote("Couldn't open that photo here. Try another, or take a screenshot of it.");
    }
  }
  // Closing the chat stops listening and talking (and ends conversation mode).
  useEffect(() => {
    if (!open) voiceRef.current.stopAll();
  }, [open]);

  const audience: "public" | "member" | "admin" =
    mode === "admin" ? "admin" : path.startsWith("/gallery") ? "member" : "public";

  // ------------------------------------------------------------- bootstrap
  useEffect(() => {
    setPath(window.location.pathname);
    setMessages(loadThread(mode));
    loaded.current = true;
    const url = mode === "admin" ? "/api/admin/assistant/status" : "/api/assistant/status";
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => !cancelled && s && setStatus(s))
      .catch(() => {
        /* launcher simply stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const visible = !!status && (mode === "admin" ? true : status.available[audience]);

  // Keep the cart button clear of the launcher.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add("has-assistant");
    return () => document.body.classList.remove("has-assistant");
  }, [visible]);

  // A one-time, gentle "I'm here" hint for visitors.
  useEffect(() => {
    if (!visible || mode === "admin") return;
    let seen = false;
    try {
      seen = sessionStorage.getItem("fp_assistant_hint") === "1";
    } catch {}
    if (seen || messages.length > 0) return;
    const show = setTimeout(() => setHint(true), 6000);
    const hide = setTimeout(() => setHint(false), 14000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [visible, mode, messages.length]);

  useEffect(() => {
    if (loaded.current) saveThread(mode, messages);
  }, [mode, messages]);

  // Scroll to the newest message.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  // Focus, Escape, and body scroll lock on phones.
  useEffect(() => {
    if (!open) return;
    if (mode !== "admin") track("assistant_open");
    setHint(false);
    try {
      sessionStorage.setItem("fp_assistant_hint", "1");
    } catch {}
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const phone = window.matchMedia("(max-width: 640px)").matches;
    const prev = document.documentElement.style.overflow;
    if (phone) document.documentElement.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (phone) document.documentElement.style.overflow = prev;
    };
  }, [open]);

  // Grow the textarea with its content, up to a limit.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input, open]);

  // --------------------------------------------------------------- sending
  const send = useCallback(
    async (text: string, base?: Msg[]) => {
      const typed = text.trim();
      const pic = photoRef.current;
      // A photo can go on its own; the Concierge sees "[Photo]" in the text.
      const content = pic ? `${PHOTO_TAG}${typed ? ` ${typed}` : ""}` : typed;
      if (!content || sending) return;
      const userMsg: Msg = { id: uid(), role: "user", content, photoThumb: pic?.thumb };
      if (pic) setPhoto(null);
      if (pic && mode === "admin") chatPhotoRef.current = pic;
      const thread = [...(base ?? messages).filter((m) => !m.error), userMsg];
      setMessages(thread);
      setInput("");
      setSending(true);

      const history: ChatMessage[] = thread
        .filter((m) => !m.local && m.content)
        .map((m) => {
          const ledger = mode === "admin" && m.role === "assistant" ? cardLedger(m) : "";
          // Server keeps 4000 characters per message; the ledger always fits.
          return { role: m.role, content: ledger ? `${m.content.slice(0, 3900 - ledger.length)}\n\n${ledger}` : m.content };
        })
        .slice(-16);

      const gen = genRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, messages: history, conversationId: conversationId(mode), ...(pic ? { photo: pic.full } : {}), ...(voiceRef.current.handsFree ? { conversation: true } : {}) }),
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => null)) as ChatReply | null;
        if (gen !== genRef.current) return;
        if (!data || typeof data.reply !== "string") throw new Error("bad response");
        const replyId = uid();
        const voiceSig = typeof data.voiceSig === "string" ? data.voiceSig : undefined;
        // "Read answers aloud" or conversation mode is on: read this one (the person chose this).
        const v = voiceRef.current;
        // Conversation mode ends when the Concierge says goodbye (or they plainly said bye/thanks, I'm good).
        const done = v.handsFree && (data.endConversation === true || SIGN_OFF.test(content.trim()));
        if (done) v.endAfterSpeaking();
        if (voiceSig && (v.readAloud || v.handsFree)) setTimeout(() => voiceRef.current.speak(replyId, data.reply, voiceSig), 50);
        else if (v.handsFree) v.setHandsFree(false);
        setMessages((prev) => [
          ...prev,
          {
            id: replyId,
            role: "assistant",
            voiceSig,
            content: data.reply,
            actions: data.actions,
            actionState: {},
            draft: data.draft,
            todayKey: typeof data.todayKey === "string" ? data.todayKey : undefined,
            products: Array.isArray(data.products) ? data.products.slice(0, 4) : undefined,
            error: false,
          },
        ]);
      } catch (err) {
        if (gen !== genRef.current) return;
        if (voiceRef.current.handsFree) voiceRef.current.setHandsFree(false);
        const aborted = err instanceof Error && err.name === "AbortError";
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content: aborted
              ? "That took too long, sorry. Please try again."
              : `I couldn't connect just now. Check your connection and try again${mode === "admin" ? "" : `, or email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`}.`,
            error: true,
            local: true,
          },
        ]);
      } finally {
        clearTimeout(timer);
        if (gen === genRef.current) {
          abortRef.current = null;
          setSending(false);
        }
      }
    },
    [messages, mode, sending]
  );

  // Buttons elsewhere on the page ("Questions about this product?", "Ask
  // Ask our Concierge") open the chat, optionally with a question pre-sent.
  const sendRef = useRef(send);
  sendRef.current = send;
  // Staff: the Overview "Today" bulletin uses the same event to ask for cards.
  useEffect(() => {
    if (mode !== "site" && mode !== "admin") return;
    const onOpen = () => setOpen(true);
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (typeof q === "string" && q.trim()) setTimeout(() => sendRef.current(q.slice(0, 300)), 120);
    };
    window.addEventListener(EVT_OPEN, onOpen);
    window.addEventListener(EVT_ASK, onAsk);
    return () => {
      window.removeEventListener(EVT_OPEN, onOpen);
      window.removeEventListener(EVT_ASK, onAsk);
    };
  }, [mode]);

  const retryLast = () => {
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    // Resend the same question on top of everything before it.
    send(messages[idx].content, messages.slice(0, idx));
  };

  const newChat = () => {
    genRef.current += 1;
    conversationId(mode, true);
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // --------------------------------------------------------- admin actions
  const setActionState = (msgId: string, actionId: string, state: ActionState, note?: string) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, actionState: { ...(m.actionState || {}), [actionId]: { state, note } } } : m
      )
    );

  // What staff did with each card — read by the Concierge's nightly notes review.
  // Fire-and-forget; never gets in the way.
  const reportCard = (msg: Msg, action: ActionProposal, outcome: "confirmed" | "dismissed" | "failed") => {
    if (mode !== "admin") return;
    fetch("/api/assistant/card-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: action.kind, title: action.title, outcome, todayKey: msg.todayKey }),
      keepalive: true,
    }).catch(() => {});
  };

  const confirmAction = async (msg: Msg, action: ActionProposal) => {
    const current = msg.actionState?.[action.id]?.state;
    if (current === "running" || current === "done") return; // no double submits
    setActionState(msg.id, action.id, "running");
    try {
      const res = await fetch(action.request.url, {
        method: action.request.method,
        // Tells the audit log this change was proposed by the Concierge and
        // approved by the signed-in admin who pressed the button.
        headers: { "Content-Type": "application/json", "x-fp-source": "assistant", "x-fp-proposal": action.kind },
        body: JSON.stringify(action.request.body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const why = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
        setActionState(msg.id, action.id, "failed", why === "unauthorized" ? "Your admin session has expired — sign in again." : why);
        if (why !== "unauthorized") reportCard(msg, action, "failed");
        return;
      }
      let note = "Done.";
      if (action.kind === "member_status" && data?.welcomeEmailFailed) {
        note = "Done — but the welcome email didn't send. Use Message on their row to let them know.";
      }
      if (action.kind === "discount_code" && data?.discount?.code) note = `Created ${data.discount.code}.`;
      if ((action.kind === "order_message" || action.kind === "member_message" || action.kind === "resend_invoice") && data?.sentTo) note = `Sent to ${data.sentTo}.`;
      if (action.kind === "member_create") note = data?.emailSent === false ? "Account created — but the welcome email didn't send. Ask me to email them a fresh password." : "Account created and emailed.";
      if (action.kind === "campaign_send") note = data?.scheduled ? "Scheduled — cancel it any time before it goes out." : `Sending to ${data?.sent ?? data?.total ?? "your list"}.`;
      if (action.kind === "campaign_test") note = "Test sent to the team inbox.";
      if (action.kind === "member_password") note = data?.email?.ok === false ? "Password changed — but the email didn't send. Try again, or ask them to use “Forgot password”." : "New password emailed to them.";
      if (action.kind === "shipping_label" && data?.trackingNumber) note = `Label bought — tracking ${data.trackingNumber}.`;
      setActionState(msg.id, action.id, "done", note);
      reportCard(msg, action, "confirmed");
      // Storage reads can lag a minute behind a write; remember what was just
      // saved so the dashboard's refresh shows it straight away (recentChanges.ts).
      if (mode === "admin" && data?.order?.id) {
        rememberChange("order", data.order.id, {
          status: data.order.status,
          expiredAt: data.order.expiredAt ?? null,
          remindersOff: data.order.remindersOff ?? null,
          paidAt: data.order.paidAt ?? null,
        });
      }
      window.dispatchEvent(new CustomEvent(EVT_ADMIN_REFRESH, { detail: action.refresh }));
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: `✓ ${action.title} — ${SENT_KINDS.has(action.kind) ? "sent" : "confirmed and saved"}.`,
        },
      ]);
    } catch {
      setActionState(msg.id, action.id, "failed", "Network error — nothing was changed. Try again.");
    }
  };

  // A Today-list button's cards are all dealt with (at least one confirmed, the
  // rest confirmed or dismissed) → tick that item off for everyone. Replies with
  // a campaign draft are ticked off by the composer once the campaign is sent.
  const ticked = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== "admin") return;
    for (const m of messages) {
      if (!m.todayKey || m.draft || !m.actions?.length || ticked.current.has(m.id)) continue;
      const states = m.actions.map((a) => m.actionState?.[a.id]?.state);
      if (!states.includes("done") || states.some((s) => s !== "done" && s !== "dismissed")) continue;
      ticked.current.add(m.id);
      fetch("/api/admin/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.todayKey, done: true }) })
        .then(() => window.dispatchEvent(new CustomEvent(EVT_ADMIN_REFRESH, { detail: ["today"] })))
        .catch(() => ticked.current.delete(m.id));
    }
  }, [messages, mode]);

  // ------------------------------------------------------- product cards
  const phone = () => window.matchMedia("(max-width: 640px)").matches;

  const addProduct = (msgId: string, c: ProductCard) => {
    const d: ShopEventDetail = { productId: c.id, shop: c.shop };
    // The shop on screen (if any) adds it to its own cart, so its count updates.
    window.dispatchEvent(new CustomEvent(EVT_ADD_TO_CART, { detail: d }));
    if (!d.handled) {
      // No shop on this page: add to the saved cart the shop reads on load.
      try {
        const key = CART_KEYS[c.shop];
        const cart = JSON.parse(localStorage.getItem(key) || "[]") as Array<{ productId: string; quantity: number }>;
        const list = Array.isArray(cart) ? cart.filter((i) => i?.productId && i.quantity > 0) : [];
        const found = list.find((i) => i.productId === c.id);
        if (found) found.quantity += 1;
        else list.push({ productId: c.id, quantity: 1 });
        localStorage.setItem(key, JSON.stringify(list));
      } catch {}
      track("add_to_cart", { id: c.id });
    }
    track("assistant_add", { id: c.id });
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, added: Array.from(new Set([...(m.added || []), c.id])) } : m)));
  };

  const viewProduct = (c: ProductCard) => {
    const d: ShopEventDetail = { productId: c.id, shop: c.shop };
    window.dispatchEvent(new CustomEvent(EVT_VIEW_PRODUCT, { detail: d }));
    if (d.handled) setOpen(false); // the product's pop-up is open on this page
    else window.location.href = `${SHOP_PATH[c.shop]}?product=${encodeURIComponent(c.id)}`;
  };

  const openCart = (shop: ProductCard["shop"]) => {
    const d: ShopEventDetail = { shop };
    window.dispatchEvent(new CustomEvent(EVT_OPEN_CART, { detail: d }));
    if (d.handled) {
      if (phone()) setOpen(false);
    } else window.location.href = `${SHOP_PATH[shop]}?cart=1`;
  };

  const applyDraft = (draft: CampaignDraft) => {
    const pic = draft.photo ? chatPhotoRef.current : null;
    window.dispatchEvent(new CustomEvent(EVT_USE_DRAFT, { detail: pic ? { ...draft, photoData: pic.full } : draft }));
    if (window.matchMedia("(max-width: 640px)").matches) setOpen(false);
  };

  // --------------------------------------------------------------- render
  if (!visible || !status) return null;

  const isAdmin = mode === "admin";
  const staffBlocked = isAdmin && !status.available.admin;
  const title = isAdmin ? "Studio assistant" : status.name;
  const empty = messages.length === 0;

  return (
    <div className={`as-root${isAdmin ? " as-admin" : ""}${open ? " is-open" : ""}`}>

      <button
        className={`as-launcher${open ? " is-open" : ""}${!isAdmin && !open ? " is-labelled" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : `Open ${title}`}
        aria-expanded={open}
      >
        <span className="as-launcher-icon as-icon-chat" aria-hidden="true">
          <PeaksMark light />
          <span className="as-spark">✦</span>
        </span>
        <span className="as-launcher-icon as-icon-close" aria-hidden="true">×</span>
        {!isAdmin && !open && (
          <span className="as-launcher-label">
            <span className="as-label-long">Ask our Concierge</span>
            <span className="as-label-short">Concierge</span>
          </span>
        )}
      </button>

      {open && (
        <section className="as-panel" role="dialog" aria-label={title}>
          <header className="as-head">
            <div className="as-avatar">
              <PeaksMark light={isAdmin} />
            </div>
            <div className="as-head-text">
              <div className="as-title">{title}</div>
              <div className="as-sub">
                <span className={`as-dot${staffBlocked ? " is-off" : ""}`} />
                {staffBlocked ? "Offline" : isAdmin ? "Looks things up · you confirm changes" : "Here to help"}
              </div>
            </div>
            {!empty && (
              <button className="as-icon-btn" onClick={newChat} title="Start a new chat" aria-label="Start a new chat">
                ↺
              </button>
            )}
            <button className="as-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>

          <div className="as-body" ref={listRef} aria-live="polite">
            {staffBlocked ? (
              <div className="as-empty">
                <div className="as-empty-title">The assistant is offline</div>
                <p>{status.staffNote || "It's switched off in the Assistant tab."}</p>
              </div>
            ) : empty ? (
              <div className="as-empty">
                <div className="as-empty-mark">
                  <PeaksMark />
                </div>
                <div className="as-empty-title">
                  {isAdmin ? "What can I take off your plate?" : audience === "member" ? "Welcome back" : "Hi, how can I help?"}
                </div>
                <p>
                  {isAdmin
                    ? "Ask about orders, members or sales, get help with the dashboard, or have me draft a campaign. I'll never change anything without your OK."
                    : "Ask about our products, your order, membership or your account. If I can't sort it, I'll pass you to the team."}
                </p>
                <div className="as-chips">
                  {SUGGESTIONS[audience].map((s) => (
                    <button key={s} className="as-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`as-row as-${m.role}${m.error ? " is-error" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="as-mini">
                      <PeaksMark />
                    </div>
                  )}
                  <div className="as-stack">
                    <div className="as-bubble">
                      {m.photoThumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="as-photo" src={m.photoThumb} alt="Your photo" />
                      )}
                      {m.role === "assistant" ? <Markdown text={m.content} /> : m.content.startsWith(PHOTO_TAG) ? (m.content.slice(PHOTO_TAG.length).trim() || (m.photoThumb ? "" : "📷 Photo")) : m.content}
                    </div>
                    {m.role === "assistant" && m.voiceSig && status?.voice && (
                      <button
                        type="button"
                        className={`as-play${voice.playing === m.id ? " is-playing" : ""}`}
                        onClick={() => voice.speak(m.id, m.content, m.voiceSig!)}
                        disabled={voice.loadingId === m.id}
                        aria-label={voice.playing === m.id ? "Stop reading aloud" : "Read this answer aloud"}
                      >
                        {voice.loadingId === m.id ? "…" : voice.playing === m.id ? "■ Stop" : "▶ Listen"}
                      </button>
                    )}
                    {m.products && m.products.length > 0 && (
                      <div className={`as-prods${m.products.length === 1 ? " is-single" : ""}`} role="list" aria-label="Recommended products">
                        {m.products.map((c, i) => {
                          const added = m.added?.includes(c.id);
                          return (
                            <article key={c.id} className="as-prod" role="listitem" style={{ animationDelay: `${i * 70}ms` }}>
                              <button type="button" className="as-prod-img" onClick={() => viewProduct(c)} aria-label={`View ${c.name}`}>
                                {c.image ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.image} alt="" loading="lazy" />
                                ) : (
                                  <span className="as-prod-ph">
                                    <PeaksMark />
                                  </span>
                                )}
                                {c.badge && <span className="as-prod-badge">{c.badge}</span>}
                                {c.hasVideo && <span className="as-prod-video" aria-label="Has a video">▶</span>}
                              </button>
                              <div className="as-prod-body">
                                <div className="as-prod-name">{c.name}</div>
                                <div className="as-prod-price">
                                  {c.was && <s>{c.was}</s>}
                                  <strong>{c.price}</strong>
                                </div>
                                {c.blurb && <p className="as-prod-blurb">{c.blurb}</p>}
                                <div className="as-prod-actions">
                                  {c.canAdd &&
                                    (added ? (
                                      <button type="button" className="as-prod-btn is-added" onClick={() => openCart(c.shop)}>
                                        ✓ Added · View cart
                                      </button>
                                    ) : (
                                      <button type="button" className="as-prod-btn is-primary" onClick={() => addProduct(m.id, c)}>
                                        Add to cart
                                      </button>
                                    ))}
                                  <button type="button" className="as-prod-btn" onClick={() => viewProduct(c)}>
                                    View
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    {m.error && (
                      <button className="as-retry" onClick={retryLast}>
                        Try again
                      </button>
                    )}
                    {m.actions?.map((a) => {
                      const st = m.actionState?.[a.id] || { state: "idle" as ActionState };
                      if (st.state === "dismissed") return null;
                      return (
                        <div key={a.id} className={`as-card${a.danger ? " is-danger" : ""} is-${st.state}`}>
                          <div className="as-card-kicker">Needs your OK</div>
                          <div className="as-card-title">{a.title}</div>
                          <ul className="as-card-lines">
                            {a.lines.map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                          {a.preview && <div className="as-card-preview">{a.preview}</div>}
                          {isAdmin && a.kind === "template" && (() => {
                            const b = (a.request?.body || {}) as { subject?: string; body?: string };
                            return b.body ? <EmailPreview subject={b.subject || ""} body={b.body} /> : null;
                          })()}
                          {isAdmin && (a.kind === "campaign_send" || a.kind === "campaign_test") && (() => {
                            const b = (a.request?.body || {}) as { subject?: string; body?: string; theme?: string };
                            return b.body ? <EmailPreview subject={b.subject || ""} body={b.body} theme={b.theme || "auto"} /> : null;
                          })()}
                          {st.state === "done" ? (
                            <div className="as-card-result ok">✓ {st.note || "Done."}</div>
                          ) : (
                            <>
                              {st.state === "failed" && <div className="as-card-result bad">Couldn't do it: {st.note}</div>}
                              <div className="as-card-actions">
                                <button
                                  className={`as-btn ${a.danger ? "as-btn-danger" : "as-btn-primary"}`}
                                  onClick={() => confirmAction(m, a)}
                                  disabled={st.state === "running"}
                                >
                                  {st.state === "running" ? a.busyLabel || "Saving…" : st.state === "failed" ? "Try again" : a.confirmLabel}
                                </button>
                                <button
                                  className="as-btn as-btn-ghost"
                                  onClick={() => { setActionState(m.id, a.id, "dismissed"); reportCard(m, a, "dismissed"); }}
                                  disabled={st.state === "running"}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {m.draft && (
                      <div className="as-card as-draft">
                        <div className="as-card-kicker">
                          Campaign draft ·{" "}
                          {m.draft.audience === "members" ? "members only" : m.draft.audience === "nonmembers" ? "non-members" : m.draft.audience === "custom" ? m.draft.groupLabel || "a chosen group" : m.draft.audience === "subscribers" ? "subscribers" : "subscribers + all members"}
                        </div>
                        <div className="as-card-title">{m.draft.subject}</div>
                        {m.draft.photo && chatPhotoRef.current && <img className="as-photo" src={chatPhotoRef.current.thumb} alt={m.draft.photo.alt} />}
                        <div className="as-draft-body">{m.draft.body.split(PHOTO_SLOT).join("📷 (your photo)")}</div>
                        {isAdmin && <EmailPreview subject={m.draft.subject} theme={m.draft.theme || "auto"} body={m.draft.body.split(PHOTO_SLOT).join("*📷 Your photo from the chat goes here*")} />}
                        <div className="as-card-actions">
                          {isAdmin && (
                            <button className="as-btn as-btn-primary" onClick={() => applyDraft(m.draft!)}>
                              Open in composer
                            </button>
                          )}
                          <button
                            className="as-btn as-btn-ghost"
                            onClick={() => {
                              try {
                                navigator.clipboard?.writeText(`${m.draft!.subject}\n\n${m.draft!.body}`);
                              } catch {}
                            }}
                          >
                            Copy
                          </button>
                        </div>
                        <div className="as-card-foot">Nothing is sent until you press Send in Marketing.</div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="as-row as-assistant">
                <div className="as-mini">
                  <PeaksMark />
                </div>
                <div className="as-bubble as-typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {!staffBlocked && (
            <>
            {(photo || photoNote) && (
              <div className="as-photo-tray">
                {photo && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.thumb} alt="Photo to send" />
                    <span>Photo ready — add a question, or just send.</span>
                    <button type="button" className="as-photo-x" onClick={() => setPhoto(null)} aria-label="Remove photo">×</button>
                  </>
                )}
                {!photo && photoNote && <span className="as-photo-note">{photoNote}</span>}
              </div>
            )}
            <form
              className="as-compose"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={isAdmin ? "Ask or tell me what to do…" : "Type your question…"}
                rows={1}
                aria-label="Message"
              />
              {status?.photos && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      pickPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="as-cam" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Add a photo (take one or choose from your library)" title="Add a photo">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                  </button>
                </>
              )}
              {voice.canRecord && (
                <button
                  type="button"
                  className={`as-mic${voice.recording ? " is-on" : ""}`}
                  onClick={() => voice.micTap()}
                  disabled={voice.listening || sending}
                  aria-label={voice.recording ? "Stop and use what I said" : voice.playing ? "Stop the answer and talk" : "Talk instead of typing"}
                  title={voice.recording ? "Tap to stop" : voice.playing ? "Tap to interrupt" : "Tap to talk"}
                >
                  {voice.listening ? (
                    <span className="as-mic-dots" aria-hidden="true">…</span>
                  ) : voice.recording ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  )}
                </button>
              )}
              <button className="as-send" type="submit" disabled={(!input.trim() && !photo) || sending} aria-label="Send">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
            </>
          )}
          {(voice.recording || voice.listening || voice.note || (voice.handsFree && voice.playing)) && (
            <div className={`as-voice-status${voice.recording ? " is-rec" : ""}`} role="status" aria-live="polite">
              {voice.recording
                ? voice.handsFree
                  ? voice.heard ? "Listening… pause when you're done" : "Listening — go ahead"
                  : `Listening… ${voice.seconds}s — tap ■ when you're done${voice.seconds >= voice.maxSeconds - 10 ? ` (stops at ${voice.maxSeconds}s)` : ""}`
                : voice.listening
                  ? "Getting your words…"
                  : voice.handsFree && voice.playing
                    ? "Speaking… just start talking (or tap the mic) to interrupt"
                    : voice.note}
            </div>
          )}
          {status?.voice && (
            <div className="as-voice-opts">
              {voice.canRecord && (
                <label className="as-readaloud">
                  <input type="checkbox" checked={voice.handsFree} onChange={(e) => voice.setHandsFree(e.target.checked)} /> Conversation mode
                </label>
              )}
              <label className="as-readaloud">
                <input type="checkbox" checked={voice.readAloud || voice.handsFree} disabled={voice.handsFree} onChange={(e) => voice.setReadAloud(e.target.checked)} /> Read answers aloud
              </label>
            </div>
          )}
          <div className="as-foot">
            {isAdmin ? "Changes always wait for your confirmation." : "Automated assistant — can make mistakes. Not medical advice."}
          </div>
        </section>
      )}
    </div>
  );
}
