// Browser client for the replay upload API (api/handler.py).
//
// The player types the shared upload password once; it is kept in localStorage
// and sent as the X-Upload-Token header on every request. The password is never
// part of the build, so it cannot be lifted out of the static bundle.

const API_URL = (import.meta.env.VITE_UPLOAD_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_STORAGE_KEY = "dls.uploadToken";
const MATCH_FILENAME_RE = /^(\d+)\.dem$/i;

/** True when a build was deployed with an upload API URL. */
export function isUploadConfigured(): boolean {
  return API_URL.length > 0;
}

/** Dota names every replay after its match id, so "<match_id>.dem" is the key. */
export function matchIdFromFilename(filename: string): string | null {
  const match = MATCH_FILENAME_RE.exec(filename.trim());
  return match ? match[1] : null;
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable (e.g. private mode); the password then only
    // lasts for this page session.
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Wrong or missing upload password. */
export class UploadAuthError extends Error {
  constructor() {
    super("Incorrect upload password.");
    this.name = "UploadAuthError";
  }
}

/** The match already exists, so the upload was refused before it started. */
export class DuplicateReplayError extends Error {
  readonly matchId: string;
  readonly stage: "raw" | "parsed";
  readonly lastModified: string | null;

  constructor(matchId: string, stage: "raw" | "parsed", lastModified: string | null) {
    super("This replay already exists.");
    this.name = "DuplicateReplayError";
    this.matchId = matchId;
    this.stage = stage;
    this.lastModified = lastModified;
  }
}

export interface UploadTicket {
  matchId: string;
  key: string;
  url: string;
  fields: Record<string, string>;
  expiresIn: number;
}

export type UploadStatus = "unknown" | "uploaded" | "processing" | "parsed" | "failed";

export interface MatchStatus {
  status: UploadStatus;
  matchId: string;
  error: string | null;
}

interface ErrorBody {
  message?: string;
  match_id?: string;
  stage?: string;
  last_modified?: string;
}

async function readError(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

/** Cheap password check so the dialog can validate before a file is chosen. */
export async function verifyToken(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/token-check`, { headers: { "x-upload-token": token } });
  if (res.status === 401) throw new UploadAuthError();
  if (!res.ok) throw new Error(`Could not verify the password (HTTP ${res.status}).`);
}

/** Ask the API for a presigned upload target, or throw a typed duplicate/auth error. */
export async function requestUpload(filename: string, size: number, token: string): Promise<UploadTicket> {
  const res = await fetch(`${API_URL}/replays`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-token": token },
    body: JSON.stringify({ filename, size }),
  });

  if (res.status === 401) throw new UploadAuthError();

  if (res.status === 409) {
    const body = await readError(res);
    const stage = body.stage === "parsed" ? "parsed" : "raw";
    throw new DuplicateReplayError(
      body.match_id ?? matchIdFromFilename(filename) ?? filename,
      stage,
      body.last_modified ?? null,
    );
  }

  if (!res.ok) {
    const body = await readError(res);
    throw new Error(body.message ?? `Upload request failed (HTTP ${res.status}).`);
  }

  const body = (await res.json()) as {
    match_id: string;
    key: string;
    upload: { url: string; fields: Record<string, string> };
    expires_in: number;
  };
  return {
    matchId: body.match_id,
    key: body.key,
    url: body.upload.url,
    fields: body.upload.fields,
    expiresIn: body.expires_in,
  };
}

/** POST the file straight to S3 with progress reporting (fetch cannot). */
export function uploadToS3(ticket: UploadTicket, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [field, value] of Object.entries(ticket.fields)) form.append(field, value);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.url);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload to storage failed (HTTP ${xhr.status}).`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error while uploading the replay.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(form);
  });
}

export async function fetchMatchStatus(matchId: string, token: string): Promise<MatchStatus> {
  const res = await fetch(`${API_URL}/replays/${encodeURIComponent(matchId)}`, {
    headers: { "x-upload-token": token },
  });
  if (res.status === 401) throw new UploadAuthError();
  if (!res.ok) throw new Error(`Could not check the replay status (HTTP ${res.status}).`);
  const body = (await res.json()) as { status?: UploadStatus; error?: string | null };
  return { status: body.status ?? "unknown", matchId, error: body.error ?? null };
}
