// Read a design token from CSS at runtime. Keeps a single source of truth in
// web/src/styles.css for libraries (e.g. Recharts) that need concrete values.
export function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
