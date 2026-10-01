export function fmtInt(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-US");
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${fmtNum(value, 2)}%`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(Number(seconds));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function initials(name: string | null | undefined): string {
  const text = String(name ?? "").trim();
  if (!text) return "?";
  return text.replace(/[^A-Za-z0-9]+/g, " ").trim().charAt(0).toUpperCase() || "?";
}
