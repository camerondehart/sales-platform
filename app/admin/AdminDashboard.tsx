"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { qrSvg } from "@/lib/qr";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/storage";
import type { PublicUser } from "@/lib/users";
import type { Inquiry } from "@/lib/inquiries";
import type { Order } from "@/lib/orders";
import { normalizeStatus, isCompleted, type OrderStatus } from "@/lib/orderStatus";
import { endOfPacificDay, lastNDaysStart, msToPacificInput, pacificToMs } from "@/lib/periods";
import { rememberChange, applyRecentChanges } from "./recentChanges";
import AssistantWidget from "@/app/components/assistant/AssistantWidget";
import AssistantPanel from "./AssistantPanel";
import FlagsPanel from "./FlagsPanel";
import AnalyticsDashboard from "./AnalyticsDashboard";
import ActivityLog from "./ActivityLog";
import TemplateLibrary from "./TemplateLibrary";
import ProductQr from "./ProductQr";
import CampaignHistory from "./CampaignHistory";
import RemindersPanel from "./RemindersPanel";
import StaffPanel from "./StaffPanel";
import SettingsTiles from "./SettingsTiles";
import RowMenu from "./RowMenu";
import StoreLocationsPanel from "./StoreLocationsPanel";
import DiscountCodeList, { codeState } from "./DiscountCodeList";
import { useAdminTheme } from "./useAdminTheme";
import MediaUpload from "./MediaUpload";
import { dataUrlToBlob, imageLine, uploadCampaignImage } from "./campaignImage";
import BundlesPanel from "./BundlesPanel";
import TodayBulletin from "./TodayBulletin";
import QaIcon, { type QaIconName } from "./QaIcon";
import FaqPanel from "./FaqPanel";
import ShippingWeights from "./ShippingWeights";
import StockCounts from "./StockCounts";
import VenmoInbox from "./VenmoInbox";
import VoiceSettings from "./VoiceSettings";
import AmbassadorsPanel from "./AmbassadorsPanel";
import { backorders } from "@/lib/stockMath";
import EventOfferPicker from "./EventOfferPicker";
import StaffPhraseCard from "./StaffPhraseCard";
import { ShopifyImportButton, InvitePanel } from "./MemberImport";
import { orderWeight, packagingOzOf, DEFAULT_PACKAGING_OZ } from "@/lib/shippingWeight";
import { EVT_ADMIN_REFRESH, EVT_ESCALATIONS, EVT_OPEN, EVT_USE_DRAFT, PHOTO_SLOT, type CampaignDraft } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";
import { cleanThemeChoice, themeForCategory, type ThemeChoice } from "@/lib/campaignThemes";
import { BlockArranger, LivePreview, ThemePicker } from "./CampaignComposerParts";

// Extended type – bulk orders have an `items` array
type RecentInquiry = Inquiry & {
  items?: Array<{ productId: string; productName: string; quantity: number }>;
};

const MEMBERS_PAGE_SIZE = 15;
const INQUIRIES_PER_PAGE = 10;
const ORDERS_PER_PAGE = 10;
const REGS_PER_PAGE = 15;
const SUBS_PER_PAGE = 25;
// Deprecated screen; flip to true to bring it back temporarily.
const SHOW_LEGACY_INQUIRY_ARCHIVE = false;

type TabKey = "overview" | "analytics" | "orders" | "members" | "products" | "events" | "marketing" | "ambassadors" | "assistant" | "settings";

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "overview", label: "Overview", icon: "◧" },
  { key: "analytics", label: "Analytics", icon: "◔" },
  { key: "orders", label: "Orders", icon: "🧾" },
  { key: "members", label: "Members", icon: "👥" },
  { key: "products", label: "Products", icon: "🏷️" },
  { key: "events", label: "Events", icon: "🎟" },
  { key: "marketing", label: "Marketing", icon: "✦" },
  { key: "ambassadors", label: "Ambassadors", icon: "★" },
  { key: "assistant", label: "Assistant", icon: "✧" },
  { key: "settings", label: "Settings", icon: "⚙" },
];

// One fulfilled status. Whether it shipped or was collected is already
// visible from the order's delivery method.
// "Inquiry" is retired: questions now go to Assistant → Handed to the team.
// Old inquiry orders still show under "All" and keep their label.
const ORDER_STATUSES: OrderStatus[] = ["pending", "paid", "completed", "cancelled"];

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending payment",
  paid: "Paid",
  completed: "Completed",
  // Legacy values from older orders, shown the same way
  shipped: "Completed",
  "picked-up": "Completed",
  cancelled: "Cancelled",
  inquiry: "Inquiry",
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "var(--yellow)",
  paid: "var(--mint)",
  completed: "var(--green)",
  shipped: "var(--green)",
  "picked-up": "var(--green)",
  cancelled: "var(--red)",
  inquiry: "var(--grey)",
};

export default function AdminDashboard({
  initialProducts,
}: {
  initialProducts: Product[];
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [allInquiries, setAllInquiries] = useState<RecentInquiry[]>([]);
  const [inquiriesPage, setInquiriesPage] = useState(0);
  const [showRecentInquiries, setShowRecentInquiries] = useState(false);
  const [showMembers, setShowMembers] = useState(true);

  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  // Which dashboard tab is showing
  const [tab, setTab] = useState<TabKey>("overview");

  // Stay on the tab you were working in across refreshes. Read after mount so
  // the server and first client render agree (no hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fp_admin_tab") as TabKey | null;
      if (saved && TABS.some((t) => t.key === saved)) setTab(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("fp_admin_tab", tab);
    } catch {}
  }, [tab]);
  // Overview → "At a glance" cards: open the tab (with the right order filter)
  // and bring the top of it into view, so the click visibly goes somewhere.
  const glanceGo = (t: TabKey, filter?: "pending" | "paid") => {
    setTab(t);
    if (filter) {
      setOrderFilter(filter);
      setOrdersPage(0);
    }
    requestAnimationFrame(() => document.querySelector(".admin-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // Overview → Quick actions: jump to a tab, a part of it, or a Settings tile.
  const goTo = (t: TabKey, opts: { filter?: "pending"; anchor?: string; settingsTile?: string } = {}) => {
    if (opts.settingsTile) {
      try {
        localStorage.setItem("fp_settings_open", opts.settingsTile); // SettingsTiles opens this one on arrival
      } catch {}
    }
    if (opts.filter) {
      setOrderFilter(opts.filter);
      setOrdersPage(0);
    }
    setTab(t);
    setTimeout(() => {
      const el = opts.anchor ? document.getElementById(opts.anchor) : null;
      (el || document.querySelector(".admin-tabs"))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  // Orders queue
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<OrderStatus | "all" | "expired">("all");
  // For the Expired tab's explainer: the reminder time limit and whether reminders are on.
  const [reminderExpireHours, setReminderExpireHours] = useState<number | null>(null);
  const [remindersOn, setRemindersOn] = useState(true);
  useEffect(() => {
    if (orderFilter !== "expired" || reminderExpireHours !== null) return;
    Promise.all([
      fetch("/api/admin/reminders", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)),
      fetch("/api/admin/flags", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)),
    ])
      .then(([r, f]) => {
        setReminderExpireHours(Number(r?.settings?.expireAfterHours) || 504);
        setRemindersOn(!!f?.flags?.find((x: { key: string; on: boolean }) => x.key === "invoice_reminders")?.on);
      })
      .catch(() => setReminderExpireHours(504));
  }, [orderFilter, reminderExpireHours]);
  const [ordersPage, setOrdersPage] = useState(0);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  // Member history modal (orders + legacy inquiries)
  const [historyUser, setHistoryUser] = useState<PublicUser | null>(null);
  const [historyInquiries, setHistoryInquiries] = useState<Inquiry[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Member password reset modal
  const [pwResetUser, setPwResetUser] = useState<PublicUser | null>(null);
  // Add member (admin-created, approved immediately)
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [amName, setAmName] = useState("");
  const [amEmail, setAmEmail] = useState("");
  const [amPassword, setAmPassword] = useState("");
  const [amSendEmail, setAmSendEmail] = useState(true);
  const [amSubscribe, setAmSubscribe] = useState(true);
  const [amSubmitting, setAmSubmitting] = useState(false);
  const [amMsg, setAmMsg] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  // Edit member (name / email correction)
  const [editMember, setEditMember] = useState<PublicUser | null>(null);
  const [emName, setEmName] = useState("");
  const [emEmail, setEmEmail] = useState("");
  // Shipping address + phone on the member (Edit member).
  const EM_ADDR = ["addressLine1", "addressLine2", "city", "state", "postalCode", "phone"] as const;
  type EmAddr = Record<(typeof EM_ADDR)[number], string>;
  const blankAddr: EmAddr = { addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", phone: "" };
  const [emAddr, setEmAddr] = useState<EmAddr>(blankAddr);
  const addrOf = (u: PublicUser): EmAddr => ({ addressLine1: u.addressLine1 || "", addressLine2: u.addressLine2 || "", city: u.city || "", state: u.state || "", postalCode: u.postalCode || "", phone: u.phone || "" });
  const [emSubmitting, setEmSubmitting] = useState(false);
  const [emMsg, setEmMsg] = useState("");
  const [pwResetValue, setPwResetValue] = useState("");
  const [pwResetEmailToggle, setPwResetEmailToggle] = useState(true);
  const [pwResetSubmitting, setPwResetSubmitting] = useState(false);
  const [pwResetMsg, setPwResetMsg] = useState("");

  // Edit product modal
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  // "Tidy with Concierge": which form is being rewritten, and the text to undo back to.
  const [tidying, setTidying] = useState<"add" | "edit" | null>(null);
  const [tidyMsg, setTidyMsg] = useState<{ form: "add" | "edit"; ok: boolean; text: string } | null>(null);
  const [tidyUndo, setTidyUndo] = useState<{ form: "add" | "edit"; text: string } | null>(null);
  const [tidyGuide, setTidyGuide] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSalePrice, setEditSalePrice] = useState("");
  const [editPromoType, setEditPromoType] = useState<"none" | "percent" | "bogo">("none");
  const [editPromoPercent, setEditPromoPercent] = useState(10);
  const [editCashOnly, setEditCashOnly] = useState(false);
  // "Cash pickup only" sales: the tick shows while the cash_pickup switch is on (or the product already has it).
  const [cashPickupOn, setCashPickupOn] = useState(false);
  useEffect(() => {
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((x) => (x.ok ? x.json() : null))
      .then((f) => setCashPickupOn(!!f?.flags?.find((x: { key: string; on: boolean }) => x.key === "cash_pickup")?.on))
      .catch(() => {});
  }, []);
  const [editVisibility, setEditVisibility] = useState<"internal" | "external" | "both">("internal");
  const [editIsBundleProd, setEditIsBundleProd] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editVideo, setEditVideo] = useState("");
  const [editWeight, setEditWeight] = useState("");
  // Stock counts (lib/stock.ts): "" = not counted; null while loading.
  const [editStock, setEditStock] = useState<string | null>(null);
  const [editStockWas, setEditStockWas] = useState<string | null>(null);
  // Stock counts for the product cards (lib/stock.ts); null = not loaded.
  const [stockMap, setStockMap] = useState<Record<string, number> | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  // Add product form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [promoType, setPromoType] = useState<"none" | "percent" | "bogo">("none");
  const [promoPercent, setPromoPercent] = useState(10);
  const [cashOnly, setCashOnly] = useState(false);
  const [visibility, setVisibility] = useState<"internal" | "external" | "both">("internal");
  const [isBundleProd, setIsBundleProd] = useState(false);
  const [category, setCategory] = useState("");
  const [image, setImage] = useState("");
  const [video, setVideo] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState("");

  // Product catalog workspace: search, filter, sort, view, bulk select
  const [addOpen, setAddOpen] = useState(false);
  const [prodSearch, setProdSearch] = useState("");
  const [prodFilter, setProdFilter] = useState<
    "all" | "internal" | "both" | "external" | "sale" | "bundle"
  >("all");
  const [prodSort, setProdSort] = useState<"order" | "name" | "price-high" | "price-low" | "newest">("order");
  const [prodView, setProdView] = useState<"grid" | "list">("grid");
  const [selectedProds, setSelectedProds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Admin password change
  const [newAdminPw, setNewAdminPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  // Member search / filter
  const [memberQuery, setMemberQuery] = useState("");
  const [memberPage, setMemberPage] = useState(0);

  // Export email state
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // Shipping label modal state
  const [shippingUser, setShippingUser] = useState<PublicUser | null>(null);
  const [shippingProductName, setShippingProductName] = useState("");
  const [shippingQuantity, setShippingQuantity] = useState(1);
  const [shippingWeightOz, setShippingWeightOz] = useState(8);
  const [shippingSubmitting, setShippingSubmitting] = useState(false);
  const [shippingLabelUrl, setShippingLabelUrl] = useState("");
  const [shippingError, setShippingError] = useState("");
  const [shippingService, setShippingService] = useState("usps_ground_advantage"); // NEW

  // Invoice modal state
  const [invoiceUser, setInvoiceUser] = useState<PublicUser | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<Map<string, number>>(new Map());
  const [invoiceNote, setInvoiceNote] = useState("");
  const [invoiceShippingOverride, setInvoiceShippingOverride] = useState<number | null>(null);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceSent, setInvoiceSent] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoicePayLink, setInvoicePayLink] = useState("");
  const [invoiceLinkCopied, setInvoiceLinkCopied] = useState(false);

  // Events
  const [events, setEvents] = useState<any[]>([]);
  const [evTitle, setEvTitle] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evLocation, setEvLocation] = useState("");
  const [evPrice, setEvPrice] = useState("");
  const [evCapacity, setEvCapacity] = useState("20");
  const [evWaitlist, setEvWaitlist] = useState("10");
  const [evType, setEvType] = useState("class");
  const [evImage, setEvImage] = useState("");
  const [evSaving, setEvSaving] = useState(false);
  const [evMsg, setEvMsg] = useState("");

  // Editing an existing event (published or draft)
  const [editEvent, setEditEvent] = useState<any | null>(null);
  const [edTitle, setEdTitle] = useState("");
  const [edDesc, setEdDesc] = useState("");
  const [edDate, setEdDate] = useState("");
  const [edLocation, setEdLocation] = useState("");
  const [edPrice, setEdPrice] = useState("");
  const [edCapacity, setEdCapacity] = useState("0");
  const [edWaitlist, setEdWaitlist] = useState("0");
  const [edType, setEdType] = useState("class");
  const [edImage, setEdImage] = useState("");
  const [edPublished, setEdPublished] = useState(true);
  const [edSaving, setEdSaving] = useState(false);
  const [edMsg, setEdMsg] = useState("");
  const [regEvent, setRegEvent] = useState<any | null>(null);
  const [regs, setRegs] = useState<any[]>([]);

  async function loadEvents() {
    try {
      const res = await adminFetch("/api/admin/events");
      if (res.ok) setEvents((await res.json()).events || []);
    } catch {}
  }
  useEffect(() => { loadEvents(); }, []);

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    setEvSaving(true);
    setEvMsg("");
    try {
      const res = await adminFetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: evTitle, description: evDesc,
          date: evDate ? pacificToMs(evDate) : undefined, // the box is local time
          location: evLocation, price: evPrice,
          capacity: evCapacity, waitlistCapacity: evWaitlist,
          type: evType, image: evImage,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEvents([{ ...data.event, registeredCount: 0, waitlistedCount: 0 }, ...events]);
        setEvTitle(""); setEvDesc(""); setEvDate(""); setEvLocation("");
        setEvPrice(""); setEvImage("");
        setEvMsg("Event created.");
        setTimeout(() => setEvMsg(""), 3000);
      } else {
        setEvMsg(data.error || "Could not create the event.");
      }
    } catch {
      setEvMsg("Network error.");
    }
    setEvSaving(false);
  }

  // datetime-local boxes show "YYYY-MM-DDTHH:mm" — always in local time.
  function toDatetimeLocal(ts: number): string {
    return msToPacificInput(ts);
  }

  function openEditEvent(e: any) {
    setEditEvent(e);
    setEdTitle(e.title || "");
    setEdDesc(e.description || "");
    setEdDate(e.date ? toDatetimeLocal(e.date) : "");
    setEdLocation(e.location || "");
    setEdPrice(e.price || "");
    setEdCapacity(String(e.capacity ?? 0));
    setEdWaitlist(String(e.waitlistCapacity ?? 0));
    setEdType(e.type || "class");
    setEdImage(e.image || "");
    setEdPublished(e.published !== false);
    setEdMsg("");
  }

  async function submitEditEvent(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editEvent) return;
    if (!edTitle.trim() || !edDate || !edLocation.trim()) {
      setEdMsg("Title, date, and location are required.");
      return;
    }
    setEdSaving(true);
    setEdMsg("");

    const previous = events;
    const patch = {
      title: edTitle.trim(),
      description: edDesc.trim(),
      date: pacificToMs(edDate),
      location: edLocation.trim(),
      price: edPrice.trim(),
      capacity: parseInt(edCapacity) || 0,
      waitlistCapacity: parseInt(edWaitlist) || 0,
      type: edType,
      image: edImage.trim(),
      published: edPublished,
    };
    setEvents(events.map((e) => (e.id === editEvent.id ? { ...e, ...patch } : e)));

    try {
      const res = await adminFetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editEvent.id, ...patch }),
      });
      setEdSaving(false);
      if (res.ok) {
        setEditEvent(null);
      } else {
        setEvents(previous);
        const data = await res.json().catch(() => ({}));
        setEdMsg(data.error || "Could not save those changes.");
      }
    } catch {
      setEvents(previous);
      setEdSaving(false);
      setEdMsg("Network error. Please try again.");
    }
  }

  async function toggleEventPublished(id: string, published: boolean) {
    setEvents(events.map((e) => (e.id === id ? { ...e, published } : e)));
    await adminFetch("/api/admin/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, published }),
    });
  }

  async function deleteEvent(id: string, title: string) {
    if (!confirm(`Delete "${title}"? Registrations stay in the record but the event disappears.`)) return;
    setEvents(events.filter((e) => e.id !== id));
    await adminFetch(`/api/admin/events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  const [regsPage, setRegsPage] = useState(0);

  async function openRegistrations(ev: any) {
    setRegsPage(0);
    setRegEvent(ev);
    setRegs([]);
    try {
      const res = await adminFetch(`/api/admin/events?eventId=${encodeURIComponent(ev.id)}`);
      if (res.ok) setRegs((await res.json()).registrations || []);
    } catch {}
  }

  async function registrationAction(registrationId: string, action: "cancel" | "promote") {
    const res = await adminFetch("/api/admin/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId, action }),
    });
    if (res.ok && regEvent) {
      openRegistrations(regEvent);
      loadEvents();
    }
  }

  function exportRegistrations() {
    if (!regEvent) return;
    const header = ["Name", "Email", "Phone", "Status", "Notes", "Registered"];
    const rows = regs.map((r) => [
      r.name, r.email, r.phone || "", r.status, r.notes || "",
      new Date(r.createdAt).toISOString(),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `registrations-${regEvent.title.replace(/\W+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Subscribers & campaigns
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [subActiveCount, setSubActiveCount] = useState(0);
  const [newSubEmail, setNewSubEmail] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [showSubs, setShowSubs] = useState(false);
  const [campSubject, setCampSubject] = useState("");
  const [campBody, setCampBody] = useState("");
  const campBodyRef = useRef<HTMLTextAreaElement>(null);
  const campCursorSet = useRef(false);
  // Put an uploaded photo where the cursor is in the message (or at the end), on its own line.
  function insertCampImage(url: string) {
    const el = campBodyRef.current;
    setCampBody((body) => {
      // The cursor stays put when the Upload button takes the focus; untouched box = the end.
      const at = el && campCursorSet.current ? Math.min(el.selectionStart, body.length) : body.length;
      const before = body.slice(0, at).replace(/\s+$/, ""), after = body.slice(at).replace(/^\s+/, "");
      return [before, imageLine(url, "Photo", body), after].filter(Boolean).join("\n\n");
    });
  }
  const [campSending, setCampSending] = useState(false);
  const [campMsg, setCampMsg] = useState("");

  // Audience filters. "Member" means an approved member account exists
  // with the same email — same rule the export and campaign sender use.
  type Audience = "all" | "members" | "nonmembers";
  const [subFilter, setSubFilter] = useState<Audience | "unsubscribed">("all");
  // Send to: any mix of the three groups, or a pasted list. Default = everyone on the mailing list
  // (members subscribed + mailing list – not member); non-subscribed members are opt-in for now.
  type CampGroup = "ms" | "mn" | "ls";
  const [campGroups, setCampGroups] = useState<CampGroup[]>(["ms", "ls"]);
  // Set when the draft came from a Today-list button: that item ticks itself off once this is sent.
  const [campTodayKey, setCampTodayKey] = useState("");
  const [campAudience, setCampAudience] = useState<"groups" | "custom">("groups");
  const [campCustom, setCampCustom] = useState("");
  const [campWhen, setCampWhen] = useState(""); // datetime-local; "" = send now
  // Seasonal look (lib/campaignThemes.ts), the theme "Auto" resolved to, how the
  // message is edited, and the scheduled campaign being edited (if any).
  const [campTheme, setCampTheme] = useState<ThemeChoice>("auto");
  const [campResolved, setCampResolved] = useState("");
  const [campMode, setCampMode] = useState<"write" | "arrange">("write");
  const [campEditing, setCampEditing] = useState<{ id: string; subject: string } | null>(null);
  const [campHistoryKey, setCampHistoryKey] = useState(0);
  const memberEmails = useMemo(
    () => new Set(users.filter((u) => u.status === "approved").map((u) => u.email.toLowerCase())),
    [users]
  );
  const isMemberSub = (s: any) => memberEmails.has(String(s.email || "").toLowerCase());
  const inAudience = (s: any, a: Audience) =>
    a === "all" ? true : a === "members" ? isMemberSub(s) : !isMemberSub(s);
  const filteredSubs =
    subFilter === "unsubscribed"
      ? subscribers.filter((s) => !!s.unsubscribedAt).sort((a, b) => (b.unsubscribedAt || 0) - (a.unsubscribedAt || 0))
      : subscribers.filter((s) => inAudience(s, subFilter));
  const [subsPage, setSubsPage] = useState(0);
  const totalSubPages = Math.max(1, Math.ceil(filteredSubs.length / SUBS_PER_PAGE));
  // Clamp, so removing the last person on the last page never shows an empty page.
  const safeSubsPage = Math.min(subsPage, totalSubPages - 1);
  const pagedSubs = filteredSubs.slice(safeSubsPage * SUBS_PER_PAGE, (safeSubsPage + 1) * SUBS_PER_PAGE);
  const activeInAudience = (a: Audience) =>
    subscribers.filter((s) => !s.unsubscribedAt && inAudience(s, a)).length;
  const customSet = useMemo(
    () => new Set(campCustom.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))),
    [campCustom]
  );
  // Campaigns reach active subscribers plus members who aren't on the list
  // (unless they've ever unsubscribed) — same rule as lib/campaignSchedule.ts.
  const membersOffList = useMemo(() => {
    const listed = new Set(subscribers.map((s) => String(s.email || "").toLowerCase()));
    return Array.from(memberEmails).filter((e) => !listed.has(e));
  }, [subscribers, memberEmails]);
  const groupCount: Record<CampGroup, number> = {
    ms: activeInAudience("members"),
    mn: membersOffList.length,
    ls: activeInAudience("nonmembers"),
  };
  const campRecipientCount =
    campAudience === "custom"
      ? subscribers.filter((s) => !s.unsubscribedAt && customSet.has(String(s.email || "").toLowerCase())).length +
        membersOffList.filter((e) => customSet.has(e)).length
      : campGroups.reduce((n, g) => n + groupCount[g], 0);
  const toggleGroup = (g: CampGroup) => {
    setCampAudience("groups");
    setCampGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  // Event sign-up QR code. Points at /join on whatever host the admin is on,
  // with an optional event name baked in so sign-ups are tagged.
  const [qrEvent, setQrEvent] = useState("");
  // The event's welcome offer ("15% off"), when one is set and working — printed under the QR.
  const [qrOfferText, setQrOfferText] = useState<string | null>(null);
  const [qrOrigin, setQrOrigin] = useState("");
  useEffect(() => { setQrOrigin(window.location.origin); }, []);
  const qrUrl = qrOrigin
    ? `${qrOrigin}/join${qrEvent.trim() ? `?event=${encodeURIComponent(qrEvent.trim())}` : ""}`
    : "";
  const qrMarkup = useMemo(() => (qrUrl ? qrSvg(qrUrl, { size: 200 }) : ""), [qrUrl]);
  function downloadQr() {
    const svg = qrSvg(qrUrl, { size: 1200, margin: 4 });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `four-peaks-signup${qrEvent.trim() ? `-${qrEvent.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : ""}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function printQr() {
    const w = window.open("", "_blank", "width=700,height=900");
    if (!w) return;
    const label = qrEvent.trim() ? `<div class="ev">${qrEvent.trim().replace(/</g, "&lt;")}</div>` : "";
    w.document.write(`<!doctype html><html><head><title>${brand.name} sign-up</title>
<style>
  body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:Optima,"Segoe UI",system-ui,sans-serif;color:#2b2f27;text-align:center}
  .wrap{padding:2rem}
  h1{font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:2.2rem;margin:0 0 .25rem}
  .ev{font-size:.85rem;letter-spacing:.2em;text-transform:uppercase;color:#6fa336;font-weight:700;margin-bottom:1.25rem}
  p{font-size:1.15rem;color:#61676d;margin:1.25rem 0 0}
  svg{width:min(70vw,520px);height:auto}
  @media print{ .wrap{padding:0} }
</style></head><body><div class="wrap">
<h1>${brand.name}</h1>${label}
${qrSvg(qrUrl, { size: 520, margin: 3 })}
<p>Scan to join our mailing list${qrOfferText ? `<br/><strong style="color:#6fa336">&amp; get ${qrOfferText.replace(/</g, "&lt;")} your order</strong>` : ""}</p>
</div><script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  async function loadSubscribers() {
    try {
      const res = await adminFetch("/api/admin/subscribers");
      if (res.ok) {
        const d = await res.json();
        setSubscribers(d.subscribers || []);
        setSubActiveCount(d.activeCount || 0);
      }
    } catch {}
  }
  useEffect(() => { loadSubscribers(); }, []);

  const [subImporting, setSubImporting] = useState(false);
  const [memberImporting, setMemberImporting] = useState(false);

  /**
   * Upload a CSV of members or subscribers. Reads the file in the browser and
   * posts the text, so there's no multipart handling on the server.
   */
  async function importCsv(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "members" | "subscribers"
  ) {
    const file = e.target.files?.[0];
    // Let the same file be picked again after a failure
    e.target.value = "";
    if (!file) return;

    const setBusy = kind === "members" ? setMemberImporting : setSubImporting;
    setBusy(true);
    try {
      const csv = await file.text();
      const url =
        kind === "members" ? "/api/admin/users/import" : "/api/admin/subscribers/import";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);

      if (!res.ok) {
        alert(data.error || "Could not import that file.");
        return;
      }

      const bits = [`${data.added} added`];
      if (data.resubscribed) bits.push(`${data.resubscribed} re-subscribed`);
      if (data.alreadyThere) bits.push(`${data.alreadyThere} already on the list`);
      if (data.invalid) bits.push(`${data.invalid} skipped (bad email)`);
      if (data.skippedStatus) bits.push(`${data.skippedStatus} skipped (not active or approved)`);
      alert(
        `Imported ${data.rows} row${data.rows === 1 ? "" : "s"}.\n\n${bits.join("\n")}` +
          (kind === "members" && data.added
            ? `\n\nNew members can sign in using "Forgot password?" to set a password.`
            : "")
      );

      if (kind === "members") await loadUsers();
      else await loadSubscribers();
    } catch {
      setBusy(false);
      alert("Could not read that file. Make sure it's a .csv.");
    }
  }

  async function addSubscriberManual(e: React.FormEvent) {
    e.preventDefault();
    const res = await adminFetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newSubEmail, name: newSubName }),
    });
    if (res.ok) {
      setNewSubEmail("");
      setNewSubName("");
      loadSubscribers();
    }
  }

  async function removeSubscriber(id: string, email: string) {
    if (!confirm(`Remove ${email} from the list?`)) return;
    setSubscribers(subscribers.filter((s) => s.id !== id));
    await adminFetch(`/api/admin/subscribers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    loadSubscribers();
  }

  async function sendCampaign(testOnly: boolean) {
    if (!campSubject.trim() || !campBody.trim()) {
      setCampMsg("Add a subject and a message first.");
      return;
    }
    if (campBody.includes(PHOTO_SLOT)) {
      setCampMsg("The photo from the chat hasn't been added yet. Use Upload photo, or delete the [[PHOTO]] line.");
      return;
    }
    if (!testOnly && campAudience === "groups" && campGroups.length === 0) {
      setCampMsg("Pick at least one group to send to.");
      return;
    }
    if (!testOnly && campEditing) return saveCampaignEdit();
    const audienceLabel = campAudience === "custom" ? "listed" : "";
    const whenMs = campWhen ? pacificToMs(campWhen) : 0; // the box is local time
    if (!testOnly && whenMs && whenMs < Date.now()) {
      setCampMsg("That time has already passed — pick a future time, or clear it to send now.");
      return;
    }
    const whenLabel = whenMs ? `${new Date(whenMs).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} local` : "";
    if (
      !testOnly &&
      !confirm(
        whenMs
          ? `Schedule "${campSubject}" for ${whenLabel} to ${campRecipientCount} ${audienceLabel ? audienceLabel + " " : ""}people?\n\nScheduling is your approval: it sends automatically (between 9am and 6pm local). You can cancel it any time before then.`
          : `Send "${campSubject}" to ${campRecipientCount} ${audienceLabel ? audienceLabel + " " : ""}people now?`
      )
    )
      return;

    setCampSending(true);
    setCampMsg("");
    try {
      const res = await adminFetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: campSubject,
          body: campBody,
          testOnly,
          audience: campAudience,
          groups: campAudience === "groups" ? campGroups : undefined,
          customList: campAudience === "custom" ? campCustom : undefined,
          scheduledFor: !testOnly && whenMs ? whenMs : undefined,
          theme: campTheme,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCampMsg(
          testOnly
            ? "✅ Test sent to your inbox."
            : data.scheduled
              ? `✅ Scheduled for ${whenLabel} to ${data.recipients} people.${data.note ? ` ${data.note}` : ""}`
              : `✅ Sent to ${data.sent} people${data.failed ? `, ${data.failed} failed` : ""}${data.remaining ? ` — the other ${data.remaining} go out within 15 minutes` : ""}.`
        );
        if (!testOnly) {
          setCampSubject(""); setCampBody(""); setCampWhen(""); setCampTheme("auto"); setCampHistoryKey((k) => k + 1);
          if (campTodayKey) {
            fetch("/api/admin/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: campTodayKey, done: true }) })
              .then(() => window.dispatchEvent(new CustomEvent(EVT_ADMIN_REFRESH, { detail: ["today"] })))
              .catch(() => {});
            setCampTodayKey("");
          }
        }
      } else {
        setCampMsg(`❌ ${data.error || "Failed to send."}`);
      }
    } catch {
      setCampMsg("❌ Network error.");
    }
    setCampSending(false);
  }

  // Save changes to a scheduled campaign (Campaigns → Edit). Still scheduled afterwards.
  async function saveCampaignEdit() {
    if (!campEditing) return;
    const whenMs = campWhen ? pacificToMs(campWhen) : 0;
    if (!whenMs || whenMs < Date.now()) {
      setCampMsg("Pick a time in the future for it to go out. To send it now instead, cancel it and send a copy.");
      return;
    }
    setCampSending(true);
    setCampMsg("");
    try {
      const res = await adminFetch("/api/admin/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: campEditing.id,
          subject: campSubject,
          body: campBody,
          theme: campTheme,
          audience: campAudience,
          groups: campAudience === "groups" ? campGroups : undefined,
          customList: campAudience === "custom" ? campCustom : undefined,
          scheduledFor: whenMs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const label = new Date(whenMs).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
        setCampMsg(`✅ Saved. Still scheduled for ${label} (local) to ${data.recipients} people.${data.note ? ` ${data.note}` : ""}`);
        setCampEditing(null);
        setCampSubject(""); setCampBody(""); setCampWhen(""); setCampTheme("auto"); setCampHistoryKey((k) => k + 1);
      } else {
        setCampMsg(`❌ ${data.error || "Couldn't save the changes."}`);
      }
    } catch {
      setCampMsg("❌ Network error.");
    }
    setCampSending(false);
  }

  // Loyalty points modal
  const [loyaltyUser, setLoyaltyUser] = useState<PublicUser | null>(null);
  const [lyAmount, setLyAmount] = useState("");
  const [lyReason, setLyReason] = useState("");
  const [lyBusy, setLyBusy] = useState(false);
  const [lyMsg, setLyMsg] = useState("");

  function openLoyalty(u: PublicUser) {
    setLoyaltyUser(u);
    setLyAmount("");
    setLyReason("");
    setLyMsg("");
  }

  async function adjustMemberPoints() {
    if (!loyaltyUser || !lyAmount) return;
    setLyBusy(true);
    setLyMsg("");
    try {
      const res = await adminFetch("/api/admin/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: loyaltyUser.id,
          action: "points",
          amount: Number(lyAmount),
          reason: lyReason,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(users.map((u) => (u.id === loyaltyUser.id ? { ...u, loyaltyPoints: data.points } as any : u)));
        setLoyaltyUser({ ...loyaltyUser, loyaltyPoints: data.points } as any);
        setLyMsg(`✅ Balance is now ${data.points} points.`);
        setLyAmount("");
        setLyReason("");
      } else {
        setLyMsg(`❌ ${data.error || "Failed."}`);
      }
    } catch {
      setLyMsg("❌ Network error.");
    }
    setLyBusy(false);
  }


  // Discount codes
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [dcCode, setDcCode] = useState("");
  const [dcType, setDcType] = useState<"percentage" | "fixed">("percentage");
  const [dcValue, setDcValue] = useState("");
  const [dcLabel, setDcLabel] = useState("");
  const [dcExpires, setDcExpires] = useState("");
  const [dcMaxUses, setDcMaxUses] = useState("");
  const [dcPerCustomer, setDcPerCustomer] = useState("");
  const [dcMinOrder, setDcMinOrder] = useState("");
  const [dcPublic, setDcPublic] = useState(false);
  const [dcSaving, setDcSaving] = useState(false);
  const [dcMsg, setDcMsg] = useState("");

  async function loadDiscounts() {
    try {
      const res = await adminFetch("/api/admin/discounts");
      if (res.ok) setDiscounts((await res.json()).discounts || []);
    } catch {}
  }
  useEffect(() => { loadDiscounts(); }, []);

  async function createDiscount(e: React.FormEvent) {
    e.preventDefault();
    setDcSaving(true);
    setDcMsg("");
    try {
      const res = await adminFetch("/api/admin/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: dcCode,
          type: dcType,
          value: dcValue,
          label: dcLabel,
          // Works through the end of that day, local (it used to stop at 5pm the day before).
          expiresAt: dcExpires ? endOfPacificDay(dcExpires) : undefined,
          maxUses: dcMaxUses || undefined,
          perCustomerLimit: dcPerCustomer || undefined,
          minOrderAmount: dcMinOrder || undefined,
          publicShop: dcPublic || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDiscounts([data.discount, ...discounts]);
        setDcCode(""); setDcValue(""); setDcLabel(""); setDcExpires("");
        setDcMaxUses(""); setDcPerCustomer(""); setDcMinOrder(""); setDcPublic(false);
        setDcMsg(`Created ${data.discount.code}.`);
        setTimeout(() => setDcMsg(""), 3000);
      } else {
        setDcMsg(data.error || "Could not create the code.");
      }
    } catch {
      setDcMsg("Network error.");
    }
    setDcSaving(false);
  }

  async function toggleDiscount(id: string, active: boolean) {
    setDiscounts(discounts.map((d) => (d.id === id ? { ...d, active } : d)));
    await adminFetch("/api/admin/discounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
  }

  async function togglePublicShop(id: string, publicShop: boolean) {
    setDiscounts(discounts.map((d) => (d.id === id ? { ...d, publicShop } : d)));
    await adminFetch("/api/admin/discounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, publicShop }),
    });
  }

  async function deleteDiscount(id: string, code: string) {
    if (!confirm(`Delete code ${code}? This can't be undone.`)) return;
    setDiscounts(discounts.filter((d) => d.id !== id));
    await adminFetch(`/api/admin/discounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // Site settings (bundle rule + loyalty)
  const [stBundleEnabled, setStBundleEnabled] = useState(false);
  const [stBundleMin, setStBundleMin] = useState(3);
  const [stBundlePct, setStBundlePct] = useState(10);
  const [stLoyaltyEnabled, setStLoyaltyEnabled] = useState(false);
  const [stPointsPerDollar, setStPointsPerDollar] = useState(1);
  const [stPointsPerDollarRedeemed, setStPointsPerDollarRedeemed] = useState(100);
  const [stMinRedeem, setStMinRedeem] = useState(100);
  const [stSaving, setStSaving] = useState(false);
  const [stMsg, setStMsg] = useState("");

  // Named so the assistant can reload it after a confirmed change — otherwise
  // this form would still hold the old values and saving it would undo that.
  const loadSettings = () =>
    adminFetch("/api/admin/settings")
      .then((r) => r.json())
      .then(({ settings: s }) => {
        if (!s) return;
        setStBundleEnabled(!!s.bundleRuleEnabled);
        setStBundleMin(s.bundleRuleMinItems ?? 3);
        setStBundlePct(s.bundleRulePercent ?? 10);
        setStLoyaltyEnabled(!!s.loyaltyEnabled);
        setStPointsPerDollar(s.pointsPerDollar ?? 1);
        setStPointsPerDollarRedeemed(s.pointsPerDollarRedeemed ?? 100);
        setStMinRedeem(s.minPointsToRedeem ?? 100);
      })
      .catch(() => {});
  useEffect(() => {
    loadSettings();
  }, []);

  async function saveSettingsForm(e: React.FormEvent) {
    e.preventDefault();
    setStSaving(true);
    setStMsg("");
    try {
      const res = await adminFetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundleRuleEnabled: stBundleEnabled,
          bundleRuleMinItems: stBundleMin,
          bundleRulePercent: stBundlePct,
          loyaltyEnabled: stLoyaltyEnabled,
          pointsPerDollar: stPointsPerDollar,
          pointsPerDollarRedeemed: stPointsPerDollarRedeemed,
          minPointsToRedeem: stMinRedeem,
        }),
      });
      setStMsg(res.ok ? "Saved." : "Could not save.");
      setTimeout(() => setStMsg(""), 3000);
    } catch {
      setStMsg("Network error.");
    }
    setStSaving(false);
  }

  // Announcement banner state
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerLinkUrl, setBannerLinkUrl] = useState("");
  const [bannerLinkLabel, setBannerLinkLabel] = useState("");
  const [bannerBg, setBannerBg] = useState("#85ba45");
  const [bannerText, setBannerText] = useState("#ffffff");
  const [bannerCountdown, setBannerCountdown] = useState(""); // datetime-local value
  const [bannerCountdownLabel, setBannerCountdownLabel] = useState("");
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerMsg, setBannerMsg] = useState("");

  const loadBanner = () =>
    adminFetch("/api/admin/banner")
      .then((r) => r.json())
      .then(({ banner }) => {
        if (!banner) return;
        setBannerEnabled(!!banner.enabled);
        setBannerMessage(banner.message || "");
        setBannerLinkUrl(banner.linkUrl || "");
        setBannerLinkLabel(banner.linkLabel || "");
        setBannerBg(banner.background || "#85ba45");
        setBannerText(banner.textColor || "#ffffff");
        setBannerCountdownLabel(banner.countdownLabel || "");
        if (banner.countdownTo) {
          // Epoch → the box, in local time
          setBannerCountdown(msToPacificInput(banner.countdownTo));
        } else {
          setBannerCountdown("");
        }
      })
      .catch(() => {});
  useEffect(() => {
    loadBanner();
  }, []);

  async function saveBannerForm(e: React.FormEvent) {
    e.preventDefault();
    setBannerSaving(true);
    setBannerMsg("");
    try {
      const res = await adminFetch("/api/admin/banner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: bannerEnabled,
          message: bannerMessage,
          linkUrl: bannerLinkUrl,
          linkLabel: bannerLinkLabel,
          background: bannerBg,
          textColor: bannerText,
          countdownTo: bannerCountdown ? pacificToMs(bannerCountdown) : undefined,
          countdownLabel: bannerCountdownLabel,
        }),
      });
      setBannerMsg(res.ok ? "Saved. Refresh the site to see it." : "Could not save the banner.");
      setTimeout(() => setBannerMsg(""), 4000);
    } catch {
      setBannerMsg("Network error.");
    }
    setBannerSaving(false);
  }

  // Member message modal state
  const [msgUser, setMsgUser] = useState<PublicUser | null>(null);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgText, setMsgText] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgStatus, setMsgStatus] = useState("");

  function openMemberMessage(user: PublicUser) {
    setMsgUser(user);
    setMsgSubject("");
    setMsgText("");
    setMsgStatus("");
  }

  async function sendMemberMessage() {
    if (!msgUser || !msgText.trim()) return;
    setMsgSending(true);
    setMsgStatus("");
    try {
      const res = await adminFetch("/api/admin/users/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: msgUser.id, subject: msgSubject, message: msgText }),
      });
      if (res.ok) {
        setMsgStatus(`✅ Sent to ${msgUser.email}.`);
        setMsgText("");
      } else {
        const data = await res.json().catch(() => ({}));
        setMsgStatus(`❌ ${data.error || "Failed to send."}`);
      }
    } catch {
      setMsgStatus("❌ Network error.");
    }
    setMsgSending(false);
  }

  // Load data on mount
  useEffect(() => {
    loadUsers();
    if (SHOW_LEGACY_INQUIRY_ARCHIVE) loadRecentInquiries(); // hidden screen: skip the download
    loadOrders();
  }, []);

  async function loadOrders() {
    try {
      const res = await adminFetch("/api/admin/orders");
      if (res.ok) {
        const data = await res.json();
        // Lay recently confirmed changes over the fetched list, so a refresh
        // during the storage lag window doesn't appear to undo them.
        const fresh = applyRecentChanges<Order>("order", data.orders);
        setOrders(fresh);

        // Deep link: /admin?order=<id> (from notification emails)
        // opens that order's detail modal on load.
        const params = new URLSearchParams(window.location.search);
        const linkedId = params.get("order");
        if (linkedId) {
          const linked = fresh.find((o) => o.id === linkedId);
          if (linked) {
            // A link from an email should win over the remembered tab.
            setTab("orders");
            setDetailOrder(linked);
          }
          // Clean the param so refreshes don't re-open it
          window.history.replaceState({}, "", "/admin");
        }
      }
    } catch (err) {
      console.error("Failed to load orders", err);
    }
  }

  async function changeOrderStatus(id: string, status: OrderStatus) {
    const previous = orders;
    const now = Date.now();
    setOrders(orders.map((o) =>
      o.id === id
        ? {
            ...o,
            status,
            paidAt: status === "paid" || status === "completed" ? o.paidAt || now : o.paidAt,
            shippedAt: status === "completed" && o.shippingMethod !== "pickup" ? now : o.shippedAt,
            pickedUpAt: status === "completed" && o.shippingMethod === "pickup" ? now : o.pickedUpAt,
          }
        : o
    ));
    setDetailOrder((d) => (d && d.id === id ? { ...d, status } : d));
    const res = await adminFetch("/api/admin/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      setOrders(previous);
      alert("Could not update order status. Please try again.");
    } else {
      const data = await res.json().catch(() => ({}));
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === id ? data.order : o)));
        setDetailOrder((d) => (d && d.id === id ? data.order : d));
        // Survive a refresh during the storage lag window.
        rememberChange("order", id, {
          status: data.order.status,
          paidAt: data.order.paidAt,
          shippedAt: data.order.shippedAt,
          pickedUpAt: data.order.pickedUpAt,
        });
      }
    }
  }

  async function loadUsers() {
    const res = await adminFetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(applyRecentChanges("user", data.users));
    }
  }

  async function loadRecentInquiries() {
    try {
      const res = await adminFetch("/api/admin/inquiries");
      if (res.ok) {
        const data = await res.json();
        setAllInquiries(data.inquiries);
        setInquiriesPage(0);
      }
    } catch (err) {
      console.error("Failed to load recent inquiries", err);
    }
  }

  async function loadProducts() {
    const res = await adminFetch("/api/admin/products");
    if (res.ok) {
      const data = await res.json();
      setProducts(data.products);
    }
  }

  function startPending(id: string) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }
  function endPending(id: string) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function openHistory(user: PublicUser) {
    setHistoryUser(user);
    setHistoryInquiries([]);
    setHistoryOrders([]);
    setHistoryLoading(true);
    const [inqRes, ordRes] = await Promise.all([
      adminFetch(`/api/admin/inquiries?userId=${encodeURIComponent(user.id)}`),
      adminFetch(`/api/admin/orders?userId=${encodeURIComponent(user.id)}`),
    ]);
    if (inqRes.ok) {
      const data = await inqRes.json();
      setHistoryInquiries(data.inquiries);
    }
    if (ordRes.ok) {
      const data = await ordRes.json();
      setHistoryOrders(data.orders);
    }
    setHistoryLoading(false);
  }

  function closeHistory() {
    setHistoryUser(null);
    setHistoryInquiries([]);
    setHistoryOrders([]);
  }

  async function handleLogout() {
    await adminFetch("/api/logout", { method: "POST" });
    router.refresh();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddMsg("");
    const wanted = name.trim();
    const res = await queueProductWrite(() =>
      adminFetch(
        "/api/admin/products",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, description, price, salePrice, category, image, video: video.trim(), weightOz: Number(newWeight) > 0 ? Number(newWeight) : undefined,
            visibility, isBundle: isBundleProd,
            promo: promoType !== "none" ? { type: promoType, percent: promoPercent } : undefined,
            cashOnly: cashOnly && (!!salePrice.trim() || promoType !== "none"),
          }),
        },
        // Only call it saved once the new product reads back.
        { verify: () => productsMatch((ps) => ps.some((p) => p.name === wanted)) }
      )
    );
    if (res.ok) {
      const { product } = await res.json();
      setProducts([product, ...products]);
      setName("");
      setDescription("");
      setPrice("");
      setSalePrice("");
      setPromoType("none");
      setPromoPercent(10);
      setCashOnly(false);
      setVisibility("internal");
      setIsBundleProd(false);
      setCategory("");
      setImage("");
      setVideo("");
      setNewWeight("");
      setAddMsg("Added.");
      setTimeout(() => setAddMsg(""), 2000);
    } else {
      setAddMsg("Failed to add.");
    }
    setAdding(false);
  }

  function loadStock() {
    fetch("/api/admin/stock", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.stock && setStockMap(d.stock))
      .catch(() => {});
  }
  useEffect(() => {
    if (tab === "products") loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // Units owed to customers, per product (shown on cards + the edit card).
  const owedByProduct = useMemo(() => backorders(orders.map((o) => ({ ...o, status: normalizeStatus(o.status) })), products), [orders, products]);

  function openEditProduct(p: Product) {
    setEditProduct(p);
    setEditName(p.name);
    setEditDescription(p.description);
    setEditPrice(p.price);
    setEditSalePrice(p.salePrice || "");
    setEditPromoType(p.promo?.type || "none");
    setEditPromoPercent(p.promo?.percent || 10);
    setEditCashOnly(!!p.cashOnly);
    setEditVisibility(p.visibility || (p.retail ? "both" : "internal"));
    setEditIsBundleProd(!!p.isBundle);
    setEditCategory(p.category || "");
    setEditImage(p.image);
    setEditVideo(p.video || "");
    setEditWeight(p.weightOz ? String(p.weightOz) : "");
    setEditMsg("");
    setEditStock(null);
    setEditStockWas(null);
    adminFetch("/api/admin/stock", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = d?.stock && p.id in d.stock ? String(d.stock[p.id]) : "";
        setEditStock(v);
        setEditStockWas(v);
      })
      .catch(() => {});
  }

  function closeEditProduct() {
    setEditProduct(null);
    setEditMsg("");
  }

  async function submitEditProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editProduct) return;
    if (!editName.trim() || !editDescription.trim() || !editPrice.trim() || !editImage.trim()) {
      setEditMsg("Name, description, price, and image are required.");
      return;
    }
    setEditSubmitting(true);
    setEditMsg("");

    const previousProducts = products;
    setProducts(
      products.map((p) =>
        p.id === editProduct.id
          ? {
              ...p,
              name: editName.trim(),
              description: editDescription.trim(),
              price: editPrice.trim(),
              salePrice: editSalePrice.trim() || undefined,
              promo: editPromoType !== "none" ? { type: editPromoType, percent: editPromoPercent } : undefined,
              cashOnly: editCashOnly && (!!editSalePrice.trim() || editPromoType !== "none") ? true : undefined,
              visibility: editVisibility,
              isBundle: editIsBundleProd,
              category: editCategory.trim() || undefined,
              image: editImage.trim(),
              video: editVideo.trim() || undefined,
              weightOz: Number(editWeight) > 0 ? Number(editWeight) : undefined,
            }
          : p
      )
    );

    const editedId = editProduct.id;
    const wantedName = editName.trim();
    const wantedPrice = editPrice.trim();
    const wantedVis = editVisibility;
    const res = await queueProductWrite(() =>
      adminFetch("/api/admin/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editProduct!.id,
        name: editName.trim(),
        description: editDescription.trim(),
        price: editPrice.trim(),
        salePrice: editSalePrice.trim(),
        promo: editPromoType !== "none" ? { type: editPromoType, percent: editPromoPercent } : undefined,
        cashOnly: editCashOnly && (!!editSalePrice.trim() || editPromoType !== "none"),
        visibility: editVisibility,
        isBundle: editIsBundleProd,
        category: editCategory.trim(),
        image: editImage.trim(),
        video: editVideo.trim(),
        weightOz: Number(editWeight) > 0 ? Number(editWeight) : 0,
      }),
      },
      // Only call it saved once the edit reads back from the server.
      {
        verify: () =>
          productsMatch((ps) => {
            const p = ps.find((x) => x.id === editedId);
            return (
              !!p &&
              p.name === wantedName &&
              p.price === wantedPrice &&
              visOf(p) === wantedVis
            );
          }),
      }
      )
    );

    // Stock count: its own store, saved only when it changed.
    if (res.ok && !editIsBundleProd && editStock !== null && editStockWas !== null && editStock.trim() !== editStockWas) {
      const sr = await adminFetch("/api/admin/stock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts: { [editedId]: editStock.trim() === "" ? null : Number(editStock) } }),
      });
      if (!sr.ok) {
        const d = await sr.json().catch(() => ({}));
        setEditSubmitting(false);
        setEditMsg(`Saved the product, but not the stock count: ${d.error || "please try again."}`);
        return;
      }
      setEditStockWas(editStock.trim());
      loadStock();
      window.dispatchEvent(new CustomEvent(EVT_ADMIN_REFRESH, { detail: ["products"] }));
    }

    setEditSubmitting(false);

    if (res.ok) {
      closeEditProduct();
    } else {
      setProducts(previousProducts);
      setEditMsg("Could not save changes. Please try again.");
    }
  }

  async function handleDeleteProduct(id: string) {
    if (pendingActions.has(id)) return;
    if (!confirm("Remove this product?")) return;
    startPending(id);

    const previousProducts = products;
    setProducts(products.filter((p) => p.id !== id));

    const res = await queueProductWrite(() =>
      adminFetch(
        `/api/admin/products?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
        { verify: () => productsMatch((ps) => !ps.some((p) => p.id === id)) }
      )
    );

    endPending(id);

    if (!res.ok) {
      setProducts(previousProducts);
      alert("Could not remove product. Please try again.");
    }
  }

  // ---- Catalog helpers -------------------------------------------------
  // Visibility of a product, tolerating the legacy `retail` boolean.
  function visOf(p: Product): "internal" | "both" | "external" {
    return (p.visibility || (p.retail ? "both" : "internal")) as "internal" | "both" | "external";
  }
  function isOnSale(p: Product): boolean {
    return !!p.salePrice?.trim() || p.promo?.type === "percent" || p.promo?.type === "bogo";
  }
  function priceNum(p: Product): number {
    return parseFloat(String(p.salePrice || p.price).replace(/[^0-9.]/g, "")) || 0;
  }

  // Reordering only makes sense against the true display order.
  const catalogReorderable = prodSort === "order" && prodFilter === "all" && !prodSearch.trim();

  const shownProducts = (() => {
    const q = prodSearch.trim().toLowerCase();
    let list = products.filter((p) => {
      if (q && !`${p.name} ${p.category || ""} ${p.description}`.toLowerCase().includes(q)) return false;
      if (prodFilter === "all") return true;
      if (prodFilter === "sale") return isOnSale(p);
      if (prodFilter === "bundle") return !!p.isBundle;
      return visOf(p) === prodFilter;
    });
    if (prodSort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (prodSort === "price-high") list = [...list].sort((a, b) => priceNum(b) - priceNum(a));
    else if (prodSort === "price-low") list = [...list].sort((a, b) => priceNum(a) - priceNum(b));
    else if (prodSort === "newest") list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  })();

  function toggleProdSelect(id: string) {
    setSelectedProds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Send a full product body (the API requires all core fields on PUT).
  async function putProduct(p: Product, patch: Partial<Product>) {
    const merged = { ...p, ...patch };
    return adminFetch("/api/admin/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        name: merged.name,
        description: merged.description,
        price: merged.price,
        salePrice: merged.salePrice || "",
        promo: merged.promo,
        visibility: merged.visibility || (merged.retail ? "both" : "internal"),
        isBundle: !!merged.isBundle,
        category: merged.category || "",
        image: merged.image,
      }),
    });
  }

  // Every product write rewrites the whole catalog file, so two overlapping
  // writes lose one another's changes. This chains them: each waits for the
  // one before it, no matter how fast the buttons are clicked.
  const productWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  function queueProductWrite<T>(job: () => Promise<T>): Promise<T> {
    const next = productWriteQueue.current.then(job, job);
    productWriteQueue.current = next.catch(() => {});
    return next;
  }

  // One request for the whole selection — a single read-modify-write on the
  // server instead of one per product racing each other.
  async function bulkSetVisibility(v: "internal" | "both" | "external") {
    if (selectedProds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const ids = Array.from(selectedProds);
    const previous = products;
    setProducts(products.map((p) => (selectedProds.has(p.id) ? { ...p, visibility: v, retail: undefined } : p)));

    try {
      const res = await queueProductWrite(() =>
        adminFetch(
          "/api/admin/products",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, visibility: v }),
          },
          {
            verify: () =>
              productsMatch((ps) =>
                ids.every((id) => {
                  const p = ps.find((x) => x.id === id);
                  return !!p && visOf(p) === v;
                })
              ),
          }
        )
      );
      setBulkBusy(false);
      if (!res.ok) {
        setProducts(previous);
        alert("Could not update those products. Please try again.");
        return;
      }
      // Trust what the server saved over our optimistic guess.
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.products)) {
        const byId = new Map<string, Product>(data.products.map((p: Product) => [p.id, p]));
        setProducts((prev) => prev.map((p) => byId.get(p.id) || p));
      }
      setSelectedProds(new Set());
    } catch {
      setBulkBusy(false);
      setProducts(previous);
      alert("Network error. Please try again.");
    }
  }

  async function bulkDeleteProducts() {
    if (selectedProds.size === 0 || bulkBusy) return;
    if (!confirm(`Remove ${selectedProds.size} product${selectedProds.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const ids = Array.from(selectedProds);
    const previous = products;
    setProducts(products.filter((p) => !selectedProds.has(p.id)));
    const results = await Promise.all(
      ids.map((id) => adminFetch(`/api/admin/products?id=${encodeURIComponent(id)}`, { method: "DELETE" }))
    );
    setBulkBusy(false);
    if (results.some((r) => !r.ok)) {
      setProducts(previous);
      alert("Some products could not be removed. Please try again.");
    } else {
      setSelectedProds(new Set());
    }
  }

  // Copy a product as a new draft — fastest way to add a variant.
  async function duplicateProduct(p: Product) {
    if (pendingActions.has(p.id)) return;
    startPending(p.id);
    const res = await adminFetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${p.name} (copy)`,
        description: p.description,
        price: p.price,
        salePrice: p.salePrice || "",
        promo: p.promo,
        visibility: visOf(p),
        isBundle: !!p.isBundle,
        category: p.category || "",
        image: p.image,
      }),
    });
    endPending(p.id);
    if (res.ok) {
      const { product } = await res.json();
      setProducts((prev) => [product, ...prev]);
    } else {
      alert("Could not duplicate that product.");
    }
  }

  // ---- Visibility changes are collected, then saved together -------------
  //
  // Clicking chips one at a time used to mean one whole-catalog rewrite per
  // click, and each write was based on a snapshot taken before the previous
  // one landed — which is how changing eight products left only four changed.
  //
  // Instead, a click updates the screen immediately and drops the change into
  // a pending set. Keep clicking and they gather. Once you pause (or leave the
  // tab, or hit Save now), everything pending is written in ONE request per
  // target visibility. One read, one write, nothing to race.
  const COALESCE_MS = 900;
  const pendingVis = useRef<Map<string, "internal" | "both" | "external">>(new Map());
  const visTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visSaving, setVisSaving] = useState(false);
  const [visPendingCount, setVisPendingCount] = useState(0);
  // How many were just saved, held briefly so there's a visible confirmation
  // instead of the indicator simply vanishing.
  const [visSavedCount, setVisSavedCount] = useState(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function flushVisibility() {
    if (visTimer.current) {
      clearTimeout(visTimer.current);
      visTimer.current = null;
    }
    if (pendingVis.current.size === 0) return;

    // Take the batch and clear it, so clicks during the save start a new one.
    const batch = new Map(pendingVis.current);
    pendingVis.current = new Map();
    setVisPendingCount(0);
    setVisSaving(true);
    // Clear any lingering "Saved" from a previous batch.
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setVisSavedCount(0);

    // Group by target visibility — usually one group, at most three.
    const groups = new Map<string, string[]>();
    batch.forEach((v, id) => {
      groups.set(v, [...(groups.get(v) || []), id]);
    });

    let failed = false;
    for (const [visibility, ids] of Array.from(groups.entries())) {
      try {
        const res = await queueProductWrite(() =>
          adminFetch(
            "/api/admin/products",
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids, visibility }),
            },
            {
              verify: () =>
                productsMatch((ps) =>
                  ids.every((id) => {
                    const p = ps.find((x) => x.id === id);
                    return !!p && visOf(p) === visibility;
                  })
                ),
            }
          )
        );
        if (!res.ok) { failed = true; continue; }
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.products)) {
          const byId = new Map<string, Product>(data.products.map((p: Product) => [p.id, p]));
          setProducts((prev) => prev.map((p) => byId.get(p.id) || p));
        }
      } catch {
        failed = true;
      }
    }

    setVisSaving(false);
    if (failed) {
      alert("Some visibility changes could not be saved. Refresh to see what stuck.");
      return;
    }
    // Hold a visible confirmation for a few seconds rather than letting the
    // indicator just disappear.
    setVisSavedCount(batch.size);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setVisSavedCount(0), 4000);
  }

  // One-click visibility cycle straight from a card.
  function cycleVisibility(p: Product) {
    const order = ["internal", "both", "external"] as const;
    // Use the on-screen value so repeated clicks cycle correctly while pending.
    const current = products.find((x) => x.id === p.id) || p;
    const next = order[(order.indexOf(visOf(current)) + 1) % order.length];

    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, visibility: next, retail: undefined } : x))
    );
    pendingVis.current.set(p.id, next);
    setVisPendingCount(pendingVis.current.size);

    if (visTimer.current) clearTimeout(visTimer.current);
    visTimer.current = setTimeout(() => { void flushVisibility(); }, COALESCE_MS);
  }

  // Never leave changes sitting unsaved: flush on tab switch, navigation
  // away, or when the dashboard unmounts.
  useEffect(() => {
    const flushNow = () => { void flushVisibility(); };
    const onHide = () => { if (document.visibilityState === "hidden") flushNow(); };
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", onHide);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReorderProduct(id: string, direction: "up" | "down") {
    if (pendingActions.has(id)) return;

    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= products.length) return;

    const previousProducts = products;
    const next = [...products];
    const tmp = next[idx];
    next[idx] = next[swapWith];
    next[swapWith] = tmp;

    startPending(id);
    setProducts(next);

    // Same shared file as every other product write — queue it.
    const res = await queueProductWrite(() =>
      adminFetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, direction }),
      })
    );

    endPending(id);

    if (!res.ok) {
      setProducts(previousProducts);
      alert("Could not reorder. Please try again.");
    }
  }

  async function handleUserStatus(id: string, status: "approved" | "rejected") {
    if (pendingActions.has(id)) return;
    // Guard against a second click on someone already moved off pending.
    // Re-approving is harmless now (the email only sends once) but there's
    // no reason to fire the request at all.
    const current = users.find((u) => u.id === id);
    if (current && current.status === status) return;

    startPending(id);

    const previousUsers = users;
    setUsers(
      users.map((u) =>
        u.id === id
          ? {
              ...u,
              status,
              approvedAt: status === "approved" && !u.approvedAt ? Date.now() : u.approvedAt,
            }
          : u
      )
    );

    try {
      const res = await adminFetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      endPending(id);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUsers(previousUsers);
        alert(data.error || "Could not update. Please try again.");
        return;
      }

      // Trust the saved record over our optimistic guess, so the row can't
      // flip back to pending if a later list read is briefly out of date.
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...data.user } : u)));
        // Survive a refresh during the storage lag window.
        rememberChange("user", id, {
          status: data.user.status,
          approvedAt: data.user.approvedAt,
        });
      }
      // The member IS approved — only the email failed. Say so plainly so it
      // doesn't look like the approval itself failed.
      if (data.welcomeEmailFailed) {
        alert(
          `${data.user?.name || "This member"} is approved and can sign in normally, ` +
          `but the welcome email didn't go out after three tries.\n\n` +
          `Use "Message customer" on their row to let them know they're in.`
        );
      }
    } catch {
      endPending(id);
      setUsers(previousUsers);
      alert("Network error. Please try again.");
    }
  }

  async function handleDeleteUser(id: string, email: string) {
    if (pendingActions.has(id)) return;
    // Say up front that this also affects the mailing list, so it isn't a
    // surprise afterwards.
    const onMailingList = subscribers.some(
      (s) => s.email.toLowerCase() === email.toLowerCase()
    );
    const warning = onMailingList
      ? `\n\nThey will also be removed from your mailing list.`
      : "";
    if (!confirm(`Permanently delete ${email}? This removes them completely.${warning}`)) return;
    startPending(id);

    const previousUsers = users;
    setUsers(users.filter((u) => u.id !== id));

    const res = await adminFetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    endPending(id);

    if (!res.ok) {
      setUsers(previousUsers);
      const data = await res.json().catch(() => ({}));
      alert(`Could not delete.${data.error ? `\n\n${data.error}` : " Please try again."}`);
      return;
    }

    // Keep the on-screen subscriber list in step with what the server did.
    const data = await res.json().catch(() => ({}));
    if (data.removedFromMailingList) {
      setSubscribers((prev) =>
        prev.filter((s) => s.email.toLowerCase() !== email.toLowerCase())
      );
    }
  }

  async function deleteInquiry(id: string) {
    if (!confirm("⚠️ Delete this inquiry permanently? This action cannot be undone.")) return;
    const res = await adminFetch(`/api/admin/inquiries/delete?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setAllInquiries(prev => prev.filter(i => i.id !== id));
      const newLength = allInquiries.length - 1;
      const newMaxPage = Math.ceil(newLength / INQUIRIES_PER_PAGE) - 1;
      if (inquiriesPage > newMaxPage && newMaxPage >= 0) {
        setInquiriesPage(newMaxPage);
      }
    } else {
      alert("Failed to delete.");
    }
  }

  // Imported members: email them a link to choose a password (instead of a generated one).
  const [inviteRefresh, setInviteRefresh] = useState(0);
  async function sendSetupLink(user: PublicUser) {
    if (!confirm(`Email ${user.name} a link to set their password? (Works for 30 days, once.)`)) return;
    const r = await adminFetch("/api/admin/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "one", userId: user.id }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      alert(`Sent to ${user.email}.`);
      loadUsers();
      setInviteRefresh((k) => k + 1);
    } else alert(d.error || "Couldn't send it.");
  }

  function handleResetPassword(user: PublicUser) {
    setPwResetUser(user);
    setPwResetValue(generatePassword());
    setPwResetEmailToggle(true);
    setPwResetMsg("");
  }

  function closePwReset() {
    setPwResetUser(null);
    setPwResetValue("");
    setPwResetMsg("");
  }

  function openAddMember() {
    setAmName("");
    setAmEmail("");
    setAmPassword(generatePassword());
    setAmSendEmail(true);
    setAmSubscribe(true);
    setAmMsg("");
    setAddMemberOpen(true);
  }
  async function submitAddMember(e: React.FormEvent) {
    e.preventDefault();
    const name = amName.trim();
    const email = amEmail.trim().toLowerCase();
    if (!name) { setAmMsg("Name can't be empty."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAmMsg("That doesn't look like a valid email."); return; }
    if (amPassword.length < 8) { setAmMsg("Password must be at least 8 characters."); return; }
    setAmSubmitting(true);
    setAmMsg("");
    try {
      const res = await adminFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password: amPassword, sendEmail: amSendEmail, subscribe: amSubscribe }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        setUsers((prev) => [...prev.filter((u) => u.id !== data.user.id), data.user]);
        if (data.subscribed) loadSubscribers();
        setAmMsg(
          `Saved. ${name} is a member and can sign in now.` +
          (amSendEmail
            ? data.emailSent
              ? ` Their login details were emailed to ${email}.`
              : ` The email could not be sent — share the password with them yourself: ${amPassword}`
            : ` Share the password with them yourself: ${amPassword}`)
        );
        setAmName("");
        setAmEmail("");
        setAmPassword(generatePassword());
      } else {
        setAmMsg(data.error || "Something went wrong.");
      }
    } catch {
      setAmMsg("Network error.");
    }
    setAmSubmitting(false);
  }

  // Members → "Log in as": this browser uses their account for up to an hour
  // (a bar on their pages leads back here). Logged in the Activity log.
  async function loginAs(u: PublicUser) {
    if (!confirm(`Sign in as ${u.name} (${u.email})?\n\nYou'll see the members' site exactly as they do and can place orders for them (marked as placed by staff). Ends after an hour or when you press "Back to admin". Their password isn't touched.`)) return;
    const res = await adminFetch("/api/admin/users/login-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return alert(d.error || "Couldn't sign in as them.");
    window.location.href = "/gallery";
  }

  function openEditMember(u: PublicUser) {
    setEditMember(u);
    setEmName(u.name);
    setEmEmail(u.email);
    setEmAddr(addrOf(u));
    setEmMsg("");
  }
  function closeEditMember() {
    setEditMember(null);
    setEmMsg("");
  }
  async function submitEditMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editMember) return;
    const name = emName.trim();
    const email = emEmail.trim().toLowerCase();
    if (!name) { setEmMsg("Name can't be empty."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmMsg("That doesn't look like a valid email."); return; }
    const before = addrOf(editMember);
    const addrChanged = EM_ADDR.some((k) => emAddr[k].trim() !== before[k]);
    if (name === editMember.name && email === editMember.email.toLowerCase() && !addrChanged) { setEmMsg("Nothing changed."); return; }
    setEmSubmitting(true);
    setEmMsg("");
    try {
      const res = await adminFetch("/api/admin/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editMember.id, name, email, ...(addrChanged ? { address: emAddr } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        setUsers((prev) => prev.map((u) => (u.id === data.user.id ? { ...u, ...data.user } : u)));
        // Keep the on-screen subscriber list honest if their email moved.
        if (data.subscriberMoved) loadSubscribers();
        setEmMsg(
          email !== editMember.email.toLowerCase()
            ? `Saved. They now sign in with ${email}${data.subscriberMoved ? " — mailing list updated too." : "."}`
            : "Saved."
        );
        setEditMember({ ...editMember, ...data.user });
        setEmAddr(addrOf(data.user));
      } else {
        setEmMsg(data.error || "Something went wrong.");
      }
    } catch {
      setEmMsg("Network error.");
    }
    setEmSubmitting(false);
  }

  async function submitPwReset(e: React.FormEvent) {
    e.preventDefault();
    if (!pwResetUser) return;
    if (pwResetValue.length < 8) {
      setPwResetMsg("Password must be at least 8 characters.");
      return;
    }
    setPwResetSubmitting(true);
    setPwResetMsg("");
    const res = await adminFetch("/api/admin/users/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: pwResetUser.id,
        newPassword: pwResetValue,
        sendEmail: pwResetEmailToggle,
      }),
    });
    setPwResetSubmitting(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const email = data.email || {};
      if (!pwResetEmailToggle) {
        setPwResetMsg("Password updated. Be sure to share the new password with them.");
      } else if (email.ok) {
        setPwResetMsg(`Password updated. New password emailed to ${pwResetUser.email}.`);
      } else {
        setPwResetMsg(
          `Password updated, but the email could not be sent${email.error ? ` (${email.error})` : ""}. ` +
          `Share the password with them another way: ${pwResetValue}`
        );
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setPwResetMsg(data.error || "Something went wrong.");
    }
  }

  async function handlePwChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    if (!newAdminPw) {
      setPwMsg("Enter a new password.");
      return;
    }
    const res = await adminFetch("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPassword: newAdminPw }),
    });
    if (res.ok) {
      setPwMsg("Updated. New password takes effect on next sign-in.");
      setNewAdminPw("");
    } else {
      setPwMsg("Update failed.");
    }
  }

  async function handleEmailExport() {
    setExporting(true);
    setExportMsg("");
    try {
      const res = await adminFetch("/api/admin/export-email", { method: "POST" });
      if (res.ok) {
        setExportMsg("✅ Export emailed successfully.");
        setTimeout(() => setExportMsg(""), 3000);
      } else {
        setExportMsg("❌ Failed to send export. Check server logs.");
      }
    } catch {
      setExportMsg("❌ Network error.");
    }
    setExporting(false);
  }

  // Shipping label functions
  function openShippingModal(user: PublicUser) {
    setShippingUser(user);
    setShippingProductName("");
    setShippingQuantity(1);
    setShippingWeightOz(8);
    setShippingLabelUrl("");
    setShippingError("");
    setShippingService("usps_ground_advantage"); // NEW: reset to default
  }
  function closeShippingModal() {
    setShippingUser(null);
    setShippingLabelUrl("");
  }
  async function createShippingLabel(e: React.FormEvent) {
    e.preventDefault();
    if (!shippingUser) return;
    setShippingSubmitting(true);
    setShippingError("");
    try {
      const res = await adminFetch("/api/admin/shipping-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: shippingUser.id,
          productName: shippingProductName,
          quantity: shippingQuantity,
          weightOz: shippingWeightOz,
          serviceToken: shippingService, // NEW: pass selected service
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.labelUrl) {
        setShippingLabelUrl(data.labelUrl);
        window.open(data.labelUrl, "_blank", "noopener");
      } else {
        setShippingError(
          data.error || `Failed to create label (HTTP ${res.status}). Check that the Shippo API key and SHIPPO_FROM_* variables are set in Vercel.`
        );
      }
    } catch (err) {
      console.error("Label creation failed", err);
      setShippingError("Network error while creating the label.");
    }
    setShippingSubmitting(false);
  }

  // Invoice functions
  function openInvoiceModal(user: PublicUser) {
    setInvoiceUser(user);
    setInvoiceItems(new Map());
    setInvoiceNote("");
    setInvoiceShippingOverride(null);
    setInvoiceSent(false);
    setInvoiceError("");
    setInvoicePayLink("");
    setInvoiceLinkCopied(false);
  }
  function closeInvoiceModal() {
    setInvoiceUser(null);
    setInvoiceItems(new Map());
  }
  function toggleProduct(productId: string, checked: boolean) {
    setInvoiceItems((prev) => {
      const newMap = new Map(prev);
      if (checked) newMap.set(productId, 1);
      else newMap.delete(productId);
      return newMap;
    });
  }
  function updateQuantity(productId: string, quantity: number) {
    if (quantity < 1) quantity = 1;
    setInvoiceItems((prev) => {
      const newMap = new Map(prev);
      newMap.set(productId, quantity);
      return newMap;
    });
  }
  async function sendInvoice() {
    if (!invoiceUser) return;
    const itemsArray = Array.from(invoiceItems.entries()).map(([id, quantity]) => ({ id, quantity }));
    if (itemsArray.length === 0) {
      setInvoiceError("Please select at least one product.");
      return;
    }
    setInvoiceSending(true);
    setInvoiceError("");
    try {
      const res = await adminFetch("/api/admin/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: invoiceUser.id,
          items: itemsArray,
          note: invoiceNote || undefined,
          shippingOverride: invoiceShippingOverride !== null ? invoiceShippingOverride : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setInvoicePayLink(data.payLink || "");
        setInvoiceSent(true);
        loadOrders(); // the invoice created a real order — show it in the queue
      } else {
        const data = await res.json();
        setInvoiceError(data.error || "Failed to send invoice");
      }
    } catch {
      setInvoiceError("Network error");
    }
    setInvoiceSending(false);
  }

  // Filter and pagination
  const matchesQuery = (u: PublicUser) => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  };

  const pending = users.filter((u) => u.status === "pending");
  const rejected = users.filter((u) => u.status === "rejected");
  const approved = users.filter((u) => u.status === "approved");
  const filteredPending = pending.filter(matchesQuery);
  const filteredApproved = approved.filter(matchesQuery);
  const totalMemberPages = Math.max(1, Math.ceil(filteredApproved.length / MEMBERS_PAGE_SIZE));
  const safeMemberPage = Math.min(memberPage, totalMemberPages - 1);
  const paginatedApproved = filteredApproved.slice(
    safeMemberPage * MEMBERS_PAGE_SIZE,
    (safeMemberPage + 1) * MEMBERS_PAGE_SIZE
  );

  // Orders filtering + pagination — "All" hides cancelled orders;
  // they're only visible under the Cancelled pill.
  // "Expired" = unpaid orders the automatic reminders gave up on (still pending,
  // revivable). They're kept out of the Pending pill so it stays actionable.
  const isExpired = (o: Order) => !!o.expiredAt && o.status === "pending";
  const filteredOrders = orders.filter((o) =>
    orderFilter === "all"
      ? o.status !== "cancelled"
      : orderFilter === "expired"
        ? isExpired(o)
        : normalizeStatus(o.status) === normalizeStatus(orderFilter as OrderStatus) && !(orderFilter === "pending" && isExpired(o))
  );
  const expiredCount = orders.filter(isExpired).length;
  const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
  const safeOrdersPage = Math.min(ordersPage, totalOrderPages - 1);
  const displayedOrders = filteredOrders.slice(
    safeOrdersPage * ORDERS_PER_PAGE,
    (safeOrdersPage + 1) * ORDERS_PER_PAGE
  );
  // ---- Global save status -------------------------------------------------
  // One indicator for every change made anywhere in the dashboard, so it's
  // always obvious whether something saved. Driven by adminFetch below, which
  // wraps every write the admin makes.
  type SaveState = { state: "idle" | "saving" | "syncing" | "saved" | "error"; message?: string };
  const [saveStatus, setSaveStatus] = useState<SaveState>({ state: "idle" });
  const saveHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  function showSaved(message = "Saved") {
    if (saveHideTimer.current) clearTimeout(saveHideTimer.current);
    setSaveStatus({ state: "saved", message });
    saveHideTimer.current = setTimeout(() => setSaveStatus({ state: "idle" }), 3000);
  }
  function showError(message = "Couldn't save") {
    if (saveHideTimer.current) clearTimeout(saveHideTimer.current);
    setSaveStatus({ state: "error", message });
    saveHideTimer.current = setTimeout(() => setSaveStatus({ state: "idle" }), 6000);
  }

  /**
   * Same signature as fetch(). Any non-GET request drives the status
   * indicator: "Saving…" while it runs, then "Saved" or an error. Reads pass
   * through untouched. Counting in-flight requests keeps the indicator honest
   * when several writes overlap.
   */
  async function adminFetch(
    input: string,
    init?: RequestInit,
    opts?: {
      /**
       * Don't announce "Saved" on a 2xx alone. Instead keep showing "Saving…"
       * and poll until this returns true — i.e. until the change can actually
       * be read back. A 200 means the write was accepted, not that a
       * subsequent read will see it, and claiming otherwise is worse than
       * saying nothing.
       */
      verify?: () => Promise<boolean>;
    }
  ): Promise<Response> {
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET") return fetch(input, init);

    inFlight.current += 1;
    if (saveHideTimer.current) clearTimeout(saveHideTimer.current);
    setSaveStatus({ state: "saving" });
    try {
      const res = await fetch(input, init);
      inFlight.current = Math.max(0, inFlight.current - 1);

      if (!res.ok) {
        if (inFlight.current === 0) showError();
        return res;
      }

      if (opts?.verify) {
        // Confirm in the BACKGROUND. The caller gets its response now, so
        // modals close and buttons re-enable immediately — only the corner
        // indicator waits for proof the change is readable back.
        inFlight.current += 1; // keep showing "Saving…" until confirmed
        void (async () => {
          const confirmed = await pollUntil(opts.verify!, () => {
            // Taking longer than usual — say so, but keep waiting. The write
            // has been accepted; we're only waiting to read it back.
            if (saveHideTimer.current) clearTimeout(saveHideTimer.current);
            setSaveStatus({ state: "syncing", message: "Still syncing…" });
          });
          inFlight.current = Math.max(0, inFlight.current - 1);
          if (inFlight.current === 0) {
            confirmed ? showSaved() : showError("Couldn't confirm — refresh to check");
          }
        })();
        return res;
      }

      if (inFlight.current === 0) showSaved();
      return res;
    } catch (err) {
      inFlight.current = Math.max(0, inFlight.current - 1);
      if (inFlight.current === 0) showError("No connection");
      throw err;
    }
  }

  /**
   * Keep checking until the change is readable back.
   *
   * Storage propagation is usually a second or two but occasionally runs
   * past ten. Giving up at that point was wrong: the write HAD landed, so
   * re-doing the action appeared to "fix" it when really it was just being
   * observed later. So we keep watching for a full minute — matching the
   * cache lifetime, beyond which a change genuinely should be visible —
   * and only soften the wording once it's taking a while.
   */
  async function pollUntil(
    check: () => Promise<boolean>,
    onSlow?: () => void
  ): Promise<boolean> {
    const delays = [
      350, 700, 1000, 1400, 1800, 2200, 2400, 2600, // ~12s: the common case
      3000, 3000, 3000, 4000, 4000, 5000, 5000,     // ~27s more
      6000, 6000, 7000,                             // out to ~70s
    ];
    const SLOW_AFTER = 12_000;
    let elapsed = 0;
    let warned = false;

    for (const wait of delays) {
      await new Promise((r) => setTimeout(r, wait));
      elapsed += wait;
      try {
        if (await check()) return true;
      } catch {
        /* keep trying */
      }
      if (!warned && elapsed >= SLOW_AFTER) {
        warned = true;
        onSlow?.();
      }
    }
    return false;
  }

  /** Re-read the catalog and test it. Also refreshes the on-screen list. */
  async function productsMatch(check: (ps: Product[]) => boolean): Promise<boolean> {
    const res = await fetch("/api/admin/products", { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    const list: Product[] = data.products || [];
    if (!check(list)) return false;
    setProducts(list);
    return true;
  }

  useEffect(() => () => { if (saveHideTimer.current) clearTimeout(saveHideTimer.current); }, []);

  // Orders still in flight: waiting on money, or paid and waiting to be packed.
  // Inquiries are deliberately excluded — they have no "answered" state, so
  // counting them would make the badge climb forever and stop meaning anything.
  const awaitingPaymentCount = orders.filter((o) => o.status === "pending").length;
  const readyToPackCount = orders.filter((o) => o.status === "paid").length;
  const openOrderCount = awaitingPaymentCount + readyToPackCount;
  const openOrderSummary = `${awaitingPaymentCount} awaiting payment · ${readyToPackCount} paid and ready to pack`;

  // Pagination for inquiries
  const totalInquiryPages = Math.ceil(allInquiries.length / INQUIRIES_PER_PAGE);
  const displayedInquiries = allInquiries.slice(
    inquiriesPage * INQUIRIES_PER_PAGE,
    (inquiriesPage + 1) * INQUIRIES_PER_PAGE
  );

  // ---- Assistant hand-offs -------------------------------------------------
  // The staff assistant lives in its own component; it tells the dashboard
  // (a) to reload data after a confirmed change and (b) to open a campaign
  // draft in the composer. Refs keep the listeners pointed at the latest
  // loader functions without re-subscribing on every render.
  const assistantHooks = useRef({ loadUsers, loadOrders, loadProducts, loadDiscounts, loadSettings, loadBanner, loadEvents, loadSubscribers });
  assistantHooks.current = { loadUsers, loadOrders, loadProducts, loadDiscounts, loadSettings, loadBanner, loadEvents, loadSubscribers };
  useEffect(() => {
    const onRefresh = (e: Event) => {
      const what: string[] = Array.isArray((e as CustomEvent).detail) ? (e as CustomEvent).detail : [];
      const h = assistantHooks.current;
      if (what.includes("users")) h.loadUsers().catch(() => {});
      if (what.includes("orders")) h.loadOrders().catch(() => {});
      if (what.includes("products")) h.loadProducts().catch(() => {});
      if (what.includes("discounts")) h.loadDiscounts().catch(() => {});
      if (what.includes("settings")) h.loadSettings().catch(() => {});
      if (what.includes("banner")) h.loadBanner().catch(() => {});
      if (what.includes("events")) Promise.resolve(h.loadEvents()).catch(() => {});
      if (what.includes("subscribers") || what.includes("users")) Promise.resolve(h.loadSubscribers()).catch(() => {});
    };
    const onDraft = (e: Event) => {
      const d = (e as CustomEvent<CampaignDraft>).detail;
      if (!d || typeof d.subject !== "string" || typeof d.body !== "string") return;
      setCampSubject(d.subject);
      setCampBody(d.body);
      setCampTheme(cleanThemeChoice(d.theme));
      setCampEditing(null);
      setCampTodayKey(typeof d.todayKey === "string" ? d.todayKey : "");
      if (d.audience === "custom" && typeof d.customList === "string" && d.customList) {
        setCampAudience("custom");
        setCampCustom(d.customList);
      } else {
        // Concierge audiences → the three groups.
        setCampAudience("groups");
        setCampGroups(d.audience === "all" ? ["ms", "mn", "ls"] : d.audience === "members" ? ["ms", "mn"] : d.audience === "nonmembers" ? ["ls"] : ["ms", "ls"]);
      }
      setCampMsg(
        d.audience === "custom" && d.groupLabel
          ? `Draft from the assistant for ${d.groupLabel} — the list is filled in below. Review it, send yourself a test, then send.`
          : "Draft from the assistant — review it, send yourself a test, then send."
      );
      setTab("marketing");
      setTimeout(() => document.getElementById("campaign-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      // The photo staff sent the Concierge: upload it and put it where [[PHOTO]] is.
      if (d.photo && d.body.includes(PHOTO_SLOT)) {
        const alt = typeof d.photo.alt === "string" ? d.photo.alt : "Photo";
        const fill = (line: string) => setCampBody((b) => b.split(PHOTO_SLOT).join(line).replace(/\n{3,}/g, "\n\n").trim());
        if (typeof d.photoData !== "string" || !d.photoData.startsWith("data:image/")) {
          setCampMsg("Draft from the assistant. The photo from the chat isn't in this browser any more (the page was reloaded), so use Upload photo below to add it where [[PHOTO]] is.");
        } else {
          setCampMsg("Draft from the assistant. Adding the photo from the chat…");
          dataUrlToBlob(d.photoData)
            .then((blob) => uploadCampaignImage(blob, alt))
            .then((url) => {
              fill(imageLine(url, alt, d.body));
              setCampMsg("Draft from the assistant, with the photo from the chat. Review it, send yourself a test, then send.");
            })
            .catch(() => setCampMsg("Couldn't add the photo from the chat. Use Upload photo below to add it where [[PHOTO]] is."));
        }
      }
    };
    window.addEventListener(EVT_ADMIN_REFRESH, onRefresh);
    window.addEventListener(EVT_USE_DRAFT, onDraft);
    return () => {
      window.removeEventListener(EVT_ADMIN_REFRESH, onRefresh);
      window.removeEventListener(EVT_USE_DRAFT, onDraft);
    };
  }, []);

  // Customer requests the assistant handed to the team and nobody has closed.
  const [openEscalations, setOpenEscalations] = useState(0);
  useEffect(() => {
    const load = () =>
      fetch("/api/admin/assistant/escalations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && typeof d.open === "number" && setOpenEscalations(d.open))
        .catch(() => {});
    load();
    const onChange = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === "number") setOpenEscalations(n);
      else load();
    };
    const timer = setInterval(load, 5 * 60_000);
    window.addEventListener(EVT_ESCALATIONS, onChange);
    return () => {
      clearInterval(timer);
      window.removeEventListener(EVT_ESCALATIONS, onChange);
    };
  }, []);

  const theme = useAdminTheme();

  async function tidyDescription(form: "add" | "edit") {
    const current = form === "add" ? description : editDescription;
    const payload = form === "add"
      ? { name, category, description: current, guidance: tidyGuide }
      : { name: editName, category: editCategory, description: current, guidance: tidyGuide };
    if (!current.trim()) { setTidyMsg({ form, ok: false, text: "Write a rough description first — the Concierge tidies what's there." }); return; }
    setTidying(form); setTidyMsg(null);
    try {
      const r = await fetch("/api/admin/products/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) throw new Error(d.error || "Couldn't tidy it just now.");
      setTidyUndo({ form, text: current });
      if (form === "add") setDescription(d.text); else setEditDescription(d.text);
      setTidyMsg({ form, ok: true, text: "Tidied into the house format. Read it over, edit anything you like, then Save." });
    } catch (err) {
      setTidyMsg({ form, ok: false, text: err instanceof Error ? err.message : "Couldn't tidy it just now." });
    }
    setTidying(null);
  }
  function undoTidy() {
    if (!tidyUndo) return;
    if (tidyUndo.form === "add") setDescription(tidyUndo.text); else setEditDescription(tidyUndo.text);
    setTidyUndo(null); setTidyMsg(null);
  }
  const tidyControls = (form: "add" | "edit") => (
    <>
      {/* A div, not a <label>: a button that disappears inside a label passes its click to the next button. */}
      <div className="desc-label">
        <span className="desc-label-text">Description</span>
        <span className="desc-tools">
          {tidyUndo?.form === form && <button type="button" className="ap-linkbtn esc-quiet" onClick={undoTidy}>Undo</button>}
          <button type="button" className="esc-btn tidy-btn" disabled={tidying === form} onClick={() => tidyDescription(form)} title="Rewrite this description in the house format — you still read it and press Save">
            {tidying === form ? "Tidying…" : "✦ Tidy with Concierge"}
          </button>
        </span>
      </div>
      <input
        className="tidy-guide"
        id={`tidy-guide-${form}`}
        value={tidyGuide}
        maxLength={300}
        onChange={(e) => setTidyGuide(e.target.value)}
        placeholder="Optional guidance for the Concierge, e.g. “shorter”, “mention it's vegan”, “lead with the flavour”"
        aria-label="Optional guidance for the Concierge rewrite"
      />
    </>
  );

  return (
    <div className="admin-shell">
      <AssistantWidget mode="admin" />
      <header className="admin-header">
        <a className="masthead-brand" href="/admin" aria-label="Admin dashboard home">
          <div className="logo-mark" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <h1>Manage</h1>
        </a>
        {/* One status for every change made anywhere in the dashboard. */}
        {saveStatus.state !== "idle" && (
          <div className={`save-banner save-${saveStatus.state}`} role="status" aria-live="polite">
            {saveStatus.state === "saving" && (
              <><span className="save-spinner" aria-hidden="true" /> Saving…</>
            )}
            {saveStatus.state === "syncing" && (
              <><span className="save-spinner" aria-hidden="true" /> {saveStatus.message || "Still syncing…"}</>
            )}
            {saveStatus.state === "saved" && <>✓ {saveStatus.message || "Saved"}</>}
            {saveStatus.state === "error" && <>⚠ {saveStatus.message || "Couldn't save"}</>}
          </div>
        )}
        <nav>
          <a href="/help">📖 Staff guide</a>
          <a href="/gallery" target="_blank">View site ↗</a>
          <button type="button" className="theme-switch" onClick={theme.cycle} title={theme.title} aria-label={theme.title}>
            {theme.label}
          </button>
          <button onClick={handleLogout}>Sign out</button>
        </nav>
      </header>

      {/* Tab navigation */}
      <nav className="admin-tabs" aria-label="Dashboard sections">
        {TABS.map((t) => {
          const badge =
            t.key === "orders" ? openOrderCount :
            t.key === "members" ? pending.length :
            t.key === "assistant" ? openEscalations : 0;
          // Spell out what the number means, on hover and for screen readers.
          const badgeTitle =
            t.key === "orders" ? openOrderSummary :
            t.key === "members" ? `${pending.length} waiting for approval` :
            t.key === "assistant" ? `${openEscalations} customer ${openEscalations === 1 ? "request" : "requests"} waiting for a reply` : "";
          return (
            <button
              key={t.key}
              className={`admin-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key}
              title={badge > 0 ? badgeTitle : undefined}
            >
              <span className="admin-tab-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
              {badge > 0 && (
                <span className="admin-tab-badge" aria-label={badgeTitle}>{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Overview */}
      {tab === "overview" && (
        <>
          <TodayBulletin
            onOpen={(t, filter) => {
              setTab(t as TabKey);
              if (t === "orders" && filter) {
                setOrderFilter(filter as OrderStatus);
                setOrdersPage(0);
              }
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
          <section className="admin-section">
            <h2>At a glance</h2>
            <div className="kpi-grid">
              <button className="kpi kpi-action" onClick={() => glanceGo("orders", "pending")} title="Open Orders → Awaiting payment">
                <span className="kpi-go" aria-hidden="true">→</span>
                <div className="kpi-value">{orders.filter((o) => o.status === "pending" && !isExpired(o)).length}</div>
                <div className="kpi-label">Awaiting payment</div>
                <div className="kpi-sub">
                  ${orders.filter((o) => o.status === "pending" && !isExpired(o)).reduce((n, o) => n + o.total, 0).toFixed(2)} outstanding
                  {expiredCount > 0 ? ` · ${expiredCount} expired` : ""}
                </div>
              </button>
              <button className="kpi kpi-action" onClick={() => glanceGo("orders", "paid")} title="Open Orders → Paid">
                <span className="kpi-go" aria-hidden="true">→</span>
                <div className="kpi-value">{orders.filter((o) => o.status === "paid").length}</div>
                <div className="kpi-label">Ready to fulfil</div>
                <div className="kpi-sub">paid, not yet shipped</div>
              </button>
              <button className="kpi kpi-action" onClick={() => glanceGo("members")} title="Open Members">
                <span className="kpi-go" aria-hidden="true">→</span>
                <div className="kpi-value">{pending.length}</div>
                <div className="kpi-label">Member requests</div>
                <div className="kpi-sub">{pending.length === 0 ? "all caught up" : "waiting for review"}</div>
              </button>
              <button className="kpi kpi-action" onClick={() => glanceGo("analytics")} title="Open Analytics">
                <span className="kpi-go" aria-hidden="true">→</span>
                <div className="kpi-value">
                  ${orders
                    .filter((o) => (o.status === "paid" || isCompleted(o.status)) &&
                      (o.paidAt || o.createdAt) >= lastNDaysStart(7))
                    .reduce((n, o) => n + o.total, 0)
                    .toFixed(2)}
                </div>
                <div className="kpi-label">Revenue, 7 days</div>
                <div className="kpi-sub">{approved.length} members · {products.length} products</div>
              </button>
            </div>
          </section>

          <section className="admin-section">
            <h2>Recent orders</h2>
            {orders.length === 0 ? (
              <div className="empty" style={{ padding: "2rem 0" }}>No orders yet.</div>
            ) : (
              <div className="admin-list">
                {orders.slice(0, 5).map((o) => (
                  <div key={o.id} className="user-row" style={{ cursor: "pointer" }} onClick={() => setDetailOrder(o)}>
                    <div className="user-main">
                      <div className="name" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                        <span className={`status-pill status-${o.status}`}>{STATUS_LABELS[o.status]}</span>
                        {o.userName}
                        {!o.isInquiry && <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>· ${o.total.toFixed(2)}</span>}
                      </div>
                      <div className="user-meta">{formatDateTime(o.createdAt)}</div>
                    </div>
                    <div className="user-actions">
                      <button onClick={(e) => { e.stopPropagation(); setDetailOrder(o); }}>Manage</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {orders.length > 5 && (
              <button className="link-btn" onClick={() => setTab("orders")} style={{ marginTop: "1rem" }}>
                View all {orders.length} orders →
              </button>
            )}
          </section>

          <section className="admin-section">
            <h2>Quick actions</h2>
            {(() => {
              const unpaid = orders.filter((o) => o.status === "pending" && !isExpired(o)).length;
              type QA = { icon: QaIconName; label: string; hint?: string; badge?: number; go?: () => void; href?: string };
              const groups: Array<{ title: string; items: QA[] }> = [
                {
                  title: "Orders & shop",
                  items: [
                    { icon: "orders", label: "Orders", go: () => goTo("orders") },
                    { icon: "clock", label: "Awaiting payment", badge: unpaid, go: () => goTo("orders", { filter: "pending" }) },
                    { icon: "plus", label: "Add a product", go: () => { setTab("products"); setAddOpen(true); } },
                    { icon: "box", label: "Update stock counts", go: () => goTo("products", { anchor: "stock-counts" }) },
                    { icon: "pin", label: "Add a store", go: () => goTo("settings", { settingsTile: "stores" }) },
                  ],
                },
                {
                  title: "Promote",
                  items: [
                    { icon: "megaphone", label: "Send a campaign", go: () => setTab("marketing") },
                    { icon: "tag", label: "Create a discount code", go: () => setTab("marketing") },
                    { icon: "calendar", label: "Schedule an event", go: () => setTab("events") },
                    { icon: "star", label: "Add an ambassador", go: () => goTo("ambassadors") },
                  ],
                },
                {
                  title: "Staff & reports",
                  items: [
                    { icon: "spark", label: "Ask the Concierge", go: () => window.dispatchEvent(new CustomEvent(EVT_OPEN)) },
                    { icon: "key", label: "Today\u2019s staff password", go: () => goTo("settings", { settingsTile: "password" }) },
                    { icon: "book", label: "Staff guide", go: () => { window.location.href = "/help"; } },
                    { icon: "chart", label: "Revenue report", href: "/api/admin/revenue/export" },
                    { icon: "file", label: "Orders CSV", href: "/api/admin/orders/export" },
                  ],
                },
              ];
              return (
                <div className="qa">
                  {pending.length > 0 && (
                    <button type="button" className="qa-approve" onClick={() => goTo("members")}>
                      <span className="qa-icon" aria-hidden="true"><QaIcon name="users" /></span>
                      <span className="qa-label">
                        {pending.length} member request{pending.length === 1 ? "" : "s"} waiting
                      </span>
                      <span className="qa-approve-go">Review →</span>
                    </button>
                  )}
                  <div className="qa-groups">
                    {groups.map((g) => (
                      <div key={g.title} className="qa-group">
                        <div className="qa-title">{g.title}</div>
                        <ul className="qa-list">
                          {g.items.map((it) => {
                            const inner = (
                              <>
                                <span className="qa-icon" aria-hidden="true"><QaIcon name={it.icon} /></span>
                                <span className="qa-label">{it.label}</span>
                                {it.hint && <span className="qa-hint">{it.hint}</span>}
                                {!!it.badge && <span className="qa-badge">{it.badge}</span>}
                                <span className="qa-arrow" aria-hidden="true">{it.href ? "↓" : "›"}</span>
                              </>
                            );
                            return (
                              <li key={it.label + (it.hint || "")}>
                                {it.href ? (
                                  <a className="qa-tile" href={it.href} download>{inner}</a>
                                ) : (
                                  <button type="button" className="qa-tile" onClick={it.go}>{inner}</button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>
        </>
      )}

      {/* Member requests */}
      {tab === "members" && (
      <section className="admin-section">
        <h2>
          Member requests
          {pending.length > 0 && <span className="badge">{pending.length}</span>}
        </h2>
        {pending.length === 0 ? (
          <div className="empty" style={{ padding: "2rem 0" }}>No pending requests.</div>
        ) : filteredPending.length === 0 ? (
          <div className="empty" style={{ padding: "2rem 0" }}>No pending matches for "{memberQuery}".</div>
        ) : (
          <div className="admin-list">
            {filteredPending.map((u) => (
              <div key={u.id} className="user-row pending">
                <div className="user-main">
                  <div className="name">{u.name}</div>
                  <div className="email">{u.email}</div>
                  <div className="signup-answers">
                    <span className={u.ageVerified ? "answer-yes" : "answer-no"}>
                      {u.ageVerified ? "✓ Confirmed 21 or over" : "⚠ Did not confirm 21 or over"}
                    </span>
                    <span className="answer-neutral">
                      {u.priorCustomer ? "Bought from us before" : "New customer"}
                    </span>
                  </div>
                  {u.message && <div className="user-note">"{u.message}"</div>}
                  <div className="user-meta">{formatDate(u.createdAt)}</div>
                </div>
                <div className="user-actions">
                  <button className="approve" onClick={() => handleUserStatus(u.id, "approved")} disabled={pendingActions.has(u.id)}>
                    {pendingActions.has(u.id) ? "..." : "Approve"}
                  </button>
                  <button
                    onClick={() => handleUserStatus(u.id, "rejected")}
                    disabled={pendingActions.has(u.id)}
                    title="Turn this request down. They stay listed under Rejected and can be approved later."
                  >
                    Reject
                  </button>
                  <button className="danger" onClick={() => handleDeleteUser(u.id, u.email)} disabled={pendingActions.has(u.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rejected requests — always shown, so a mis-tap can be undone */}
        {(
          <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--rule-soft)", paddingTop: "1rem" }}>
            <button
              onClick={() => setShowRejected(!showRejected)}
              style={{ background: "none", border: "none", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-soft)", cursor: "pointer", padding: 0 }}
            >
              {showRejected ? "▼" : "▶"} Rejected ({rejected.length})
            </button>
            {showRejected && rejected.length === 0 && (
              <div className="user-meta" style={{ padding: "0.75rem 0" }}>No rejected requests.</div>
            )}
            {showRejected && rejected.length > 0 && (
              <div className="admin-list" style={{ marginTop: "0.75rem" }}>
                {rejected.map((u) => (
                  <div key={u.id} className="user-row" style={{ opacity: 0.85 }}>
                    <div className="user-main">
                      <div className="name">{u.name}</div>
                      <div className="email">{u.email}</div>
                      <div className="user-meta">Requested {formatDate(u.createdAt)} · rejected</div>
                    </div>
                    <div className="user-actions">
                      <button className="approve" onClick={() => handleUserStatus(u.id, "approved")} disabled={pendingActions.has(u.id)}>
                        {pendingActions.has(u.id) ? "..." : "Approve after all"}
                      </button>
                      <button className="danger" onClick={() => handleDeleteUser(u.id, u.email)} disabled={pendingActions.has(u.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {tab === "orders" && <VenmoInbox onPaid={() => loadOrders()} />}

      {/* Orders queue */}
      {tab === "orders" && (
      <section className="admin-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>
            Orders
            {openOrderCount > 0 && (
              <span className="badge" title={openOrderSummary}>{openOrderCount}</span>
            )}
            {openOrderCount > 0 && (
              <span className="badge-note">{openOrderSummary}</span>
            )}
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={loadOrders}
              style={{ fontSize: "0.6rem", padding: "0.35rem 0.6rem", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", cursor: "pointer" }}
            >
              ↻ Refresh
            </button>
            <a className="export-btn" href="/api/admin/orders/export" download>Orders CSV</a>
            <a className="export-btn" href="/api/admin/revenue/export" download>💰 Revenue report</a>
          </div>
        </div>

        {/* Status filter pills */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {/* Expired always has its own tab, right after Pending payment. */}
          {(["all", "pending", "expired", ...ORDER_STATUSES.filter((x) => x !== "pending")] as const).map((s) => {
            const count = s === "all"
              ? orders.filter((o) => o.status !== "cancelled").length
              : s === "expired"
                ? expiredCount
                : orders.filter((o) => normalizeStatus(o.status) === normalizeStatus(s as OrderStatus) && !(s === "pending" && isExpired(o))).length;
            const active = orderFilter === s;
            return (
              <button
                key={s}
                onClick={() => { setOrderFilter(s as any); setOrdersPage(0); }}
                style={{
                  padding: "0.35rem 0.8rem",
                  borderRadius: "999px",
                  border: `1px solid ${active ? "var(--green)" : "var(--rule)"}`,
                  background: active ? "var(--green)" : "var(--white)",
                  color: active ? "var(--white)" : "var(--ink)",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {s === "all" ? "All" : s === "expired" ? "Expired" : STATUS_LABELS[s as OrderStatus]} ({count})
              </button>
            );
          })}
        </div>

        {orderFilter === "expired" && (
          <div className="expired-explainer">
            <strong>What “Expired” means:</strong> unpaid orders the automatic payment reminders have given up on — every reminder was sent and the order is past the{" "}
            {Math.round((reminderExpireHours ?? 504) / 24)}-day limit (Settings → Payment reminders). They&apos;re <em>not cancelled</em>: the customer can still pay with their link, and they stay out of the Pending payment list so it only shows orders still being chased.
            <ul>
              <li><strong>They paid after all?</strong> Open the order and mark it Paid.</li>
              <li><strong>Want to keep chasing?</strong> Open it and press <em>Revive order</em>. It goes back to Pending payment, and automatic reminders stay off for it, so you follow up by hand.</li>
              <li><strong>Not coming?</strong> Open it and change the status to Cancelled.</li>
              <li><strong>Want to move one here yourself?</strong> Open an unpaid order and press <em>Move to Expired</em>, or ask the Concierge (&ldquo;move the 3 oldest unpaid orders to Expired&rdquo;).</li>
            </ul>
            {!remindersOn && <div className="expired-note">Automatic payment reminders are switched off, so no new orders will move here until they&apos;re back on (Settings → Feature switches).</div>}
          </div>
        )}

        {filteredOrders.length === 0 ? (
          <div className="empty" style={{ padding: "2rem 0" }}>
            {orders.length === 0 ? "No orders yet — they'll appear here when customers check out." : orderFilter === "expired" ? "Nothing has expired. Unpaid orders land here once the automatic reminders give up on them." : "No orders with this status."}
          </div>
        ) : (
          <>
            <div className="admin-list">
              {displayedOrders.map((o) => (
                <div key={o.id} className="user-row" style={{ cursor: "pointer" }} onClick={() => setDetailOrder(o)}>
                  <div className="user-main">
                    <div className="name" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                      <span className={`status-pill status-${o.status}`}>{STATUS_LABELS[o.status]}</span>
                      {isExpired(o) && <span className="rem-chip expired">Expired</span>}
                      {!isExpired(o) && o.status === "pending" && (o.reminders?.length || 0) > 0 && (
                        <span className="rem-chip" title={`Last reminder ${formatDateTime(o.reminders![o.reminders!.length - 1].at)}`}>
                          Reminder {o.reminders!.length} sent
                        </span>
                      )}
                      {o.userName}
                      {!o.isInquiry && <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>· ${o.total.toFixed(2)}</span>}
                      {o.paymentMethod === "cash" && (
                        <span style={{ padding: "0.12rem 0.5rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: "var(--yellow)", color: "var(--white)" }}>
                          💵 Cash
                        </span>
                      )}
                    </div>
                    <div className="email">
                      {o.items.map((i) => `${i.productName} ×${i.quantity}${i.restocking ? " (restocking)" : ""}`).join(", ")}
                    </div>
                    <div className="user-meta">
                      {formatDateTime(o.createdAt)} · {o.shippingMethod === "pickup" ? "Local pickup" : "Ship"}
                      {o.trackingNumber ? ` · Tracking ${o.trackingNumber}` : ""}
                    </div>
                  </div>
                  <div className="user-actions">
                    <button onClick={(e) => { e.stopPropagation(); setDetailOrder(o); }}>Manage</button>
                  </div>
                </div>
              ))}
            </div>
            <Pager page={safeOrdersPage} totalPages={totalOrderPages} onChange={setOrdersPage} />
          </>
        )}
      </section>
      )}

      {/* Legacy inquiry archive — DEPRECATED, hidden from navigation.
          The data stays readable: each member's History shows their legacy
          inquiries, and the nightly report still attaches inquiries.csv.
          Removal path (see HANDOFF.md): once nobody needs History for old
          inquiries, delete this section, the /api/admin/inquiries routes and
          lib/inquiries.ts, and drop inquiries.csv from the nightly export. */}
      {SHOW_LEGACY_INQUIRY_ARCHIVE && tab === "orders" && (
      <section className="admin-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <button
            onClick={() => setShowRecentInquiries(!showRecentInquiries)}
            style={{
              background: "none",
              border: "none",
              fontSize: "0.78rem",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--green)",
              cursor: "pointer",
              padding: "0",
            }}
          >
            {showRecentInquiries ? "▼" : "▶"} Inquiry archive (legacy)
          </button>
          {showRecentInquiries && (
            <button
              onClick={() => { loadRecentInquiries(); setInquiriesPage(0); }}
              style={{
                fontSize: "0.6rem",
                padding: "0.2rem 0.6rem",
                border: "1px solid var(--rule)",
                borderRadius: "3px",
                background: "var(--white)",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              ↻ Refresh
            </button>
          )}
        </div>
        {showRecentInquiries && (
          <>
            {allInquiries.length === 0 ? (
              <div className="empty" style={{ padding: "2rem 0" }}>No inquiries yet.</div>
            ) : (
              <>
                <div className="admin-list">
                  {displayedInquiries.map((inq) => (
                    <div key={inq.id} className="user-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                        <div className="user-main">
                          <div className="name">{inq.productName}</div>
                          <div className="email">{inq.userName} · {inq.userEmail}</div>
                          <div className="user-meta">{formatDateTime(inq.createdAt)}</div>
                          {inq.message && (
                            <div className="user-note" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                              "{inq.message.slice(0, 100)}{inq.message.length > 100 ? "…" : ""}"
                            </div>
                          )}
                        </div>
                        <div className="user-actions" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                          {inq.items && inq.items.length > 0 && (
                            <details style={{ display: "inline-block", position: "relative" }}>
                              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)", fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--white)", padding: "0.4rem 0.8rem", border: "1px solid var(--rule)", borderRadius: "3px", display: "inline-block" }}>
                                📦 Show items
                              </summary>
                              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 10, background: "var(--white)", border: "1px solid var(--rule)", borderRadius: "4px", padding: "0.75rem", marginTop: "0.25rem", minWidth: "200px", boxShadow: "var(--shadow)" }}>
                                <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                                  {inq.items.map((item, idx) => (
                                    <li key={idx}>{item.productName} × {item.quantity}</li>
                                  ))}
                                </ul>
                              </div>
                            </details>
                          )}
                          <button
                            onClick={() => {
                              const user = users.find(u => u.id === inq.userId);
                              if (user) openHistory(user);
                              else {
                                openHistory({
                                  id: inq.userId,
                                  name: inq.userName,
                                  email: inq.userEmail,
                                  status: "approved",
                                  createdAt: 0,
                                } as any);
                              }
                            }}
                          >
                            View full history
                          </button>
                          <button onClick={() => deleteInquiry(inq.id)} className="danger" style={{ color: "var(--red)" }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Pager page={inquiriesPage} totalPages={totalInquiryPages} onChange={setInquiriesPage} />
              </>
            )}
          </>
        )}
      </section>
      )}

      {/* Members list */}
      {tab === "members" && (
      <section className="admin-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <button
            onClick={() => setShowMembers(!showMembers)}
            style={{
              background: "none",
              border: "none",
              fontSize: "0.78rem",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--green)",
              cursor: "pointer",
              padding: "0",
            }}
          >
            {showMembers ? "▼" : "▶"} Members ({approved.length})
          </button>
          {showMembers && (
            <div className="section-actions">
              <input
                type="search"
                className="search-input"
                placeholder="Search by name or email…"
                value={memberQuery}
                onChange={(e) => {
                  setMemberQuery(e.target.value);
                  setMemberPage(0);
                }}
              />
              <button type="button" className="export-btn" onClick={openAddMember}>+ Add member</button>
              <a className="export-btn" href="/api/admin/users/export" download>Export CSV</a>
              <label className="export-btn csv-upload">
                {memberImporting ? "Importing…" : "Import CSV"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={memberImporting}
                  onChange={(e) => importCsv(e, "members")}
                />
              </label>
              <ShopifyImportButton
                onImported={() => {
                  loadUsers();
                  loadSubscribers();
                  setInviteRefresh((k) => k + 1);
                }}
              />
            </div>
          )}
        </div>
        {showMembers && (
          <>
            <InvitePanel refreshKey={inviteRefresh} />
            {approved.length === 0 ? (
              <div className="empty" style={{ padding: "2rem 0" }}>No members yet.</div>
            ) : filteredApproved.length === 0 ? (
              <div className="empty" style={{ padding: "2rem 0" }}>No matches for "{memberQuery}".</div>
            ) : (
              <>
                <div className="admin-list">
                  {paginatedApproved.map((u) => (
                    <div key={u.id} className="user-row">
                      <div className="user-main">
                        <div className="name">
                          {u.name}
                          {u.importedFrom && <span className="mem-chip">From Shopify</span>}
                          {u.needsPassword && (
                            <span className="mem-chip warn" title={u.inviteSentAt ? `Set-password link sent ${formatDate(u.inviteSentAt)}` : "Hasn't been sent a set-password link yet"}>
                              {u.inviteSentAt ? "Invited · no password yet" : "No password yet"}
                            </span>
                          )}
                        </div>
                        <div className="email">{u.email}</div>
                        <div className="user-meta">
                          Joined {formatDate(u.approvedAt || u.createdAt)}
                          {u.shopify && (u.shopify.totalOrders || u.shopify.experience)
                            ? ` · old shop: ${u.shopify.totalOrders ? `${u.shopify.totalOrders} order${u.shopify.totalOrders === 1 ? "" : "s"}, $${(u.shopify.totalSpent || 0).toFixed(2)}` : "no orders"}${u.shopify.experience ? ` · ${u.shopify.experience}` : ""}${u.shopify.wantsConsultation ? " · wants a consultation" : ""}`
                            : ""}
                          {u.city ? ` · ${u.city}${u.state ? `, ${u.state}` : ""}` : ""}
                        </div>
                      </div>
                      <div className="user-actions">
                        {/* Everyday actions stay as buttons; the rest sit in More ▾ (same handlers). */}
                        <button onClick={() => openEditMember(u)}>Edit</button>
                        <button onClick={() => openMemberMessage(u)}>Message</button>
                        <button onClick={() => openHistory(u)}>History</button>
                        {u.needsPassword && <button onClick={() => sendSetupLink(u)}>Send set-password link</button>}
                        <RowMenu
                          items={[
                            { label: `Points${typeof (u as any).loyaltyPoints === "number" ? ` (${(u as any).loyaltyPoints})` : ""}`, onSelect: () => openLoyalty(u) },
                            { label: "Generate invoice", onSelect: () => openInvoiceModal(u) },
                            { label: "Ship to Shippo", onSelect: () => openShippingModal(u), disabled: !u.addressLine1, hint: !u.addressLine1 ? "No address on file" : undefined },
                            { label: "Log in as", onSelect: () => loginAs(u), title: "Open the members' site signed in as them, for up to an hour" },
                            { label: "Reset password", onSelect: () => handleResetPassword(u) },
                            { label: "Delete", onSelect: () => handleDeleteUser(u.id, u.email), danger: true, separated: true, disabled: pendingActions.has(u.id) },
                          ]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {totalMemberPages > 1 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "1.5rem",
                      padding: "1rem 0",
                      borderTop: "1px solid var(--rule-soft)",
                      fontSize: "0.85rem",
                      color: "var(--ink-soft)",
                      flexWrap: "wrap",
                      gap: "1rem",
                    }}
                  >
                    <span>
                      Showing {safeMemberPage * MEMBERS_PAGE_SIZE + 1}–
                      {Math.min((safeMemberPage + 1) * MEMBERS_PAGE_SIZE, filteredApproved.length)} of {filteredApproved.length}
                    </span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <button onClick={() => setMemberPage((p) => Math.max(0, p - 1))} disabled={safeMemberPage === 0} style={{ padding: "0.4rem 0.85rem", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", color: "var(--ink)", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        ← Prev
                      </button>
                      <span style={{ padding: "0 0.5rem" }}>Page {safeMemberPage + 1} of {totalMemberPages}</span>
                      <button onClick={() => setMemberPage((p) => Math.min(totalMemberPages - 1, p + 1))} disabled={safeMemberPage >= totalMemberPages - 1} style={{ padding: "0.4rem 0.85rem", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", color: "var(--ink)", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
      )}

      {/* ============ Product catalog workspace ============ */}
      {tab === "products" && (
      <section className="admin-section catalog">
        {/* Header: title, catalog stats, primary action */}
        <div className="catalog-head">
          <div>
            <h2 style={{ border: "none", margin: 0, paddingBottom: 0 }}>Catalog</h2>
            <div className="catalog-stats">
              <span><strong>{products.length}</strong> product{products.length === 1 ? "" : "s"}</span>
              <span><strong>{products.filter((p) => visOf(p) === "internal").length}</strong> members only</span>
              <span><strong>{products.filter((p) => visOf(p) !== "internal").length}</strong> public</span>
              <span><strong>{products.filter(isOnSale).length}</strong> on sale</span>
            </div>
          </div>
          <div className="catalog-head-actions">
            {(visPendingCount > 0 || visSaving || visSavedCount > 0) && (
              <span
                className={`save-state ${
                  visSaving ? "saving" : visPendingCount > 0 ? "pending" : "saved"
                }`}
                role="status"
                aria-live="polite"
              >
                {visSaving ? (
                  <>Saving…</>
                ) : visPendingCount > 0 ? (
                  <>
                    {visPendingCount} unsaved
                    <button type="button" onClick={() => void flushVisibility()}>
                      Save now
                    </button>
                  </>
                ) : (
                  <>
                    ✓ Saved {visSavedCount} change{visSavedCount === 1 ? "" : "s"}
                  </>
                )}
              </span>
            )}
            <button className="submit catalog-new" onClick={() => setAddOpen(true)}>+ New product</button>
          </div>
        </div>

        {/* Toolbar: search, filters, sort, view */}
        <div className="catalog-toolbar">
          <div className="catalog-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={prodSearch}
              onChange={(e) => setProdSearch(e.target.value)}
              placeholder="Search by name, category, or description…"
              aria-label="Search products"
            />
            {prodSearch && (
              <button type="button" onClick={() => setProdSearch("")} aria-label="Clear search">×</button>
            )}
          </div>
          <div className="catalog-toolbar-row">
            <div className="catalog-filters">
              {([
                ["all", `All ${products.length}`],
                ["internal", "Members only"],
                ["both", "Both"],
                ["external", "Public only"],
                ["sale", "On sale"],
                ["bundle", "Bundles"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`cat-pill ${prodFilter === key ? "active" : ""}`}
                  onClick={() => setProdFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="catalog-controls">
              <select value={prodSort} onChange={(e) => setProdSort(e.target.value as any)} aria-label="Sort products">
                <option value="order">Display order</option>
                <option value="name">Name A–Z</option>
                <option value="price-high">Price, high to low</option>
                <option value="price-low">Price, low to high</option>
                <option value="newest">Newest first</option>
              </select>
              <div className="seg catalog-view">
                <button type="button" className={`seg-btn ${prodView === "grid" ? "active" : ""}`} onClick={() => setProdView("grid")} title="Grid view">▦</button>
                <button type="button" className={`seg-btn ${prodView === "list" ? "active" : ""}`} onClick={() => setProdView("list")} title="List view">☰</button>
              </div>
            </div>
          </div>
        </div>

        {/* Bulk action bar — appears only with a selection */}
        {selectedProds.size > 0 && (
          <div className="catalog-bulk">
            <strong>{selectedProds.size} selected</strong>
            <span className="catalog-bulk-label">Set visibility:</span>
            <button onClick={() => bulkSetVisibility("internal")} disabled={bulkBusy}>Members only</button>
            <button onClick={() => bulkSetVisibility("both")} disabled={bulkBusy}>Both</button>
            <button onClick={() => bulkSetVisibility("external")} disabled={bulkBusy}>Public only</button>
            <button className="danger" onClick={bulkDeleteProducts} disabled={bulkBusy}>Delete</button>
            <button className="catalog-bulk-clear" onClick={() => setSelectedProds(new Set())}>Clear</button>
          </div>
        )}

        {/* Select-all + reorder hint */}
        {shownProducts.length > 0 && (
          <div className="catalog-meta">
            <label className="check-row">
              <input
                type="checkbox"
                checked={selectedProds.size > 0 && shownProducts.every((p) => selectedProds.has(p.id))}
                onChange={(e) =>
                  setSelectedProds(e.target.checked ? new Set(shownProducts.map((p) => p.id)) : new Set())
                }
              />
              <span>Select all {shownProducts.length !== products.length ? `${shownProducts.length} shown` : ""}</span>
            </label>
            {!catalogReorderable && (
              <span className="catalog-hint">Reordering is available under “Display order” with no filters.</span>
            )}
          </div>
        )}

        {/* The catalog itself */}
        {products.length === 0 ? (
          <div className="empty" style={{ padding: "3rem 0" }}>
            No products yet. Add your first one to get started.
          </div>
        ) : shownProducts.length === 0 ? (
          <div className="empty" style={{ padding: "3rem 0" }}>
            Nothing matches that search or filter.
          </div>
        ) : (
          <div className={prodView === "grid" ? "prod-grid" : "prod-rows"}>
            {shownProducts.map((p) => {
              const vis = visOf(p);
              const orderIdx = products.findIndex((x) => x.id === p.id);
              const selected = selectedProds.has(p.id);
              const busy = pendingActions.has(p.id);
              return (
                <article key={p.id} className={`prod-card ${selected ? "selected" : ""}`}>
                  <label className="prod-select" title="Select">
                    <input type="checkbox" checked={selected} onChange={() => toggleProdSelect(p.id)} />
                  </label>

                  <div className="prod-thumb" onClick={() => openEditProduct(p)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") openEditProduct(p); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt={p.name} loading="lazy" />
                    {isOnSale(p) && <span className="prod-sale-flag">Sale</span>}
                  </div>

                  <div className="prod-body">
                    <div className="prod-name" onClick={() => openEditProduct(p)}>{p.name}</div>
                    <div className="prod-chips">
                      {p.category && <span className="prod-cat">{p.category}</span>}
                      <button
                        type="button"
                        className={`vis-chip vis-${vis} vis-toggle`}
                        onClick={() => cycleVisibility(p)}
                        disabled={busy}
                        title="Click to change where this sells"
                      >
                        {vis === "internal" ? "Members" : vis === "both" ? "Members + Public" : "Public"}
                      </button>
                      {p.isBundle && <span className="vis-chip vis-bundle">Bundle</span>}
                      {!p.isBundle && stockMap && p.id in stockMap && (
                        <span className={`stock-card-chip${stockMap[p.id] <= 0 ? " is-zero" : stockMap[p.id] <= 3 ? " is-low" : ""}`} title="Products → Stock counts">
                          {stockMap[p.id] <= 0 ? "Restocking" : `${stockMap[p.id]} in stock`}
                        </span>
                      )}
                      {owedByProduct.get(p.id) && (
                        <span className="stock-card-chip is-owed" title="Ordered while at 0: send these when new stock arrives">
                          {owedByProduct.get(p.id)!.units} on backorder
                        </span>
                      )}
                    </div>
                    <div className="prod-price">
                      {p.salePrice?.trim() ? (
                        <>
                          <span className="price-was">{p.price}</span> {p.salePrice}
                        </>
                      ) : (
                        p.price
                      )}
                      {p.promo?.type === "percent" && <span className="prod-promo">{p.promo.percent}% off</span>}
                      {p.promo?.type === "bogo" && <span className="prod-promo">BOGO {p.promo.percent}%</span>}
                      {p.cashOnly && (p.salePrice?.trim() || p.promo) && <span className="prod-promo">💵 Cash pickup only</span>}
                    </div>
                  </div>

                  <div className="prod-actions">
                    {catalogReorderable && (
                      <div className="prod-move">
                        <button onClick={() => handleReorderProduct(p.id, "up")} disabled={orderIdx === 0 || busy} title="Move up">↑</button>
                        <button onClick={() => handleReorderProduct(p.id, "down")} disabled={orderIdx === products.length - 1 || busy} title="Move down">↓</button>
                      </div>
                    )}
                    <button onClick={() => openEditProduct(p)}>Edit</button>
                    <button onClick={() => duplicateProduct(p)} disabled={busy} title="Create a copy">Duplicate</button>
                    <button className="danger" onClick={() => handleDeleteProduct(p.id)} disabled={busy}>Remove</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}
      {tab === "products" && (
        <ShippingWeights products={products} onSaved={(up) => setProducts((prev) => prev.map((p) => up.find((u) => u.id === p.id) || p))} />
      )}
      {tab === "products" && <StockCounts products={products} orders={orders} />}

      {/* Classes & events */}
      {tab === "events" && (
      <section className="admin-section">
        <h2>
          Classes &amp; events
          {events.filter((e) => e.published && e.date > Date.now()).length > 0 && (
            <span className="badge">{events.filter((e) => e.published && e.date > Date.now()).length}</span>
          )}
        </h2>
        <div className="notice">
          Published events appear at <a href="/events" target="_blank">/events</a>. Set capacity to 0
          for unlimited. When an event fills, people are added to the waitlist automatically.
        </div>

        <form className="admin-form" onSubmit={createEvent}>
          <div className="field"><label>Title</label><input required value={evTitle} onChange={(e) => setEvTitle(e.target.value)} /></div>
          <div className="field"><label>Date &amp; time (local)</label><input type="datetime-local" required value={evDate} onChange={(e) => setEvDate(e.target.value)} /></div>
          <div className="field"><label>Location</label><input required value={evLocation} onChange={(e) => setEvLocation(e.target.value)} /></div>
          <div className="field"><label>Price (optional)</label><input value={evPrice} onChange={(e) => setEvPrice(e.target.value)} placeholder="$45 or Free" /></div>
          <div className="field">
            <label>Type</label>
            <select value={evType} onChange={(e) => setEvType(e.target.value)} style={{ padding: "0.7rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px", background: "var(--white)" }}>
              <option value="class">Class</option>
              <option value="workshop">Workshop</option>
              <option value="vendor">Vendor event</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field"><label>Photo (optional)</label><input value={evImage} onChange={(e) => setEvImage(e.target.value)} placeholder="Upload, or paste an image link" /><MediaUpload kind="image" value={evImage} onUploaded={setEvImage} /></div>
          <div className="field"><label>Capacity (0 = unlimited)</label><input type="number" min="0" value={evCapacity} onChange={(e) => setEvCapacity(e.target.value)} /></div>
          <div className="field"><label>Waitlist size (0 = unlimited)</label><input type="number" min="0" value={evWaitlist} onChange={(e) => setEvWaitlist(e.target.value)} /></div>
          <div className="field full"><label>Description</label><textarea rows={3} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} /></div>
          <div className="full">
            <button type="submit" className="submit" disabled={evSaving}>{evSaving ? "Creating…" : "Create event"}</button>
            {evMsg && <span style={{ marginLeft: "1rem", fontStyle: "italic", color: "var(--ink-soft)" }}>{evMsg}</span>}
          </div>
        </form>

        {events.length > 0 && (
          <div className="admin-list" style={{ marginTop: "1.5rem" }}>
            {events.map((e) => (
              <div key={e.id} className="user-row">
                <div className="user-main">
                  <div className="name" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    {e.title}
                    {!e.published && (
                      <span style={{ padding: "0.12rem 0.5rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", background: "var(--grey)", color: "var(--white)" }}>Draft</span>
                    )}
                    {e.date < Date.now() && (
                      <span style={{ padding: "0.12rem 0.5rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", background: "var(--light-grey)", color: "var(--white)" }}>Past</span>
                    )}
                  </div>
                  <div className="email">{formatDateTime(e.date)} · {e.location}</div>
                  <div className="user-meta">
                    {e.registeredCount} registered{e.capacity > 0 ? ` / ${e.capacity}` : ""}
                    {e.waitlistedCount > 0 ? ` · ${e.waitlistedCount} waitlisted` : ""}
                    {e.price ? ` · ${e.price}` : ""}
                  </div>
                </div>
                <div className="user-actions">
                  <button onClick={() => openEditEvent(e)}>Edit</button>
                  <button onClick={() => openRegistrations(e)}>
                    Registrations ({e.registeredCount + e.waitlistedCount})
                  </button>
                  <button onClick={() => toggleEventPublished(e.id, !e.published)}>
                    {e.published ? "Unpublish" : "Publish"}
                  </button>
                  <button className="danger" onClick={() => deleteEvent(e.id, e.title)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Subscribers & campaigns */}
      {tab === "marketing" && (
      <section className="admin-section" id="campaign-composer">
        <h2>
          Email campaigns
          {subActiveCount > 0 && <span className="badge">{subActiveCount}</span>}
        </h2>
        <div className="notice">
          {subActiveCount} active subscriber{subActiveCount === 1 ? "" : "s"}. Every message includes
          an unsubscribe link automatically. Send yourself a test first — basic HTML is supported.
        </div>

        <TemplateLibrary
          subject={campSubject}
          body={campBody}
          onUse={(subject, body, category) => {
            setCampSubject(subject);
            setCampBody(body);
            setCampTheme(themeForCategory(category));
          }}
        />

        {campEditing && (
          <div className="cc-editing">
            <span>✏️ Editing the scheduled campaign <strong>“{campEditing.subject}”</strong>. Changes apply when you press <strong>Save changes</strong>; it stays scheduled.</span>
            <button type="button" className="esc-btn" onClick={() => { setCampEditing(null); setCampSubject(""); setCampBody(""); setCampWhen(""); setCampTheme("auto"); setCampMsg("Stopped editing. The scheduled campaign is unchanged."); }}>Stop editing</button>
          </div>
        )}

        <div className="cc">
          <div className="cc-edit">
            <div className="field">
              <label>Subject</label>
              <input value={campSubject} onChange={(e) => setCampSubject(e.target.value)} placeholder={`New arrivals this week ${brand.emoji}`} />
            </div>

            <div className="field">
              <label>Look</label>
              <ThemePicker value={campTheme} onChange={setCampTheme} resolved={campResolved} />
              <div className="field-hint">Seasonal artwork, colours and dividers are added for you. <strong>Auto</strong> picks from your words (Halloween, holiday, Valentine&rsquo;s…) or the season of the send date.</div>
            </div>

            <div className="field">
              <div className="cc-mode" role="tablist" aria-label="Edit the message">
                <label>Message</label>
                <button type="button" role="tab" aria-selected={campMode === "write"} className={campMode === "write" ? "is-on" : ""} onClick={() => setCampMode("write")}>Write</button>
                <button type="button" role="tab" aria-selected={campMode === "arrange"} className={campMode === "arrange" ? "is-on" : ""} onClick={() => setCampMode("arrange")}>Arrange</button>
              </div>
              {campMode === "arrange" && !/<\s*(p|div|h[1-6]|ul|table|img|a|br)\b/i.test(campBody) ? (
                <BlockArranger body={campBody} onChange={setCampBody} />
              ) : (
                <>
                  {campMode === "arrange" && <div className="field-hint">This message is pasted HTML, so it can only be edited as text.</div>}
                  <textarea
                    ref={campBodyRef}
                    rows={12}
                    value={campBody}
                    onFocus={() => (campCursorSet.current = true)}
                    onChange={(e) => setCampBody(e.target.value)}
                    placeholder={`# Fresh batch just landed

We just finished a new run and wanted you to hear it first.

- [Product], back after two months
- [Product] in the larger size

[Browse the shop](${brand.siteUrl})`}
                  />
                  <MediaUpload kind="image" value="" onUploaded={insertCampImage} />
                  <div className="field-hint">
                    Just type — it&rsquo;s laid out in the newsletter design automatically.
                    Blank line for a new paragraph, <code>#</code> for a heading,{" "}
                    <code>-</code> for bullets, <code>**bold**</code>, <code>---</code> for a divider, and{" "}
                    <code>[Button text](https://…)</code> on its own line for a button.
                    <strong> Upload photo</strong> adds a picture where your cursor is. Switch to <strong>Arrange</strong> to drag photos, text and buttons into place, or set a photo&rsquo;s size.
                    Pasted HTML is used as-is. <a href="/help#tab-marketing" target="_blank">See examples in the staff guide →</a>
                  </div>
                </>
              )}
            </div>

            <div className="field">
              <label>Send to</label>
              <div className="sub-filter" style={{ margin: "0.2rem 0 0" }}>
                {([["ms", "Members subscribed"], ["mn", "Non-subscribed members"], ["ls", "Mailing list subscribed – not member"]] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={campAudience === "groups" && campGroups.includes(k) ? "active" : ""}
                    aria-pressed={campAudience === "groups" && campGroups.includes(k)}
                    onClick={() => toggleGroup(k)}
                  >
                    {campAudience === "groups" && campGroups.includes(k) ? "✓ " : ""}
                    {label} · {groupCount[k]}
                  </button>
                ))}
                <button type="button" className={campAudience === "custom" ? "active" : ""} onClick={() => setCampAudience("custom")}>
                  Paste custom email list{campAudience === "custom" ? ` · ${campRecipientCount}` : ""}
                </button>
              </div>
              {campAudience === "custom" && (
                <>
                  <textarea rows={3} value={campCustom} onChange={(e) => setCampCustom(e.target.value)} placeholder="Paste email addresses — one per line, or separated by commas" style={{ marginTop: "0.5rem" }} />
                  <div className="field-hint">Mailing-list subscribers and members get it; anyone who unsubscribed is skipped — {campRecipientCount} of the {customSet.size} you pasted.</div>
                </>
              )}
            </div>

            <div className="field">
              <label>When</label>
              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                <input type="datetime-local" value={campWhen} onChange={(e) => setCampWhen(e.target.value)} style={{ maxWidth: 240 }} />
                {campWhen && !campEditing ? (
                  <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setCampWhen("")}>Send now instead</button>
                ) : !campWhen ? (
                  <span className="field-hint" style={{ margin: 0 }}>Leave empty to send now, or pick a time (local) to schedule it.</span>
                ) : null}
              </div>
              {campWhen && <div className="field-hint">Scheduled emails go out between 9am and 6pm local; a time outside that sends at 9am.</div>}
            </div>

            <div className="cc-send">
              <button type="button" className="submit cc-test" onClick={() => sendCampaign(true)} disabled={campSending}>
                Send test to myself
              </button>
              <button type="button" className="submit" onClick={() => sendCampaign(false)} disabled={campSending || campRecipientCount === 0}>
                {campSending ? "Sending…" : campEditing ? "Save changes" : `${campWhen ? "Schedule for" : "Send to"} ${campRecipientCount} ${campRecipientCount === 1 ? "person" : "people"}`}
              </button>
              {campMsg && <span className="cc-msg">{campMsg}</span>}
            </div>
          </div>

          <LivePreview subject={campSubject} body={campBody} theme={campTheme} when={campWhen ? pacificToMs(campWhen) : undefined} onResolved={setCampResolved} />
        </div>

        <CampaignHistory
          refreshKey={campHistoryKey}
          editingId={campEditing?.id}
          onEdit={(c) => {
            setCampEditing({ id: c.id, subject: c.subject });
            setCampSubject(c.subject);
            setCampBody(c.body);
            setCampTheme(cleanThemeChoice(c.theme ?? "none"));
            if (c.audience === "custom") {
              setCampAudience("custom");
              setCampCustom((c.customEmails || []).join(", "));
            } else {
              setCampAudience("groups");
              setCampGroups(c.audience === "groups" && c.groups?.length ? (c.groups as CampGroup[]) : c.audience === "all" ? ["ms", "mn", "ls"] : c.audience === "members" ? ["ms", "mn"] : c.audience === "nonmembers" ? ["ls"] : ["ms", "ls"]);
            }
            setCampWhen(msToPacificInput(c.scheduledFor));
            setCampMsg("");
            setTimeout(() => document.getElementById("campaign-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
          }}
          onDuplicate={(subject, body) => {
            setCampSubject(subject);
            setCampBody(body);
            setCampMsg("Loaded a copy of that campaign — edit it, send yourself a test, then send or schedule.");
            setTimeout(() => document.getElementById("campaign-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
          }}
        />

        <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--rule-soft)", paddingTop: "1.15rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)" }}>
            Event sign-up QR code
          </h3>
          <div className="qr-panel">
            <div>
              <p className="field-hint" style={{ marginTop: "0.5rem" }}>
                Print this and put it on the table. People scan it, type their name and email,
                and land on the mailing list — no account, no approval. Add an event name to
                see later who signed up where.
              </p>
              <div className="field" style={{ marginTop: "0.75rem" }}>
                <label>Event name (optional)</label>
                <input value={qrEvent} onChange={(e) => setQrEvent(e.target.value)} placeholder="Farmers Market, Sept 2026" maxLength={80} />
              </div>
              <EventOfferPicker event={qrEvent} discounts={discounts} onPickEvent={setQrEvent} onOfferText={setQrOfferText} onDiscountCreated={(d) => setDiscounts((all) => [d, ...all])} />
              <div className="qr-url">{qrUrl || "…"}</div>
              <div className="qr-actions">
                <button type="button" className="export-btn" onClick={printQr} disabled={!qrUrl}>Print</button>
                <button type="button" className="export-btn" onClick={downloadQr} disabled={!qrUrl}>Download SVG</button>
                {qrUrl && <a className="export-btn" href={qrUrl} target="_blank" rel="noopener">Open the page</a>}
              </div>
            </div>
            <div className="qr-preview" aria-label="QR code preview" dangerouslySetInnerHTML={{ __html: qrMarkup }} />
          </div>
        </div>

        <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--rule-soft)", paddingTop: "1.15rem" }}>
          <button
            onClick={() => setShowSubs(!showSubs)}
            style={{ background: "none", border: "none", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--green)", cursor: "pointer", padding: 0 }}
          >
            {showSubs ? "▼" : "▶"} Manage subscribers ({subscribers.length})
          </button>
          {showSubs && (
            <>
              <form onSubmit={addSubscriberManual} style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", flexWrap: "wrap" }}>
                <input type="email" required value={newSubEmail} onChange={(e) => setNewSubEmail(e.target.value)} placeholder="email@example.com" style={{ flex: "2 1 200px" }} />
                <input value={newSubName} onChange={(e) => setNewSubName(e.target.value)} placeholder="Name (optional)" style={{ flex: "1 1 140px" }} />
                <button type="submit" className="submit" style={{ width: "auto", padding: "0.6rem 1.2rem", marginTop: 0 }}>Add</button>
              </form>

              <div className="csv-tools">
                <a className="export-btn" href="/api/admin/subscribers/export" download>Export CSV</a>
                <label className="export-btn csv-upload">
                  {subImporting ? "Importing…" : "Import CSV"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={subImporting}
                    onChange={(e) => importCsv(e, "subscribers")}
                  />
                </label>
                <span className="csv-hint">
                  Needs a column called <strong>email</strong>. A <strong>name</strong> column is used if it's there.
                </span>
              </div>
              <div className="sub-filter">
                {([["all", "All"], ["members", "Members"], ["nonmembers", "Non-members"]] as const).map(([k, label]) => (
                  <button key={k} type="button" className={subFilter === k ? "active" : ""} onClick={() => { setSubFilter(k); setSubsPage(0); }}>
                    {label} · {subscribers.filter((s) => inAudience(s, k)).length}
                  </button>
                ))}
                <button type="button" className={subFilter === "unsubscribed" ? "active" : ""} onClick={() => { setSubFilter("unsubscribed"); setSubsPage(0); }}>
                  Unsubscribed · {subscribers.filter((s) => !!s.unsubscribedAt).length}
                </button>
              </div>
              <div className="admin-list">
                {filteredSubs.length === 0 && (
                  <div className="user-meta" style={{ padding: "0.75rem 0" }}>No one in this group yet.</div>
                )}
                {pagedSubs.map((s) => (
                  <div key={s.id} className="user-row">
                    <div className="user-main">
                      <div className="name">
                        {s.name || s.email}
                        {isMemberSub(s) && <span className="sub-tag">Member</span>}
                      </div>
                      {s.name && <div className="email">{s.email}</div>}
                      <div className="user-meta">
                        {s.unsubscribedAt ? `Unsubscribed ${formatDate(s.unsubscribedAt)}` : "Active"} · via {s.source}
                        {s.event ? ` (${s.event})` : ""} · {formatDate(s.subscribedAt)}
                      </div>
                    </div>
                    <div className="user-actions">
                      <button className="danger" onClick={() => removeSubscriber(s.id, s.email)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              {filteredSubs.length > SUBS_PER_PAGE && (
                <div className="user-meta" style={{ marginTop: "0.75rem" }}>
                  Showing {safeSubsPage * SUBS_PER_PAGE + 1}–{Math.min((safeSubsPage + 1) * SUBS_PER_PAGE, filteredSubs.length)} of {filteredSubs.length}
                </div>
              )}
              <Pager page={safeSubsPage} totalPages={totalSubPages} onChange={(fn) => setSubsPage(fn(safeSubsPage))} />
            </>
          )}
        </div>
      </section>
      )}

      {/* Discount codes */}
      {tab === "marketing" && <BundlesPanel products={products} />}
      {tab === "ambassadors" && <AmbassadorsPanel products={products} />}
      {tab === "marketing" && (
      <section className="admin-section">
        <h2>
          Discount codes
          {discounts.filter((d) => codeState(d) === "live").length > 0 && (
            <span className="badge">{discounts.filter((d) => codeState(d) === "live").length}</span>
          )}
        </h2>
        <div className="notice">
          Give codes to customers or sales reps. Leave the code blank and one will be generated.
          Usage is tracked per code so you can see who's driving sales.
        </div>

        <form className="admin-form" onSubmit={createDiscount}>
          <div className="field">
            <label>Code (blank = auto-generate)</label>
            <input value={dcCode} onChange={(e) => setDcCode(e.target.value.toUpperCase())} placeholder="SPRING15" />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={dcType} onChange={(e) => setDcType(e.target.value as any)} style={{ padding: "0.7rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px", background: "var(--white)" }}>
              <option value="percentage">% off</option>
              <option value="fixed">$ off</option>
            </select>
          </div>
          <div className="field">
            <label>Value {dcType === "percentage" ? "(%)" : "($)"}</label>
            <input type="number" min="1" step="0.01" required value={dcValue} onChange={(e) => setDcValue(e.target.value)} />
          </div>
          <div className="field">
            <label>Label / rep name (optional)</label>
            <input value={dcLabel} onChange={(e) => setDcLabel(e.target.value)} placeholder="Spring sale, or Jamie's code" />
          </div>
          <div className="field">
            <label>Last day it works (optional)</label>
            <input type="date" value={dcExpires} onChange={(e) => setDcExpires(e.target.value)} />
          </div>
          <div className="field">
            <label>Max total uses</label>
            <input type="number" min="1" value={dcMaxUses} onChange={(e) => setDcMaxUses(e.target.value)} placeholder="Unlimited" />
          </div>
          <div className="field">
            <label>Uses per customer</label>
            <input type="number" min="1" value={dcPerCustomer} onChange={(e) => setDcPerCustomer(e.target.value)} placeholder="Unlimited" />
          </div>
          <div className="field">
            <label>Minimum order ($)</label>
            <input type="number" min="0" step="0.01" value={dcMinOrder} onChange={(e) => setDcMinOrder(e.target.value)} placeholder="None" />
          </div>
          <div className="field full">
            <label className="check-row"><input type="checkbox" checked={dcPublic} onChange={(e) => setDcPublic(e.target.checked)} /> <span>Also works in the public shop (public products, no account needed)</span></label>
            <div className="field-hint">Off = members only. Codes linked to an ambassador always work in the public shop too.</div>
          </div>
          <div className="full">
            <button type="submit" className="submit" disabled={dcSaving}>
              {dcSaving ? "Creating…" : "Create code"}
            </button>
            {dcMsg && <span style={{ marginLeft: "1rem", fontStyle: "italic", color: "var(--ink-soft)" }}>{dcMsg}</span>}
          </div>
        </form>

        <div style={{ marginTop: "1.5rem" }}>
          <DiscountCodeList discounts={discounts} onToggle={toggleDiscount} onTogglePublic={togglePublicShop} onDelete={deleteDiscount} formatDate={formatDate} />
        </div>
      </section>
      )}

      {tab === "analytics" && <AnalyticsDashboard />}
      {tab === "assistant" && <AssistantPanel />}
      {tab === "assistant" && <VoiceSettings />}


      {tab === "marketing" && (
      <section className="admin-section">
        <h2>Announcement banner</h2>
        <div className="notice">
          Shows at the top of every page. Add an optional countdown for sales or events — the banner
          hides itself automatically once the countdown ends.
        </div>
        <form className="admin-form" onSubmit={saveBannerForm}>
          <div className="field full">
            <label>
              <input type="checkbox" checked={bannerEnabled} onChange={(e) => setBannerEnabled(e.target.checked)} />
              {" "}Show the banner
            </label>
          </div>
          <div className="field full">
            <label>Message (basic HTML allowed)</label>
            <input value={bannerMessage} onChange={(e) => setBannerMessage(e.target.value)} placeholder={`${brand.emoji} Spring sale — 15% off`} />
          </div>
          <div className="field">
            <label>Link URL (optional)</label>
            <input value={bannerLinkUrl} onChange={(e) => setBannerLinkUrl(e.target.value)} placeholder="/gallery" />
          </div>
          <div className="field">
            <label>Link label</label>
            <input value={bannerLinkLabel} onChange={(e) => setBannerLinkLabel(e.target.value)} placeholder="Shop the sale" />
          </div>
          <div className="field">
            <label>Background colour</label>
            <input type="color" value={bannerBg} onChange={(e) => setBannerBg(e.target.value)} style={{ height: "2.6rem", padding: "0.2rem" }} />
          </div>
          <div className="field">
            <label>Text colour</label>
            <input type="color" value={bannerText} onChange={(e) => setBannerText(e.target.value)} style={{ height: "2.6rem", padding: "0.2rem" }} />
          </div>
          <div className="field">
            <label>Countdown ends (local, optional)</label>
            <input type="datetime-local" value={bannerCountdown} onChange={(e) => setBannerCountdown(e.target.value)} />
          </div>
          <div className="field">
            <label>Countdown label</label>
            <input value={bannerCountdownLabel} onChange={(e) => setBannerCountdownLabel(e.target.value)} placeholder="Ends in" />
          </div>
          <div className="full">
            {/* Live preview */}
            {bannerEnabled && bannerMessage.trim() && (
              <div style={{ background: bannerBg, color: bannerText, padding: "0.7rem 1rem", borderRadius: "6px", textAlign: "center", marginBottom: "1rem", fontSize: "0.9rem" }}>
                <span dangerouslySetInnerHTML={{ __html: bannerMessage }} />
                {bannerCountdown && <span style={{ marginLeft: "0.6rem", background: "rgba(255,255,255,0.22)", padding: "0.15rem 0.6rem", borderRadius: "999px" }}>{bannerCountdownLabel || "Ends in"} 00:00:00</span>}
                {bannerLinkUrl && <span style={{ marginLeft: "0.6rem", textDecoration: "underline", fontWeight: 700 }}>{bannerLinkLabel || "Learn more"} →</span>}
              </div>
            )}
            <button type="submit" className="submit" disabled={bannerSaving}>
              {bannerSaving ? "Saving…" : "Save banner"}
            </button>
            {bannerMsg && <span style={{ marginLeft: "1rem", fontStyle: "italic", color: "var(--ink-soft)" }}>{bannerMsg}</span>}
          </div>
        </form>
      </section>
      )}

      {tab === "settings" && (
        <SettingsTiles
          tiles={[
            { key: "rules", icon: "🏷️", title: "Sales & loyalty rules", summary: "Bundle-and-save discount and loyalty points.", render: () => (
      <section className="admin-section">
        <h2>Sales &amp; loyalty rules</h2>
        <div className="notice">
          The bundle rule applies automatically at checkout. Loyalty settings control how points are
          earned and redeemed.
        </div>
        <form className="admin-form" onSubmit={saveSettingsForm}>
          <div className="field full">
            <label>
              <input type="checkbox" checked={stBundleEnabled} onChange={(e) => setStBundleEnabled(e.target.checked)} />
              {" "}Enable “bundle &amp; save” cart discount
            </label>
          </div>
          <div className="field">
            <label>Minimum items</label>
            <input type="number" min="2" value={stBundleMin} onChange={(e) => setStBundleMin(parseInt(e.target.value) || 3)} />
          </div>
          <div className="field">
            <label>Discount (%)</label>
            <input type="number" min="1" max="90" value={stBundlePct} onChange={(e) => setStBundlePct(parseInt(e.target.value) || 10)} />
          </div>
          <div className="field full" style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "1rem" }}>
            <label>
              <input type="checkbox" checked={stLoyaltyEnabled} onChange={(e) => setStLoyaltyEnabled(e.target.checked)} />
              {" "}Enable loyalty points
            </label>
          </div>
          <div className="field">
            <label>Points earned per $1</label>
            <input type="number" min="0" step="0.1" value={stPointsPerDollar} onChange={(e) => setStPointsPerDollar(parseFloat(e.target.value) || 1)} />
          </div>
          <div className="field">
            <label>Points needed for $1 credit</label>
            <input type="number" min="1" value={stPointsPerDollarRedeemed} onChange={(e) => setStPointsPerDollarRedeemed(parseInt(e.target.value) || 100)} />
          </div>
          <div className="field">
            <label>Minimum points to redeem</label>
            <input type="number" min="0" value={stMinRedeem} onChange={(e) => setStMinRedeem(parseInt(e.target.value) || 0)} />
          </div>
          <div className="full">
            <button type="submit" className="submit" disabled={stSaving}>{stSaving ? "Saving…" : "Save rules"}</button>
            {stMsg && <span style={{ marginLeft: "1rem", fontStyle: "italic", color: "var(--ink-soft)" }}>{stMsg}</span>}
          </div>
        </form>
      </section>
            ) },
            { key: "flags", icon: "🎛️", title: "Feature switches", summary: "Turn features on or off without a redeploy.", render: () => <FlagsPanel fold={false} /> },
            { key: "reminders", icon: "⏰", title: "Payment reminders", summary: "Timing and wording of the automatic reminder emails.", badge: expiredCount, render: () => <RemindersPanel fold={false} /> },
            { key: "staff", icon: "🔑", title: "Staff sign-in", summary: "Who can sign in with an emailed link, and Face ID for their devices.", render: () => <StaffPanel /> },
            { key: "password", icon: "🔒", title: "Steward password", summary: "Today's staff password.", render: () => (
      <section className="admin-section">
        <h2>Steward password</h2>
        <div className="notice">This is your admin sign-in. Member access is managed through the sections above — there is no longer a shared site password.</div>
        <StaffPhraseCard
          fixedPassword={
            <form className="admin-form" onSubmit={handlePwChange}>
              <div className="field full"><label>New admin password</label><input type="text" placeholder="New password" value={newAdminPw} onChange={(e) => setNewAdminPw(e.target.value)} /></div>
              <div className="full"><button type="submit" className="submit">Update password</button>{pwMsg && <span style={{ marginLeft: "1rem", fontStyle: "italic", color: "var(--ink-soft)" }}>{pwMsg}</span>}</div>
            </form>
          }
        />
      </section>
            ) },
            { key: "export", icon: "📧", title: "Email data export", summary: "Send tonight's report and CSV backups now.", render: () => (
      <section className="admin-section">
        <h2>Email Data Export</h2>
        <div className="notice">Sends the nightly report: revenue figures, what needs attention, top sellers, customer trends, plus CSV backups of revenue, orders, members, products and inquiries. Runs automatically each night — use this to send one now.</div>
        <button className="submit" onClick={handleEmailExport} disabled={exporting} style={{ width: "auto", padding: "0.75rem 1.5rem" }}>{exporting ? "Sending…" : "📧 Email export now"}</button>
        {exportMsg && <div style={{ marginTop: "1rem", fontStyle: "italic", color: "var(--mint)" }}>{exportMsg}</div>}
      </section>
            ) },
            { key: "faq", icon: "❓", title: "FAQ page", summary: "Questions and answers for /faq, which the Concierge also uses.", render: () => <FaqPanel /> },
            { key: "stores", icon: "📍", title: "Store locations", summary: `Shops that carry ${brand.shortName}, for the public store map.`, render: () => <StoreLocationsPanel /> },
            { key: "activity", icon: "📜", title: "Activity log", summary: "Every change made in the dashboard, with who and what.", render: () => <ActivityLog fold={false} /> },
          ]}
        />
      )}

      {/* Inquiry History Modal */}
      {historyUser && (
        <div className="history-backdrop" onClick={closeHistory}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={closeHistory} aria-label="Close">×</button>
            <div className="history-header"><div className="history-kicker">Member History</div><h2 className="history-name">{historyUser.name}</h2><div className="history-email">{historyUser.email}</div></div>
            <div className="history-body">
              {historyLoading ? <div className="history-empty">Loading…</div> : (
                <>
                  {/* Orders & invoices */}
                  <div className="history-count" style={{ marginBottom: "0.75rem" }}>
                    {historyOrders.length} {historyOrders.length === 1 ? "order" : "orders"}
                  </div>
                  {historyOrders.length === 0 ? (
                    <div className="history-empty" style={{ padding: "1rem 0 1.5rem" }}>No orders or invoices yet.</div>
                  ) : (
                    <div className="history-list" style={{ marginBottom: "1.5rem" }}>
                      {historyOrders.map((o) => (
                        <div key={o.id} className="history-item" style={{ cursor: "pointer" }} onClick={() => { closeHistory(); setDetailOrder(o); }}>
                          <div className="history-product" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                            <span style={{ display: "inline-block", padding: "0.12rem 0.55rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--white)", background: STATUS_COLORS[o.status] }}>
                              {STATUS_LABELS[o.status]}
                            </span>
                            {o.isInquiry ? "Inquiry" : `$${o.total.toFixed(2)}`} · #{o.id.slice(-6).toUpperCase()}
                          </div>
                          <div className="history-date">{formatDateTime(o.createdAt)}</div>
                          <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)", marginTop: "0.25rem" }}>
                            {o.items.map((i) => `${i.productName} ×${i.quantity}${i.restocking ? " (restocking)" : ""}`).join(", ")}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--accent-strong)", marginTop: "0.35rem", fontWeight: 600 }}>
                            Click to manage →
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {historyInquiries.length === 0 ? null : (
                <>
                  <div className="history-count">{historyInquiries.length} legacy {historyInquiries.length === 1 ? "inquiry" : "inquiries"}</div>
                  <div className="history-list">
                    {historyInquiries.map((inq) => (
                      <div key={inq.id} className="history-item">
                        <div className="history-product">{inq.productName}</div>
                        <div className="history-date">{formatDateTime(inq.createdAt)}</div>
                        {inq.phone && <div className="history-phone">Phone: {inq.phone}</div>}
                        {inq.message && <div className="history-message">"{inq.message}"</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {pwResetUser && (
        <div className="history-backdrop" onClick={closePwReset}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={closePwReset} aria-label="Close">×</button>
            <div className="history-header"><div className="history-kicker">Reset Password</div><h2 className="history-name">{pwResetUser.name}</h2><div className="history-email">{pwResetUser.email}</div></div>
            <div className="history-body">
              <form onSubmit={submitPwReset} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div className="field">
                  <label>New password</label>
                  <input type="text" value={pwResetValue} onChange={(e) => setPwResetValue(e.target.value)} style={{ fontFamily: "Consolas, monospace" }} />
                  <button type="button" onClick={() => setPwResetValue(generatePassword())} style={{ alignSelf: "flex-start", marginTop: "0.5rem", padding: "0.4rem 0.85rem", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink)", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", cursor: "pointer" }}>🔄 Generate new</button>
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.95rem", color: "var(--ink)", cursor: "pointer", lineHeight: 1.4 }}>
                  <input type="checkbox" checked={pwResetEmailToggle} onChange={(e) => setPwResetEmailToggle(e.target.checked)} style={{ marginTop: "0.25rem" }} />
                  <span>Email this password to {pwResetUser.email}<div style={{ fontSize: "0.82rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}>Uncheck if you'd rather give the password to them yourself.</div></span>
                </label>
                <button type="submit" className="submit" disabled={pwResetSubmitting}>{pwResetSubmitting ? "Updating…" : "Update password"}</button>
                {pwResetMsg && <div style={{ padding: "0.85rem 1rem", background: pwResetMsg.includes("could not be sent") || !pwResetMsg.startsWith("Password updated") ? "rgba(200, 97, 100, 0.1)" : "rgba(15, 199, 163, 0.1)", borderLeft: `3px solid ${pwResetMsg.includes("could not be sent") || !pwResetMsg.startsWith("Password updated") ? "var(--red)" : "var(--mint)"}`, borderRadius: "0 4px 4px 0", fontSize: "0.92rem", color: "var(--ink)", lineHeight: 1.5 }}>{pwResetMsg}</div>}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add member (admin-created, approved immediately) */}
      {addMemberOpen && (
        <div className="history-backdrop" onClick={() => setAddMemberOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setAddMemberOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Add Member</div>
              <h2 className="history-name">New member</h2>
              <div className="history-email">Approved straight away — no request step</div>
            </div>
            <div className="history-body">
              <form onSubmit={submitAddMember} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div className="field">
                  <label>Name</label>
                  <input value={amName} onChange={(e) => setAmName(e.target.value)} autoComplete="off" required />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={amEmail} onChange={(e) => setAmEmail(e.target.value)} autoComplete="off" required />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input type="text" value={amPassword} onChange={(e) => setAmPassword(e.target.value)} style={{ fontFamily: "Consolas, monospace" }} autoComplete="off" />
                  <button type="button" onClick={() => setAmPassword(generatePassword())} style={{ alignSelf: "flex-start", marginTop: "0.5rem", padding: "0.4rem 0.85rem", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink)", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", cursor: "pointer" }}>🔄 Generate new</button>
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.95rem", color: "var(--ink)", cursor: "pointer", lineHeight: 1.4 }}>
                  <input type="checkbox" checked={amSendEmail} onChange={(e) => setAmSendEmail(e.target.checked)} style={{ marginTop: "0.25rem" }} />
                  <span>Email them their login details<div style={{ fontSize: "0.82rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}>Uncheck if you'd rather tell them the password yourself.</div></span>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.95rem", color: "var(--ink)", cursor: "pointer", lineHeight: 1.4 }}>
                  <input type="checkbox" checked={amSubscribe} onChange={(e) => setAmSubscribe(e.target.checked)} style={{ marginTop: "0.25rem" }} />
                  <span>Add them to the mailing list</span>
                </label>
                <button type="submit" className="submit" disabled={amSubmitting}>{amSubmitting ? "Creating…" : "Create member"}</button>
                {amMsg && (
                  <div style={{ padding: "0.85rem 1rem", background: amMsg.startsWith("Saved") ? "rgba(15, 199, 163, 0.1)" : "rgba(200, 97, 100, 0.1)", borderLeft: `3px solid ${amMsg.startsWith("Saved") ? "var(--mint)" : "var(--red)"}`, borderRadius: "0 4px 4px 0", fontSize: "0.92rem", color: "var(--ink)", lineHeight: 1.5 }}>
                    {amMsg}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit member (name / email correction) */}
      {editMember && (
        <div className="history-backdrop" onClick={closeEditMember}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={closeEditMember} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Edit Member</div>
              <h2 className="history-name">{editMember.name}</h2>
              <div className="history-email">{editMember.email}</div>
            </div>
            <div className="history-body">
              <form onSubmit={submitEditMember} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div className="field">
                  <label>Name</label>
                  <input value={emName} onChange={(e) => setEmName(e.target.value)} autoComplete="off" required />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={emEmail} onChange={(e) => setEmEmail(e.target.value)} autoComplete="off" required />
                  <div className="field-hint">
                    This is what they sign in with. Their password, points and orders stay exactly as they are.
                    If they're on the mailing list, that moves to the new address too.
                  </div>
                </div>
                <div className="field">
                  <label>Shipping address</label>
                  <input value={emAddr.addressLine1} onChange={(e) => setEmAddr({ ...emAddr, addressLine1: e.target.value })} placeholder="Street address" autoComplete="off" />
                  <input value={emAddr.addressLine2} onChange={(e) => setEmAddr({ ...emAddr, addressLine2: e.target.value })} placeholder="Apt, suite (optional)" autoComplete="off" style={{ marginTop: "0.4rem" }} />
                  <div className="em-addr-row">
                    <input value={emAddr.city} onChange={(e) => setEmAddr({ ...emAddr, city: e.target.value })} placeholder="City" autoComplete="off" />
                    <input value={emAddr.state} onChange={(e) => setEmAddr({ ...emAddr, state: e.target.value })} placeholder="State" autoComplete="off" />
                    <input value={emAddr.postalCode} onChange={(e) => setEmAddr({ ...emAddr, postalCode: e.target.value })} placeholder="ZIP" autoComplete="off" inputMode="numeric" />
                  </div>
                  <div className="field-hint">Fills in their checkout and is used for shipping labels. Changing it doesn't touch orders they've already placed.</div>
                </div>
                <div className="field">
                  <label>Phone (optional)</label>
                  <input value={emAddr.phone} onChange={(e) => setEmAddr({ ...emAddr, phone: e.target.value })} placeholder="—" autoComplete="off" inputMode="tel" />
                </div>
                <button type="submit" className="submit" disabled={emSubmitting}>{emSubmitting ? "Saving…" : "Save changes"}</button>
                {emMsg && (
                  <div style={{ padding: "0.85rem 1rem", background: emMsg.startsWith("Saved") ? "rgba(15, 199, 163, 0.1)" : "rgba(200, 97, 100, 0.1)", borderLeft: `3px solid ${emMsg.startsWith("Saved") ? "var(--mint)" : "var(--red)"}`, borderRadius: "0 4px 4px 0", fontSize: "0.92rem", color: "var(--ink)", lineHeight: 1.5 }}>
                    {emMsg}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {editEvent && (
        <div className="history-backdrop" onClick={() => setEditEvent(null)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setEditEvent(null)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Edit Event</div>
              <h2 className="history-name">{edTitle.trim() || "Untitled event"}</h2>
              <div className="history-email">
                {editEvent.registeredCount || 0} registered
                {editEvent.waitlistedCount ? ` · ${editEvent.waitlistedCount} waitlisted` : ""}
              </div>
            </div>
            <div className="history-body">
              <form onSubmit={submitEditEvent} className="prod-form">
                {edImage.trim() && (
                  <div className="prod-form-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={edImage} alt="" />
                  </div>
                )}
                <div className="field"><label>Title</label><input required value={edTitle} onChange={(e) => setEdTitle(e.target.value)} /></div>
                <div className="prod-form-two">
                  <div className="field"><label>Date &amp; time (local)</label><input type="datetime-local" required value={edDate} onChange={(e) => setEdDate(e.target.value)} /></div>
                  <div className="field"><label>Price</label><input value={edPrice} onChange={(e) => setEdPrice(e.target.value)} placeholder="$45 or Free" /></div>
                </div>
                <div className="field"><label>Location</label><input required value={edLocation} onChange={(e) => setEdLocation(e.target.value)} /></div>
                <div className="field">
                  <label>Type</label>
                  <select value={edType} onChange={(e) => setEdType(e.target.value)}>
                    <option value="class">Class</option>
                    <option value="workshop">Workshop</option>
                    <option value="vendor">Vendor event</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field"><label>Photo</label><input value={edImage} onChange={(e) => setEdImage(e.target.value)} placeholder="Upload, or paste an image link" /><MediaUpload kind="image" value={edImage} onUploaded={setEdImage} /></div>
                <div className="prod-form-two">
                  <div className="field"><label>Capacity (0 = unlimited)</label><input type="number" min="0" value={edCapacity} onChange={(e) => setEdCapacity(e.target.value)} /></div>
                  <div className="field"><label>Waitlist size (0 = unlimited)</label><input type="number" min="0" value={edWaitlist} onChange={(e) => setEdWaitlist(e.target.value)} /></div>
                </div>
                {editEvent.registeredCount > 0 &&
                  parseInt(edCapacity) > 0 &&
                  parseInt(edCapacity) < editEvent.registeredCount && (
                    <div className="callout-warn">
                      ⚠ {editEvent.registeredCount} people are already registered. Lowering
                      capacity below that won't remove anyone, but no new spots will open.
                    </div>
                  )}
                <div className="field"><label>Description</label><textarea rows={4} value={edDesc} onChange={(e) => setEdDesc(e.target.value)} /></div>
                <div className="field">
                  <label className="check-row">
                    <input type="checkbox" checked={edPublished} onChange={(e) => setEdPublished(e.target.checked)} />
                    <span>Published (visible at /events)</span>
                  </label>
                  <div className="field-hint">
                    {edPublished
                      ? "Anyone can see this event and register."
                      : "Hidden from the public page. Registrations already taken are kept."}
                  </div>
                </div>
                <button type="submit" className="submit" disabled={edSaving}>
                  {edSaving ? "Saving…" : "Save changes"}
                </button>
                {edMsg && <div className="field-hint" style={{ textAlign: "center", color: "var(--danger-strong)" }}>{edMsg}</div>}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {addOpen && (
        <div className="history-backdrop" onClick={() => setAddOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setAddOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">New Product</div>
              <h2 className="history-name">{name.trim() || "Untitled product"}</h2>
            </div>
            <div className="history-body">
              <form
                onSubmit={async (e) => {
                  await handleAdd(e);
                  setAddOpen(false);
                }}
                className="prod-form"
              >
                <div className="prod-form-preview">
                  {image.trim() ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={image} alt="" />
                  ) : (
                    <div className="prod-form-placeholder">Image preview</div>
                  )}
                </div>
                <div className="field"><label>Name</label><input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
                <div className="field"><label>Photo</label><input required placeholder="Upload, or paste an image link" value={image} onChange={(e) => setImage(e.target.value)} /><MediaUpload kind="image" value={image} onUploaded={setImage} /></div>
                <div className="field"><label>Video (optional)</label><input placeholder="Upload an MP4, or paste a YouTube / Vimeo link" value={video} onChange={(e) => setVideo(e.target.value)} /><MediaUpload kind="video" value={video} onUploaded={setVideo} /></div>
                <div className="field"><label>Shipping weight (oz, optional)</label><input type="number" inputMode="decimal" min="0" step="0.1" placeholder="One packed unit, e.g. 4.5" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} /></div>
                <div className="prod-form-two">
                  <div className="field"><label>Price</label><input required placeholder="$120  or  Inquire" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                  <div className="field"><label>Sale price</label><input placeholder="Optional" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
                </div>
                <div className="field"><label>Category</label><input placeholder="Functionals / Bundles / etc." value={category} onChange={(e) => setCategory(e.target.value)} /></div>
                <div className="field">
                  <label>Promotion</label>
                  <div className="prod-promo-row">
                    <select value={promoType} onChange={(e) => setPromoType(e.target.value as any)}>
                      <option value="none">No promotion</option>
                      <option value="percent">% off price</option>
                      <option value="bogo">Buy one, get one % off</option>
                    </select>
                    {promoType !== "none" && (
                      <input type="number" min={1} max={99} value={promoPercent} onChange={(e) => setPromoPercent(parseInt(e.target.value) || 10)} aria-label="Percent" />
                    )}
                    {promoType !== "none" && <span>%</span>}
                  </div>
                  {cashPickupOn && (salePrice.trim() || promoType !== "none") && (
                    <label className="cash-only-tick">
                      <input type="checkbox" checked={cashOnly} onChange={(e) => setCashOnly(e.target.checked)} />
                      <span>💵 Cash pickup only <small>The sale applies only to Local pickup paid in cash; shipped and invoiced orders pay the regular price.</small></span>
                    </label>
                  )}
                </div>
                <div className="field">
                  <label>Where it sells</label>
                  <div className="seg">
                    {(["internal", "both", "external"] as const).map((v) => (
                      <button key={v} type="button" className={`seg-btn ${visibility === v ? "active" : ""}`} onClick={() => setVisibility(v)}>
                        {v === "internal" ? "Members only" : v === "both" ? "Both" : "Public shop only"}
                      </button>
                    ))}
                  </div>
                  <div className="field-hint">
                    {visibility === "internal"
                      ? "Shown in the member gallery. Not visible to the public."
                      : visibility === "both"
                      ? "Shown in the member gallery and the public shop at /retail."
                      : "Shown only in the public shop at /retail. Members won't see it."}
                  </div>
                </div>
                <div className="field">
                  <label className="check-row">
                    <input type="checkbox" checked={isBundleProd} onChange={(e) => setIsBundleProd(e.target.checked)} />
                    <span>This is a bundle</span>
                  </label>
                </div>
                <div className="field">{tidyControls("add")}<textarea required rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />{tidyMsg?.form === "add" && <div className={tidyMsg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.4rem" }}>{tidyMsg.text}</div>}</div>
                <button type="submit" className="submit" disabled={adding}>{adding ? "Adding…" : "Add product"}</button>
                {addMsg && <div className="field-hint" style={{ textAlign: "center" }}>{addMsg}</div>}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editProduct && (
        <div className="history-backdrop" onClick={closeEditProduct}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={closeEditProduct} aria-label="Close">×</button>
            <div className="history-header"><div className="history-kicker">Edit Product</div><h2 className="history-name">{editProduct.name}</h2></div>
            <div className="history-body">
              <form onSubmit={submitEditProduct} className="prod-form">
                <div className="prod-form-preview">
                  {editImage.trim() ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={editImage} alt="" />
                  ) : (
                    <div className="prod-form-placeholder">Image preview</div>
                  )}
                </div>
                <div className="field"><label>Name</label><input required value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                <div className="field"><label>Price</label><input required placeholder="$1,200  or  Inquire" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} /></div>
                <div className="field"><label>Sale price (optional)</label><input placeholder="Leave empty for no discount" value={editSalePrice} onChange={(e) => setEditSalePrice(e.target.value)} /></div>
                <div className="field">
                  <label>Promotion (optional)</label>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <select value={editPromoType} onChange={(e) => setEditPromoType(e.target.value as any)} style={{ flex: 1, padding: "0.7rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px", background: "var(--white)" }}>
                      <option value="none">No promotion</option>
                      <option value="percent">% off price</option>
                      <option value="bogo">Buy one, get one % off</option>
                    </select>
                    {editPromoType !== "none" && (
                      <input type="number" min={1} max={99} value={editPromoPercent} onChange={(e) => setEditPromoPercent(parseInt(e.target.value) || 10)} style={{ width: "80px" }} aria-label="Percent" />
                    )}
                    {editPromoType !== "none" && <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>%</span>}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginTop: "0.3rem" }}>
                    "% off" discounts the price directly. BOGO discounts every 2nd item in the cart.
                  </div>
                  {(cashPickupOn || editCashOnly) && (editSalePrice.trim() || editPromoType !== "none") && (
                    <label className="cash-only-tick">
                      <input type="checkbox" checked={editCashOnly} onChange={(e) => setEditCashOnly(e.target.checked)} />
                      <span>💵 Cash pickup only <small>The sale price and promotion apply only to Local pickup paid in cash; shipped and invoiced orders pay the regular price.</small></span>
                    </label>
                  )}
                </div>
                <div className="field"><label>Category (optional)</label><input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} /></div>
                <div className="field"><label>Photo</label><input required placeholder="Upload, or paste an image link" value={editImage} onChange={(e) => setEditImage(e.target.value)} /><MediaUpload kind="image" value={editImage} onUploaded={setEditImage} /></div>
                <div className="field"><label>Video (optional)</label><input placeholder="Upload an MP4, or paste a YouTube / Vimeo link" value={editVideo} onChange={(e) => setEditVideo(e.target.value)} /><MediaUpload kind="video" value={editVideo} onUploaded={setEditVideo} /></div>
                <div className="field"><label>Shipping weight (oz)</label><input type="number" inputMode="decimal" min="0" step="0.1" placeholder="One packed unit, e.g. 4.5" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} /><div className="field-hint">Used to work out shipping label weights automatically.</div></div>
                {editIsBundleProd ? (
                  <div className="field"><label>In stock</label><div className="field-hint">A bundle uses the stock counts of the products in it.</div></div>
                ) : (
                  <div className="field">
                    <label>In stock</label>
                    <input type="number" inputMode="numeric" min="0" step="1" placeholder={editStock === null ? "Loading…" : "Not counted"} disabled={editStock === null} value={editStock ?? ""} onChange={(e) => setEditStock(e.target.value)} />
                    {editProduct && owedByProduct.get(editProduct.id) && (
                      <div className="stock-edit-owed">
                        <strong>{owedByProduct.get(editProduct.id)!.units} on backorder</strong> from {owedByProduct.get(editProduct.id)!.orders} open order{owedByProduct.get(editProduct.id)!.orders === 1 ? "" : "s"}. When new stock arrives, send those first and count the rest here.
                      </div>
                    )}
                    <div className="field-hint">
                      {editStock !== null && editStock.trim() !== "" && Number(editStock) <= 0
                        ? "At 0 the shop shows “Currently restocking” and people can still order."
                        : "How many are ready to send. Leave blank to not count it."}
                    </div>
                  </div>
                )}
                {editProduct && <ProductQr id={editProduct.id} name={editProduct.name} />}
                <div className="field">
                  <label>Where it sells</label>
                  <div className="seg">
                    {(["internal", "both", "external"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`seg-btn ${editVisibility === v ? "active" : ""}`}
                        onClick={() => setEditVisibility(v)}
                      >
                        {v === "internal" ? "Members" : v === "both" ? "Both" : "Public"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="check-row">
                    <input type="checkbox" checked={editIsBundleProd} onChange={(e) => setEditIsBundleProd(e.target.checked)} />
                    <span>This is a bundle</span>
                  </label>
                </div>
                <div className="field">{tidyControls("edit")}<textarea required rows={6} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />{tidyMsg?.form === "edit" && <div className={tidyMsg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.4rem" }}>{tidyMsg.text}</div>}</div>
                <button type="submit" className="submit" disabled={editSubmitting}>{editSubmitting ? "Saving…" : "Save changes"}</button>
                {editMsg && <div style={{ padding: "0.85rem 1rem", background: "rgba(200, 97, 100, 0.1)", borderLeft: "3px solid var(--red)", borderRadius: "0 4px 4px 0", fontSize: "0.92rem", color: "var(--ink)", lineHeight: 1.5 }}>{editMsg}</div>}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Shipping Label Modal */}
      {shippingUser && (
        <div className="history-backdrop" onClick={closeShippingModal}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={closeShippingModal} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Create Shipping Label</div>
              <h2 className="history-name">{shippingUser.name}</h2>
              <div className="history-email">{shippingUser.email}</div>
            </div>
            <div className="history-body">
              {shippingLabelUrl ? (
                <div style={{ textAlign: "center" }}>
                  <p>Label created!</p>
                  <a href={shippingLabelUrl} target="_blank" rel="noopener noreferrer" className="submit" style={{ textDecoration: "none" }}>Download Label</a>
                  <button onClick={closeShippingModal} className="submit" style={{ marginLeft: "0.5rem", background: "var(--grey)" }}>Close</button>
                </div>
              ) : (
                <form onSubmit={createShippingLabel} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div className="field">
                    <label>Product name</label>
                    <input required value={shippingProductName} onChange={(e) => setShippingProductName(e.target.value)} placeholder="e.g., Reishi Tincture" />
                  </div>
                  <div className="field">
                    <label>Quantity</label>
                    <input type="number" min="1" value={shippingQuantity} onChange={(e) => setShippingQuantity(parseInt(e.target.value))} required />
                  </div>
                  <div className="field">
                    <label>Weight (oz)</label>
                    <input type="number" step="0.5" value={shippingWeightOz} onChange={(e) => setShippingWeightOz(parseFloat(e.target.value))} required />
                  </div>
                  {/* NEW: Shipping service dropdown */}
                  <div className="field">
                    <label>Shipping service</label>
                    <select
                      value={shippingService}
                      onChange={(e) => setShippingService(e.target.value)}
                      style={{
                        padding: "0.7rem 0.9rem",
                        border: "1px solid var(--rule-soft)",
                        borderRadius: "3px",
                        background: "var(--white)",
                        fontSize: "1rem",
                      }}
                    >
                      <option value="usps_ground_advantage">USPS Ground Advantage</option>
                      <option value="usps_priority">USPS Priority Mail</option>
                      <option value="usps_priority_express">USPS Priority Express</option>
                    </select>
                    <div style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginTop: "0.3rem" }}>
                      Choose the shipping service for this label.
                    </div>
                  </div>
                  <div className="notice" style={{ fontSize: "0.85rem" }}>
                    Shipping address: {[shippingUser.addressLine1, shippingUser.addressLine2, shippingUser.city, shippingUser.state, shippingUser.postalCode].filter(Boolean).join(", ")}
                  </div>
                  <button type="submit" className="submit" disabled={shippingSubmitting}>
                    {shippingSubmitting ? "Creating…" : "Generate label"}
                  </button>
                  {shippingError && <div className="gate-error">{shippingError}</div>}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Event registrations modal */}
      {regEvent && (
        <div className="history-backdrop" onClick={() => setRegEvent(null)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "760px" }}>
            <button className="history-close" onClick={() => setRegEvent(null)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Registrations</div>
              <h2 className="history-name">{regEvent.title}</h2>
              <div className="history-email">{formatDateTime(regEvent.date)} · {regEvent.location}</div>
            </div>
            <div className="history-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
                <div className="history-count">
                  {regs.filter((r) => r.status === "registered").length} registered ·{" "}
                  {regs.filter((r) => r.status === "waitlisted").length} waitlisted
                </div>
                {regs.length > 0 && (
                  <button className="export-btn" onClick={exportRegistrations}>Export CSV</button>
                )}
              </div>

              {regs.length === 0 ? (
                <div className="history-empty">No registrations yet.</div>
              ) : (
                <div className="admin-list">
                  {regs
                    .slice(regsPage * REGS_PER_PAGE, (regsPage + 1) * REGS_PER_PAGE)
                    .map((r) => (
                    <div key={r.id} className="user-row">
                      <div className="user-main">
                        <div className="name" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                          {r.name}
                          <span style={{ padding: "0.12rem 0.5rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", color: "var(--white)", background: r.status === "registered" ? "var(--green)" : r.status === "waitlisted" ? "var(--yellow)" : "var(--red)" }}>
                            {r.status}
                          </span>
                        </div>
                        <div className="email">{r.email}{r.phone ? ` · ${r.phone}` : ""}</div>
                        {r.notes && <div className="user-note" style={{ fontSize: "0.85rem" }}>"{r.notes}"</div>}
                        <div className="user-meta">{formatDateTime(r.createdAt)}</div>
                      </div>
                      <div className="user-actions">
                        {r.status === "waitlisted" && (
                          <button className="approve" onClick={() => registrationAction(r.id, "promote")}>
                            Move to registered
                          </button>
                        )}
                        {r.status !== "cancelled" && (
                          <button className="danger" onClick={() => registrationAction(r.id, "cancel")}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {regs.length > REGS_PER_PAGE && (
                <div className="reg-pager">
                  <button
                    onClick={() => setRegsPage((n) => Math.max(0, n - 1))}
                    disabled={regsPage === 0}
                  >
                    ← Previous
                  </button>
                  <span>
                    {regsPage * REGS_PER_PAGE + 1}–
                    {Math.min((regsPage + 1) * REGS_PER_PAGE, regs.length)} of {regs.length}
                  </span>
                  <button
                    onClick={() =>
                      setRegsPage((n) =>
                        Math.min(Math.ceil(regs.length / REGS_PER_PAGE) - 1, n + 1)
                      )
                    }
                    disabled={(regsPage + 1) * REGS_PER_PAGE >= regs.length}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loyalty points modal */}
      {loyaltyUser && (
        <div className="history-backdrop" onClick={() => setLoyaltyUser(null)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setLoyaltyUser(null)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Loyalty Points</div>
              <h2 className="history-name">{loyaltyUser.name}</h2>
              <div className="history-email">{loyaltyUser.email}</div>
            </div>
            <div className="history-body">
              <div className="points-hero" style={{ marginBottom: "1.5rem" }}>
                <div className="points-value">{(loyaltyUser as any).loyaltyPoints || 0}</div>
                <div className="points-label">points</div>
              </div>

              <div className="field" style={{ marginBottom: "0.75rem" }}>
                <label>Adjust points (negative to deduct)</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="number" value={lyAmount} onChange={(e) => setLyAmount(e.target.value)} placeholder="e.g. 100 or -50" style={{ width: "150px" }} />
                  <input value={lyReason} onChange={(e) => setLyReason(e.target.value)} placeholder="Reason (optional)" style={{ flex: 1 }} />
                  <button className="submit" onClick={adjustMemberPoints} disabled={lyBusy || !lyAmount} style={{ width: "auto", padding: "0.6rem 1.1rem" }}>
                    Apply
                  </button>
                </div>
              </div>


              {lyMsg && <div style={{ marginTop: "1rem", fontSize: "0.9rem" }}>{lyMsg}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Member Message Modal */}
      {msgUser && (
        <div className="history-backdrop" onClick={() => setMsgUser(null)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setMsgUser(null)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Message Member</div>
              <h2 className="history-name">{msgUser.name}</h2>
              <div className="history-email">{msgUser.email}</div>
            </div>
            <div className="history-body">
              <div className="field" style={{ marginBottom: "1rem" }}>
                <label>Subject (optional)</label>
                <input
                  type="text"
                  value={msgSubject}
                  onChange={(e) => setMsgSubject(e.target.value)}
                  placeholder={`A message from ${brand.members}`}
                />
              </div>
              <div className="field" style={{ marginBottom: "1rem" }}>
                <label>Message</label>
                <textarea
                  rows={5}
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  placeholder={`Write to ${msgUser.name.split(" ")[0]}…`}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button className="submit" onClick={sendMemberMessage} disabled={msgSending || !msgText.trim()} style={{ width: "auto", padding: "0.65rem 1.3rem" }}>
                  {msgSending ? "Sending…" : "Send email"}
                </button>
                {msgStatus && <span style={{ fontSize: "0.88rem" }}>{msgStatus}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          products={products}
          onClose={() => setDetailOrder(null)}
          onStatusChange={changeOrderStatus}
          onRefreshed={(o) => {
            setOrders((prev) => prev.map((x) => (x.id === o.id ? o : x)));
            setDetailOrder(o);
          }}
        />
      )}

      {/* Invoice Modal */}
      {invoiceUser && (
        <div className="history-backdrop" onClick={closeInvoiceModal}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "800px" }}>
            <button className="history-close" onClick={closeInvoiceModal} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Generate Invoice</div>
              <h2 className="history-name">{invoiceUser.name}</h2>
              <div className="history-email">{invoiceUser.email}</div>
            </div>
            <div className="history-body">
              {invoiceSent ? (
                <div>
                  <div className="success">Invoice sent successfully!</div>
                  <div className="notice" style={{ fontSize: "0.88rem", marginTop: "1rem" }}>
                    This created a <strong>pending order</strong> in the Orders queue. The email
                    includes payment instructions and the "I've sent my payment"
                    confirmation button.
                  </div>
                  {invoicePayLink && (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
                      <input type="text" readOnly value={invoicePayLink} style={{ flex: 1, fontSize: "0.8rem", padding: "0.5rem" }} onFocus={(e) => e.target.select()} />
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(invoicePayLink).then(() => {
                            setInvoiceLinkCopied(true);
                            setTimeout(() => setInvoiceLinkCopied(false), 2000);
                          });
                        }}
                        style={{ padding: "0.5rem 0.9rem", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", whiteSpace: "nowrap" }}
                      >
                        {invoiceLinkCopied ? "✓ Copied" : "Copy pay link"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: "1.5rem" }}>
                    <label style={{ fontWeight: 700, display: "block", marginBottom: "0.5rem" }}>Products</label>
                    <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid var(--rule)", borderRadius: "4px", padding: "0.5rem" }}>
                      {products.map((product) => {
                        const quantity = invoiceItems.get(product.id) || 0;
                        const isSelected = quantity > 0;
                        return (
                          <div key={product.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0", borderBottom: "1px solid var(--rule-soft)" }}>
                            <input type="checkbox" checked={isSelected} onChange={(e) => toggleProduct(product.id, e.target.checked)} />
                            <div style={{ flex: 2 }}>{product.name}</div>
                            <div style={{ flex: 1 }}>{product.price}</div>
                            {isSelected && (
                              <input type="number" min="1" value={quantity} onChange={(e) => updateQuantity(product.id, parseInt(e.target.value) || 1)} style={{ width: "70px", padding: "0.3rem" }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: "1rem" }}>
                    <label>Note (optional)</label>
                    <textarea rows={2} value={invoiceNote} onChange={(e) => setInvoiceNote(e.target.value)} placeholder="e.g., Free shipping this time, or special instructions..." />
                  </div>
                  <div className="field" style={{ marginBottom: "1.5rem" }}>
                    <label>Shipping / cost adjustment (optional)</label>
                    <input type="number" step="0.01" value={invoiceShippingOverride === null ? "" : invoiceShippingOverride} onChange={(e) => setInvoiceShippingOverride(e.target.value ? parseFloat(e.target.value) : null)} placeholder="Leave empty for $10 flat shipping" />
                    <div style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginTop: "0.3rem" }}>Use positive numbers to add cost, negative numbers (e.g., -10) for discounts. Leave empty for standard $10 shipping.</div>
                  </div>
                  {invoiceError && <div className="gate-error">{invoiceError}</div>}
                  <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                    <button className="submit" onClick={sendInvoice} disabled={invoiceSending}>{invoiceSending ? "Sending…" : "Send invoice"}</button>
                    <button onClick={closeInvoiceModal} style={{ background: "var(--grey)" }} className="submit">Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Pager — shared pagination control for admin lists
// ============================================================
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (updater: (p: number) => number) => void;
}) {
  if (totalPages <= 1) return null;
  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: "0.4rem 0.85rem",
    border: "1px solid var(--rule)",
    borderRadius: "6px",
    background: "var(--white)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    fontSize: "0.78rem",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  });
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--rule-soft)" }}>
      <button onClick={() => onChange((p) => Math.max(0, p - 1))} disabled={page === 0} style={btn(page === 0)}>
        ← Prev
      </button>
      <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>Page {page + 1} of {totalPages}</span>
      <button onClick={() => onChange((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={btn(page >= totalPages - 1)}>
        Next →
      </button>
    </div>
  );
}

// ============================================================
// OrderDetailModal — manage a single order
// ============================================================
function OrderDetailModal({
  order,
  products,
  onClose,
  onStatusChange,
  onRefreshed,
}: {
  order: Order;
  products: Product[];
  onClose: () => void;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onRefreshed: (o: Order) => void;
}) {
  // Shipping label state
  const [weightOz, setWeightOz] = useState(8);
  // The label's weight, worked out from Products → Shipping weights (+ box).
  const [packagingOz, setPackagingOz] = useState(DEFAULT_PACKAGING_OZ);
  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPackagingOz(packagingOzOf(d?.settings?.packagingOz)))
      .catch(() => {});
  }, []);
  const calcWeight = useMemo(() => orderWeight(order.items || [], products, packagingOz), [order.items, products, packagingOz]);
  const [weightTouched, setWeightTouched] = useState(false);
  useEffect(() => {
    if (!weightTouched && calcWeight.oz !== null) setWeightOz(calcWeight.oz);
  }, [calcWeight.oz, weightTouched]);
  const [service, setService] = useState("usps_ground_advantage");
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [labelError, setLabelError] = useState("");

  // Message state
  const [message, setMessage] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageStatus, setMessageStatus] = useState("");

  const [copied, setCopied] = useState(false);

  const payLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/pay/${order.paymentToken}`
      : `/pay/${order.paymentToken}`;

  const address = order.shippingAddress;

  async function createLabel(e: React.FormEvent, force = false) {
    e.preventDefault();
    if (labelSubmitting) return; // no double clicks
    setLabelSubmitting(true);
    setLabelError("");
    try {
      const res = await fetch("/api/admin/orders/shipping-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, weightOz, serviceToken: service, force }),
      });
      const data = await res.json().catch(() => ({} as any));
      // Already has a label: only buy another if they really mean it.
      if (res.status === 409 && data.alreadyHasLabel) {
        setLabelSubmitting(false);
        if (confirm(`${data.error}\n\nBuy ANOTHER label anyway?`)) return createLabel(e, true);
        if (data.labelUrl) window.open(data.labelUrl, "_blank", "noopener");
        return;
      }
      if (res.ok && data.labelUrl) {
        onRefreshed({
          ...order,
          labelUrl: data.labelUrl,
          trackingNumber: data.trackingNumber || undefined,
          shippoTransactionId: data.transactionId,
          shippedService: data.selectedService,
        });
        // Pop the label open right away
        window.open(data.labelUrl, "_blank", "noopener");
      } else {
        setLabelError(
          data.error || `Failed to create label (HTTP ${res.status}). Check that the Shippo API key and SHIPPO_FROM_* variables are set in Vercel.`
        );
      }
    } catch (err) {
      console.error("Label creation failed", err);
      setLabelError("Network error while creating the label. Check your connection and try again.");
    }
    setLabelSubmitting(false);
  }

  async function sendMessage() {
    if (!message.trim()) return;
    setMessageSending(true);
    setMessageStatus("");
    try {
      const res = await fetch("/api/admin/orders/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, message }),
      });
      if (res.ok) {
        setMessageStatus(`✅ Sent to ${order.userEmail}.`);
        setMessage("");
      } else {
        const data = await res.json().catch(() => ({}));
        setMessageStatus(`❌ ${data.error || "Failed to send."}`);
      }
    } catch {
      setMessageStatus("❌ Network error.");
    }
    setMessageSending(false);
  }

  function copyPayLink() {
    navigator.clipboard?.writeText(payLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="history-backdrop" onClick={onClose}>
      <div className="history-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "720px" }}>
        <button className="history-close" onClick={onClose} aria-label="Close">×</button>
        <div className="history-header">
          <div className="history-kicker">
            {order.isInquiry ? "Inquiry" : "Order"} · {order.id.slice(-6).toUpperCase()} · {formatDateTime(order.createdAt)}
          </div>
          <h2 className="history-name">{order.userName}</h2>
          <div className="history-email">{order.userEmail}</div>
          {order.ambassador && <div className="history-email" style={{ color: "var(--accent-strong)" }}>Credited to ambassador {order.ambassador.name} ({order.ambassador.via === "code" ? `their code` : `came through /${order.ambassador.slug}`})</div>}
          {order.placedBy && <div className="history-email" style={{ color: "#b4532a" }}>Placed by staff ({order.placedBy === "admin" ? "shared admin login" : order.placedBy}) using “Log in as”</div>}
        </div>
        <div className="history-body">
          {/* Items */}
          <div style={{ border: "1px solid var(--rule-soft)", borderRadius: "6px", padding: "0.9rem 1.1rem", marginBottom: "1.25rem" }}>
            {order.items.map((i, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.95rem" }}>
                <span>{i.productName} × {i.quantity}{i.restocking && <span className="stock-chip" title="Ordered while at 0 in Stock counts: send when new stock arrives">Restocking</span>}</span>
                <span>{i.price}</span>
              </div>
            ))}
            {order.discount != null && order.discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.9rem", color: "var(--accent-strong)" }}>
                <span>Promo savings</span>
                <span>−${order.discount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.9rem", color: "var(--ink-soft)" }}>
              <span>{order.shippingMethod === "pickup" ? "Local pickup" : "Shipping"}</span>
              <span>{order.shippingCost === 0 ? "Free" : `$${order.shippingCost.toFixed(2)}`}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "0.6rem", marginTop: "0.4rem", borderTop: "1px solid var(--rule-soft)", fontWeight: 700 }}>
              <span>Total</span>
              <span>${order.total.toFixed(2)}</span>
            </div>
          </div>

          {/* Address + note */}
          {address && (
            <div className="notice" style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>
              <strong>{order.shippingMethod === "pickup" ? "Contact address" : "Ship to"}:</strong>{" "}
              {[address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
            </div>
          )}
          {order.note && (
            <div className="user-note" style={{ marginBottom: "1.25rem", fontSize: "0.9rem" }}>"{order.note}"</div>
          )}

          {/* Status */}
          <div className="field" style={{ marginBottom: "1.25rem" }}>
            <label>Status</label>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={order.status}
                onChange={(e) => onStatusChange(order.id, e.target.value as OrderStatus)}
                style={{ padding: "0.6rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px", background: "var(--white)", fontSize: "0.95rem" }}
              >
                {(order.status === "inquiry" ? [...ORDER_STATUSES, "inquiry" as OrderStatus] : ORDER_STATUSES).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              {order.status === "pending" && (
                <button className="approve" onClick={() => onStatusChange(order.id, "paid")} style={{ padding: "0.55rem 1rem" }}>
                  ✓ Mark paid
                </button>
              )}
              {(order.status === "paid" ||
                (order.status === "pending" && order.paymentMethod === "cash")) && (
                <button className="approve" onClick={() => onStatusChange(order.id, "completed")} style={{ padding: "0.55rem 1rem" }}>
                  {order.shippingMethod === "pickup" ? "🤝" : "📦"} Mark completed
                </button>
              )}
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-soft)", marginTop: "0.4rem" }}>
              {order.paidAt ? `Paid ${formatDateTime(order.paidAt)}. ` : ""}
              {order.shippedAt ? `Shipped ${formatDateTime(order.shippedAt)}.` : ""}
              {order.pickedUpAt ? `Picked up ${formatDateTime(order.pickedUpAt)}.` : ""}
            </div>
          </div>

          {/* Automatic payment reminders */}
          {order.status === "pending" && !order.isInquiry && order.paymentMethod !== "cash" && (
            <OrderReminders order={order} onRefreshed={onRefreshed} />
          )}

          {/* Payment link */}
          {!order.isInquiry && (
            <div className="field" style={{ marginBottom: "1.25rem" }}>
              <label>Customer payment link</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input type="text" readOnly value={payLink} style={{ flex: 1, fontSize: "0.8rem" }} onFocus={(e) => e.target.select()} />
                <button onClick={copyPayLink} style={{ padding: "0.55rem 0.9rem", border: "1px solid var(--rule)", borderRadius: "3px", background: "var(--white)", whiteSpace: "nowrap" }}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-soft)", marginTop: "0.35rem" }}>
                This link was included in their invoice — they click it to mark the order paid.
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                {brand.payments.venmoHandle && (<a
                  href={`https://venmo.com/${brand.payments.venmoHandle}?txn=pay&amount=${order.total.toFixed(2)}&note=${encodeURIComponent(`Order for ${order.userName.trim().replace(/\s+/g, " ")} #${order.id.slice(-6).toUpperCase()}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", background: "#008CFF", color: "#fff", padding: "0.5rem 1rem", borderRadius: "4px", fontSize: "0.78rem", fontWeight: 700 }}
                >
                  Venmo request link (${order.total.toFixed(2)})
                </a>)}
                <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginLeft: "0.6rem" }}>
                  Right-click to copy and send directly to the customer.
                </span>
              </div>
            </div>
          )}

          {/* Shipping label */}
          {order.shippingMethod === "ship" && (
            <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "1.25rem", marginBottom: "1.25rem" }}>
              <div className="history-kicker" style={{ marginBottom: "0.75rem" }}>Shipping label</div>
              {order.labelUrl ? (
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                  <a href={order.labelUrl} target="_blank" rel="noopener noreferrer" className="submit" style={{ textDecoration: "none", width: "auto", padding: "0.6rem 1.2rem" }}>
                    Download label
                  </a>
                  <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                    {order.shippedService}{order.trackingNumber ? ` · Tracking ${order.trackingNumber}` : ""}
                  </div>
                </div>
              ) : !address ? (
                <div className="notice" style={{ fontSize: "0.85rem" }}>No address on this order or the member's profile — a label can't be created.</div>
              ) : (
                <form onSubmit={createLabel} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Weight (oz)</label>
                    <input type="number" step="0.1" min="0.1" value={weightOz} onChange={(e) => { setWeightTouched(true); setWeightOz(parseFloat(e.target.value) || 8); }} style={{ width: "100px" }} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Service</label>
                    <select value={service} onChange={(e) => setService(e.target.value)} style={{ padding: "0.6rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px", background: "var(--white)" }}>
                      <option value="usps_ground_advantage">USPS Ground Advantage</option>
                      <option value="usps_priority">USPS Priority Mail</option>
                      <option value="usps_priority_express">USPS Priority Express</option>
                    </select>
                  </div>
                  <button type="submit" className="submit" disabled={labelSubmitting} style={{ width: "auto", padding: "0.65rem 1.25rem" }}>
                    {labelSubmitting ? "Creating…" : "Generate label"}
                  </button>
                  {labelError && <div className="gate-error" style={{ width: "100%" }}>{labelError}</div>}
                  <div className="field-hint" style={{ width: "100%", margin: 0 }}>
                    {calcWeight.oz !== null
                      ? weightTouched && weightOz !== calcWeight.oz
                        ? `Changed by hand — the products add up to ${calcWeight.oz} oz.`
                        : `Weight worked out: ${calcWeight.parts.join(" + ")} = ${calcWeight.oz} oz.`
                      : `No shipping weight set for ${calcWeight.missing.join(", ")} — weigh the parcel and type it in (or add weights under Products → Shipping weights).`}
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Message customer */}
          <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "1.25rem" }}>
            <div className="history-kicker" style={{ marginBottom: "0.75rem" }}>Message customer</div>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Email ${order.userName.split(" ")[0]} about this ${order.isInquiry ? "inquiry" : "order"}…`}
              style={{ width: "100%", padding: "0.7rem 0.9rem", border: "1px solid var(--rule-soft)", borderRadius: "3px" }}
            />
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.6rem" }}>
              <button className="submit" onClick={sendMessage} disabled={messageSending || !message.trim()} style={{ width: "auto", padding: "0.6rem 1.2rem" }}>
                {messageSending ? "Sending…" : "Send email"}
              </button>
              {messageStatus && <span style={{ fontSize: "0.85rem" }}>{messageStatus}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dashboard dates are always local (the business's time), whatever the
// viewer's computer is set to — otherwise someone travelling sees order times
// a day off from what the Concierge (and everyone else) says.
function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: brand.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    timeZone: brand.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function generatePassword(): string {
  const adjectives = [
    "Ember", "Mountain", "Forest", "River", "Sage", "Cedar", "Pine",
    "Maple", "Coastal", "Quiet", "Sunlit", "Misty", "Dawn", "Dusk",
  ];
  const nouns = [
    "Wolf", "Cabin", "Trail", "Stone", "Bloom", "Path", "Fern",
    "Acorn", "Brook", "Ridge", "Glade", "Lantern", "Falcon", "Heron",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}${noun}-${num}`;
}


/** Reminder history + Revive / Stop controls inside the order window. */
function OrderReminders({ order, onRefreshed }: { order: Order; onRefreshed: (o: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function act(action: "revive" | "stop" | "resume" | "expire") {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId: order.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.order) throw new Error(d.error || "Couldn't save.");
      onRefreshed(d.order);
      rememberChange("order", d.order.id, { expiredAt: d.order.expiredAt ?? null, remindersOff: d.order.remindersOff ?? null });
      setMsg(action === "expire" ? "Moved to Expired. It's still unpaid (not cancelled) and the pay link still works." : action === "revive" ? "Back in the unpaid list. Automatic reminders are off for this order." : action === "stop" ? "Automatic reminders stopped for this order." : "Automatic reminders will continue.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't save.");
    }
    setBusy(false);
  }
  const sent = (order.reminders || []).filter((r) => r.ok);
  return (
    <div className="field rem-box">
      <label>Payment reminders</label>
      {order.expiredAt ? (
        <div className="rem-line">
          <span className="rem-chip expired">Expired {formatDateTime(order.expiredAt)}</span>
          <button type="button" className="esc-btn primary" disabled={busy} onClick={() => act("revive")}>Revive order</button>
        </div>
      ) : (
        <div className="rem-line">
          <span className="field-hint" style={{ margin: 0 }}>
            {sent.length ? `${sent.length} sent · last ${formatDateTime(sent[sent.length - 1].at)}` : "None sent yet"}
            {order.remindersOff ? " · switched off for this order" : ""}
          </span>
          <button type="button" className="ap-linkbtn esc-quiet" disabled={busy} onClick={() => act(order.remindersOff ? "resume" : "stop")}>
            {order.remindersOff ? "Resume reminders" : "Stop reminders for this order"}
          </button>
          <button type="button" className="ap-linkbtn esc-quiet" disabled={busy} onClick={() => confirm("Move this order to Expired? It stays unpaid (not cancelled) and the customer can still pay; no more automatic reminders go out.") && act("expire")}>
            Move to Expired
          </button>
        </div>
      )}
      {msg && <div className="field-hint">{msg}</div>}
    </div>
  );
}
