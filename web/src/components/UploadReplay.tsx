import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "./ui";
import { fmtDate } from "../lib/format";
import {
  clearStoredToken,
  DuplicateReplayError,
  fetchMatchStatus,
  getStoredToken,
  matchIdFromFilename,
  requestUpload,
  setStoredToken,
  uploadToS3,
  UploadAuthError,
  verifyToken,
} from "../lib/upload";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 72;

type Phase = "auth" | "ready" | "running" | "done";
type ReplayStatus = "invalid" | "queued" | "uploading" | "processing" | "parsed" | "pending" | "duplicate" | "failed";

interface ReplayItem {
  id: string;
  file: File;
  matchId: string | null;
  status: ReplayStatus;
  progress: number;
  detail: string | null;
  duplicate?: { stage: "raw" | "parsed"; lastModified: string | null };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function statusLabel(item: ReplayItem): string {
  switch (item.status) {
    case "invalid":
      return item.detail ?? "Invalid filename";
    case "queued":
      return "Waiting";
    case "uploading":
      return `Uploading ${Math.round(item.progress * 100)}%`;
    case "processing":
      return "Parsing";
    case "parsed":
      return "Parsed";
    case "pending":
      return "Still processing";
    case "duplicate":
      return "Already exists";
    case "failed":
      return item.detail ?? "Failed";
  }
}

function makeReplayItems(files: File[]): ReplayItem[] {
  const seenMatchIds = new Set<string>();
  return files.map((file, index) => {
    const matchId = matchIdFromFilename(file.name);
    let status: ReplayStatus = "queued";
    let detail: string | null = null;
    if (!matchId) {
      status = "invalid";
      detail = "Rename to <match_id>.dem";
    } else if (seenMatchIds.has(matchId)) {
      status = "invalid";
      detail = "Duplicate match ID in this batch";
    } else {
      seenMatchIds.add(matchId);
    }
    return { id: `${file.name}-${file.size}-${file.lastModified}-${index}`, file, matchId, status, progress: 0, detail };
  });
}

export function UploadReplay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [phase, setPhase] = useState<Phase>(() => (getStoredToken() ? "ready" : "auth"));
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [items, setItems] = useState<ReplayItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    if (phase !== "running") {
      setPhase(token ? "ready" : "auth");
      setItems([]);
      setAuthError(null);
    }
  }, [open, phase, token]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const updateItem = (id: string, changes: Partial<ReplayItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    const value = password.trim();
    if (!value) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await verifyToken(value);
      setStoredToken(value);
      setToken(value);
      setPassword("");
      setPhase("ready");
    } catch (error) {
      setAuthError(error instanceof UploadAuthError ? "Password salah, coba lagi." : error instanceof Error ? error.message : "Tidak bisa memverifikasi password.");
    } finally {
      setAuthBusy(false);
    }
  };

  const forgetPassword = () => {
    clearStoredToken();
    setToken(null);
    setAuthError(null);
    setItems([]);
    setPhase("auth");
  };

  const pickFiles = (files: FileList | File[]) => {
    setItems(makeReplayItems(Array.from(files)));
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) pickFiles(event.dataTransfer.files);
  };

  const pollMatch = async (item: ReplayItem, activeToken: string): Promise<ReplayStatus> => {
    if (!item.matchId) return "invalid";
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const status = await fetchMatchStatus(item.matchId, activeToken);
        if (status.status === "parsed") {
          updateItem(item.id, { status: "parsed", progress: 1, detail: null });
          return "parsed";
        }
        if (status.status === "failed") {
          updateItem(item.id, { status: "failed", detail: status.error ?? "The parser could not read this replay." });
          return "failed";
        }
      } catch (error) {
        if (error instanceof UploadAuthError) throw error;
        // The parser or API can be briefly unavailable while processing; keep
        // polling until the normal timeout rather than failing the whole item.
      }
    }
    updateItem(item.id, { status: "pending", detail: "Parsing is taking longer than usual." });
    return "pending";
  };

  const startUpload = async () => {
    if (!token) return;
    const queued = items.filter((item) => item.status === "queued");
    if (!queued.length) return;
    setPhase("running");
    let parsedAny = false;

    for (const item of queued) {
      try {
        updateItem(item.id, { status: "uploading", progress: 0, detail: null });
        const ticket = await requestUpload(item.file.name, item.file.size, token);
        await uploadToS3(ticket, item.file, (progress) => updateItem(item.id, { progress }));
        updateItem(item.id, { status: "processing", progress: 1 });
        if (await pollMatch({ ...item, matchId: ticket.matchId }, token) === "parsed") parsedAny = true;
      } catch (error) {
        if (error instanceof UploadAuthError) {
          clearStoredToken();
          setToken(null);
          setAuthError("Password upload tidak valid. Masukkan ulang.");
          setPhase("auth");
          return;
        }
        if (error instanceof DuplicateReplayError) {
          updateItem(item.id, {
            status: "duplicate",
            detail: null,
            duplicate: { stage: error.stage, lastModified: error.lastModified },
          });
          continue;
        }
        updateItem(item.id, { status: "failed", detail: error instanceof Error ? error.message : "The upload failed." });
      }
    }

    if (parsedAny) {
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
    }
    setPhase("done");
  };

  if (!open) return null;

  const validCount = items.filter((item) => item.status === "queued").length;
  const parsedCount = items.filter((item) => item.status === "parsed").length;
  const duplicateCount = items.filter((item) => item.status === "duplicate").length;
  const failedCount = items.filter((item) => item.status === "failed" || item.status === "invalid").length;
  const pendingCount = items.filter((item) => item.status === "pending").length;

  return (
    <div className="upload-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <div className="upload-head">
          <div>
            <h2 className="upload-title" id="upload-title">Upload replays</h2>
            <p className="upload-sub">Add Dota 2 replays one at a time. Duplicates are rejected.</p>
          </div>
          <button type="button" className="upload-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="upload-body">
          {phase === "auth" ? (
            <form className="upload-form" onSubmit={submitPassword}>
              <div className="upload-field">
                <label htmlFor="upload-password">Upload password</label>
                <input id="upload-password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              {authError ? <p className="upload-error" role="alert">{authError}</p> : null}
              <div className="upload-actions"><button className="upload-primary" type="submit" disabled={authBusy || !password.trim()}>{authBusy ? "Checking…" : "Continue"}</button></div>
              <p className="upload-hint">You only enter this once; this browser remembers it.</p>
            </form>
          ) : null}

          {phase === "ready" ? (
            <>
              <label className={`upload-drop${dragging ? " dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                <input type="file" accept=".dem" multiple className="upload-input" onChange={(event) => { if (event.target.files) pickFiles(event.target.files); event.currentTarget.value = ""; }} />
                <span className="upload-drop-icon"><Icon name="upload" /></span>
                <strong>Choose replays</strong>
                <span>Drag .dem files here, or click to browse</span>
              </label>

              {items.length ? (
                <div className="upload-file-list" aria-label="Selected replays">
                  {items.map((item) => (
                    <div className={`upload-file upload-file-${item.status}`} key={item.id}>
                      <span className="upload-file-name">{item.file.name}</span>
                      <span className="upload-file-meta">{item.detail ?? formatBytes(item.file.size)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {items.some((item) => item.status === "invalid") ? <p className="upload-error" role="alert">Invalid replays will not be uploaded.</p> : null}
              <div className="upload-actions"><button className="upload-primary" type="button" disabled={!validCount} onClick={startUpload}>Upload {validCount || ""} replay{validCount === 1 ? "" : "s"}</button></div>
              <button className="upload-note" type="button" onClick={forgetPassword}>Use a different password</button>
            </>
          ) : null}

          {phase === "running" ? (
            <>
              <div className="upload-status"><span className="upload-spinner" aria-hidden="true" />Uploading and parsing replays…</div>
              <p className="upload-hint">Each replay completes parsing before the next replay starts.</p>
              <div className="upload-file-list" aria-label="Replay upload progress">
                {items.map((item) => (
                  <div className={`upload-file upload-file-${item.status}`} key={item.id}>
                    <div className="upload-file-main"><span className="upload-file-name">{item.file.name}</span>{item.status === "uploading" ? <div className="upload-progress"><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></div> : null}</div>
                    <span className="upload-file-meta">{statusLabel(item)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {phase === "done" ? (
            <>
              <div className="upload-status done"><span className="upload-check"><Icon name="check" /></span>Batch complete.</div>
              <p className="upload-hint">{parsedCount} parsed · {duplicateCount} duplicate · {failedCount} failed{pendingCount ? ` · ${pendingCount} still processing` : ""}</p>
              <div className="upload-file-list" aria-label="Replay upload results">
                {items.map((item) => <div className={`upload-file upload-file-${item.status}`} key={item.id}><span className="upload-file-name">{item.file.name}</span><span className="upload-file-meta">{statusLabel(item)}{item.duplicate?.lastModified ? ` · ${fmtDate(item.duplicate.lastModified)}` : ""}</span></div>)}
              </div>
              <div className="upload-actions"><button className="upload-primary" type="button" onClick={() => { setItems([]); setPhase("ready"); }}>Upload more replays</button><button className="upload-ghost" type="button" onClick={onClose}>Close</button></div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
