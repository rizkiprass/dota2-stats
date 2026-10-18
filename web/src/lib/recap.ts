import { UploadAuthError, getStoredToken, isUploadConfigured } from "./upload";

const API_URL = (import.meta.env.VITE_UPLOAD_API_URL ?? "").replace(/\/+$/, "");

export interface RecapMvp {
  playerName: string;
  reason: string;
}

export interface MatchRecap {
  summary: string;
  turningPoint: string;
  radiantInsight: string;
  direInsight: string;
  mvp: RecapMvp | null;
  disclaimer: string;
  cached: boolean;
  model: string | null;
}

export class RecapNotFoundError extends Error {
  constructor() {
    super("No recap has been generated for this match.");
    this.name = "RecapNotFoundError";
  }
}

interface RecapBody {
  cached?: boolean;
  model?: string | null;
  recap?: {
    summary?: string;
    turning_point?: string;
    radiant_insight?: string;
    dire_insight?: string;
    disclaimer?: string;
    mvp?: { player_name?: string; reason?: string };
  };
  message?: string;
}

function fromBody(body: RecapBody): MatchRecap {
  const recap = body.recap ?? {};
  const mvp = recap.mvp;
  return {
    summary: recap.summary ?? "",
    turningPoint: recap.turning_point ?? "",
    radiantInsight: recap.radiant_insight ?? "",
    direInsight: recap.dire_insight ?? "",
    disclaimer: recap.disclaimer ?? "",
    cached: Boolean(body.cached),
    model: body.model ?? null,
    mvp: mvp?.player_name
      ? { playerName: mvp.player_name, reason: mvp.reason ?? "" }
      : null,
  };
}

async function requestRecap(matchId: string, token: string, method: "GET" | "POST"): Promise<MatchRecap> {
  const res = await fetch(`${API_URL}/replays/${encodeURIComponent(matchId)}/recap`, {
    method,
    headers: { "x-upload-token": token },
  });
  let body: RecapBody = {};
  try {
    body = (await res.json()) as RecapBody;
  } catch {
    body = {};
  }
  if (res.status === 401) throw new UploadAuthError();
  if (method === "GET" && res.status === 404) throw new RecapNotFoundError();
  if (!res.ok) throw new Error(body.message ?? `Could not load the recap (HTTP ${res.status}).`);
  return fromBody(body);
}

export { getStoredToken, isUploadConfigured };

export function fetchRecap(matchId: string, token: string): Promise<MatchRecap> {
  return requestRecap(matchId, token, "GET");
}

export function generateRecap(matchId: string, token: string): Promise<MatchRecap> {
  return requestRecap(matchId, token, "POST");
}
