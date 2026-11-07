const API = (import.meta.env.VITE_AI_API_URL ?? "").replace(/\/+$/, "");

export interface ReplayPlayer {
  player_index: number;
  player_name?: string | null;
  hero_id?: number;
  hero_slug?: string | null;
  team?: string;
  items?: { item: string | null; time: number | null }[];
}

export interface ReplayDetails { players: ReplayPlayer[] }
export interface AnalysisAnswer { answer: string; cached: boolean }
export type InsightCategory = "economy" | "death" | "objective" | "damage" | "defense" | "timing";
export interface InsightItem { category: InsightCategory; title: string; text: string; time_seconds: number | null }
export interface MatchInsight { summary: string; winning_factors: InsightItem[]; losing_challenges: InsightItem[]; improvements: InsightItem[]; limitations: string }
export const analysisConfigured = Boolean(API);

async function request<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${API}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : "Analysis is temporarily unavailable.";
    throw new Error(message);
  }
  return result as T;
}

export const getReplayDetails = (id: string) => request<ReplayDetails>(`/matches/${encodeURIComponent(id)}/details`);
export const analyzeItems = (id: string, player_index: number) => request<AnalysisAnswer>(`/matches/${encodeURIComponent(id)}/analysis`, { player_index });
export const askMatch = (id: string, question: string) => request<AnalysisAnswer>(`/matches/${encodeURIComponent(id)}/chat`, { question });
export const generateInsight = (id: string) => request<{ insight: MatchInsight; cached: boolean }>(`/matches/${encodeURIComponent(id)}/insight`, {});
