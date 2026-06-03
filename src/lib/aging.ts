// Aging colours for execution stages (PRD F4): <12h green, 12–24h yellow,
// 24–48h amber, >48h red. Based on how long an in-progress stage has been running.

export type AgingLevel = "fresh" | "warn" | "amber" | "stale" | "none";

export function agingHours(since: string | null | undefined): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

export function agingLevel(hours: number | null): AgingLevel {
  if (hours == null) return "none";
  if (hours < 12) return "fresh";
  if (hours < 24) return "warn";
  if (hours < 48) return "amber";
  return "stale";
}

export const AGING_CLASS: Record<AgingLevel, string> = {
  fresh: "bg-emerald-500",
  warn: "bg-yellow-400",
  amber: "bg-amber-500",
  stale: "bg-red-500",
  none: "bg-muted-foreground/30",
};

export const AGING_LABEL: Record<AgingLevel, string> = {
  fresh: "< 12h", warn: "12–24h", amber: "24–48h", stale: "> 48h", none: "—",
};

export function fmtHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
