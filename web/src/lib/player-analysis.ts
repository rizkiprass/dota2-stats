const API = (import.meta.env.VITE_AI_API_URL ?? "").replace(/\/+$/, "");

// Mirrors the validated shape `ai/profile_handler.py` stores and returns. Every
// field below has already been checked server-side against the metrics payload,
// so the UI renders it rather than re-validating it.
export interface ProfileFinding { title: string; text: string; metrics: string[] }
export type TrendDirection = "improving" | "declining" | "stable" | "unknown";
export interface PlayerProfileAnalysis {
  headline: string;
  strengths: ProfileFinding[];
  focus_areas: ProfileFinding[];
  role_read: { text: string; metrics: string[] };
  trend: { direction: TrendDirection; text: string; metrics: string[] };
  limitations: string;
}
export type SampleTier = "insufficient" | "small" | "adequate";
export interface ProfileMeta {
  metrics_version: string;
  prompt_version: string;
  model: string;
  source_hash: string | null;
  matches_analyzed: number;
  sample_tier: SampleTier;
  confidence: "low" | "medium";
  generated_at: number;
}
export type ProfileResult =
  | { kind: "ready"; profile: PlayerProfileAnalysis; meta: ProfileMeta; cached: boolean; regenerated: boolean; stored: boolean }
  | { kind: "insufficient"; message: string; matches_analyzed: number; required_matches: number };

export const playerAnalysisConfigured = Boolean(API);

interface ErrorBody { message?: unknown; status?: unknown }

async function call(id: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  if (!API) throw new Error("Player analysis is not configured for this deployment.");
  const res = await fetch(`${API}/players/${encodeURIComponent(id)}/profile`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function message(body: unknown, fallback: string): string {
  const text = (body as ErrorBody | null)?.message;
  return typeof text === "string" && text ? text : fallback;
}

function ready(body: Record<string, unknown>, cached: boolean): ProfileResult {
  return {
    kind: "ready",
    profile: body.profile as PlayerProfileAnalysis,
    meta: body.meta as ProfileMeta,
    cached,
    regenerated: body.regenerated === true,
    stored: body.stored !== false,
  };
}

function interpret(status: number, body: unknown): ProfileResult | null {
  const record = (body ?? {}) as Record<string, unknown>;
  if (status === 200) {
    if (record.status === "insufficient_data") {
      return {
        kind: "insufficient",
        message: message(body, "Not enough eligible matches for an analysis yet."),
        matches_analyzed: Number(record.matches_analyzed) || 0,
        required_matches: Number(record.required_matches) || 0,
      };
    }
    if (record.profile && record.meta) return ready(record, record.cached === true);
    return null;
  }
  // 404 on a read means nothing has been generated yet, which is the normal state
  // of a first visit rather than a failure.
  if (status === 404 && record.status === "not_generated") return null;
  throw new Error(message(body, status === 429
    ? "Analysis limit reached. Please try again later."
    : "Player analysis is temporarily unavailable."));
}

export async function getStoredProfile(id: string): Promise<ProfileResult | null> {
  const { status, body } = await call(id);
  return interpret(status, body);
}

export async function generatePlayerProfile(id: string, force = false): Promise<ProfileResult | null> {
  const { status, body } = await call(id, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(force ? { force: true } : {}),
  });
  return interpret(status, body);
}

/** Whether a stored analysis predates the newest published match.
 *
 * The server decides staleness properly, by comparing a hash of the metrics
 * payload, and a refresh regenerates only when that hash has changed. This is a
 * cheap advisory so the page can say the analysis is behind without asking the
 * server anything: a replay is always parsed after it is played, so a match that
 * started after `generated_at` cannot have been in the window.
 */
export function profileIsStale(meta: ProfileMeta, newestMatchTime: number | null): boolean {
  return newestMatchTime != null && newestMatchTime > meta.generated_at;
}
