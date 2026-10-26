import { readTraffic, pacificDay } from "../traffic";
import { FLAG_LABELS, RETENTION_DAYS, recentTranscripts, type FlagKind } from "./transcripts";

/** 30-day summary of Concierge conversations: topics, flags, volumes by audience. */
export async function chatInsights() {
  const to = pacificDay();
  const from = pacificDay(Date.now() - (RETENTION_DAYS - 1) * 86_400_000);
  const rows = await readTraffic(from, to);
  const sum = (prefix: string) => {
    const m = new Map<string, number>();
    for (const r of rows) for (const [k, v] of Object.entries(r.c)) if (k.startsWith(prefix)) m.set(k.slice(prefix.length), (m.get(k.slice(prefix.length)) || 0) + v);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const topics = sum("at:").filter(([k]) => k !== "staff").map(([key, value]) => ({ key, value }));
  const flags = sum("afl:").map(([key, value]) => ({ key, label: FLAG_LABELS[key as FlagKind] || key, value }));
  const conversations = Object.fromEntries(sum("ac:"));
  const flagged = await recentTranscripts({ flagged: true, limit: 12 });
  return {
    days: RETENTION_DAYS,
    conversations: { public: conversations.public || 0, member: conversations.member || 0, admin: conversations.admin || 0 },
    topics,
    flags,
    recentFlagged: flagged.map((t) => ({
      id: t.id,
      who: t.who,
      when: t.lastAt,
      flags: t.flags.map((f) => ({ label: FLAG_LABELS[f.kind], severity: f.severity, excerpt: f.excerpt })),
    })),
  };
}
