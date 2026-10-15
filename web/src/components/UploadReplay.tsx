import { useEffect, useState, type DragEvent, type FormEvent } from "react";
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

// How often the dialog asks the API whether the replay has been parsed, and for
// how long before it gives up and lets the player close the tab.
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 72;

type Phase =
  | "auth"
  | "ready"
  | "uploading"
  | "processing"
  | "done"
  | "pending"
  | "duplicate"
  | "failed"
  | "error";

interface DuplicateInfo {
  matchId: string;
  stage: "raw" | "parsed";
  lastModified: string | null;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function UploadReplay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [phase, setPhase] = useState<Phase>(() => (getStoredToken() ? "ready" : "auth"));
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  // Reopening after a finished run starts fresh, but an upload that is still in
  // flight keeps its state (and keeps polling) even if the dialog is closed.
  useEffect(() => {
    if (!open) return;
    setPhase((current) =>
      current === "uploading" || current === "processing" ? current : token ? "ready" : "auth",
    );
    setLocalError(null);
  }, [open, token]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Poll the API until the replay has been parsed (or has failed).
  useEffect(() => {
    if (phase !== "processing" || !matchId || !token) return;
    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const status = await fetchMatchStatus(matchId, token);
        if (cancelled) return;
        if (status.status === "parsed") {
          await queryClient.invalidateQueries({ queryKey: ["stats"] });
          await queryClient.invalidateQueries({ queryKey: ["matches"] });
          setPhase("done");
          return;
        }
        if (status.status === "failed") {
          setDetail(status.error);
          setPhase("failed");
          return;
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof UploadAuthError) {
          clearStoredToken();
          setToken(null);
          setAuthError("Password upload tidak berlaku lagi. Masukkan ulang.");
          setPhase("auth");
          return;
        }
        // Transient failures just retry on the next tick.
      }
      if (attempts >= MAX_POLLS) {
        setPhase("pending");
        return;
      }
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, matchId, token, queryClient]);

  if (!open) return null;

  const pickedMatchId = file ? matchIdFromFilename(file.name) : null;

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
      setAuthError(
        error instanceof UploadAuthError
          ? "Password salah, coba lagi."
          : error instanceof Error
            ? error.message
            : "Tidak bisa memverifikasi password.",
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const forgetPassword = () => {
    clearStoredToken();
    setToken(null);
    setAuthError(null);
    setFile(null);
    setLocalError(null);
    setPhase("auth");
  };

  const pickFile = (next: File | null) => {
    setLocalError(null);
    setFile(next);
    if (next && !matchIdFromFilename(next.name)) {
      setLocalError("Nama file harus <match_id>.dem. Ganti nama replay lalu pilih lagi.");
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files.item(0);
    if (dropped) pickFile(dropped);
  };

  const startUpload = async () => {
    if (!file || !token) return;
    setLocalError(null);
    setDetail(null);
    setDuplicate(null);
    setProgress(0);
    setPhase("uploading");
    try {
      const ticket = await requestUpload(file.name, file.size, token);
      setMatchId(ticket.matchId);
      await uploadToS3(ticket, file, setProgress);
      setProgress(1);
      setPhase("processing");
    } catch (error) {
      if (error instanceof DuplicateReplayError) {
        setDuplicate({ matchId: error.matchId, stage: error.stage, lastModified: error.lastModified });
        setPhase("duplicate");
        return;
      }
      if (error instanceof UploadAuthError) {
        clearStoredToken();
        setToken(null);
        setAuthError("Password upload tidak valid. Masukkan ulang.");
        setPhase("auth");
        return;
      }
      setDetail(error instanceof Error ? error.message : "Terjadi kesalahan.");
      setPhase("error");
    }
  };

  const percent = Math.round(progress * 100);

  return (
    <div
      className="upload-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <div className="upload-head">
          <div>
            <h2 className="upload-title" id="upload-title">
              Upload replay
            </h2>
            <p className="upload-sub">Add a Dota 2 replay to the statistics. Duplicates are rejected.</p>
          </div>
          <button type="button" className="upload-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="upload-body">
          {phase === "auth" ? (
            <form className="upload-form" onSubmit={submitPassword}>
              <div className="upload-field">
                <label htmlFor="upload-password">Upload password</label>
                <input
                  id="upload-password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {authError ? (
                <p className="upload-error" role="alert">
                  {authError}
                </p>
              ) : null}
              <div className="upload-actions">
                <button className="upload-primary" type="submit" disabled={authBusy || password.trim().length === 0}>
                  {authBusy ? "Checking…" : "Continue"}
                </button>
              </div>
              <p className="upload-hint">You only enter this once; this browser remembers it.</p>
            </form>
          ) : null}

          {phase === "ready" ? (
            <>
              <label
                className={`upload-drop${dragging ? " dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  accept=".dem"
                  className="upload-input"
                  onChange={(event) => pickFile(event.target.files?.item(0) ?? null)}
                />
                <span className="upload-drop-icon">
                  <Icon name="upload" />
                </span>
                <strong>Choose a replay</strong>
                <span>Drag a .dem file here, or click to browse</span>
              </label>

              {file ? (
                <div className="upload-file">
                  <span className="upload-file-name">{file.name}</span>
                  <span className="upload-file-meta">{formatBytes(file.size)}</span>
                </div>
              ) : null}

              {localError ? (
                <p className="upload-error" role="alert">
                  {localError}
                </p>
              ) : null}

              <div className="upload-actions">
                <button className="upload-primary" type="button" disabled={!file || !pickedMatchId} onClick={startUpload}>
                  Upload replay
                </button>
              </div>
              <button className="upload-note" type="button" onClick={forgetPassword}>
                Use a different password
              </button>
            </>
          ) : null}

          {phase === "uploading" ? (
            <>
              <div className="upload-status">
                <span className="upload-spinner" aria-hidden="true" />
                Uploading {file?.name}…
              </div>
              <div
                className="upload-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <p className="upload-hint">
                {percent}%{file ? ` · ${formatBytes(file.size)}` : ""}
              </p>
            </>
          ) : null}

          {phase === "processing" ? (
            <>
              <div className="upload-status">
                <span className="upload-spinner" aria-hidden="true" />
                Replay uploaded. Parsing match {matchId}…
              </div>
              <p className="upload-hint">This usually takes 30–90 seconds. Keep this tab open.</p>
            </>
          ) : null}

          {phase === "done" ? (
            <>
              <div className="upload-status done">
                <span className="upload-check">
                  <Icon name="check" />
                </span>
                Replay {matchId} parsed successfully.
              </div>
              <p className="upload-hint">The dashboard now includes this match.</p>
              <div className="upload-actions">
                <button className="upload-primary" type="button" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : null}

          {phase === "pending" ? (
            <>
              <div className="upload-status">
                <span className="upload-spinner" aria-hidden="true" />
                Still processing match {matchId}…
              </div>
              <p className="upload-hint">
                This is taking longer than usual. The dashboard updates as soon as parsing finishes.
              </p>
              <div className="upload-actions">
                <button className="upload-primary" type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : null}

          {phase === "duplicate" && duplicate ? (
            <>
              <div className="upload-status failed" role="alert">
                <span className="upload-fail">
                  <Icon name="close" />
                </span>
                Replay {duplicate.matchId} already exists.
              </div>
              <p className="upload-hint">
                {duplicate.stage === "parsed"
                  ? "This match has already been parsed"
                  : "This replay has already been uploaded"}
                {duplicate.lastModified ? ` (${fmtDate(duplicate.lastModified)})` : ""}. Duplicates are neither
                uploaded nor processed again.
              </p>
              <div className="upload-actions">
                <button className="upload-primary" type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : null}

          {phase === "failed" ? (
            <>
              <div className="upload-status failed" role="alert">
                <span className="upload-fail">
                  <Icon name="close" />
                </span>
                The parser could not read replay {matchId}.
              </div>
              {detail ? <p className="upload-hint">{detail}</p> : null}
              <p className="upload-hint">
                The replay is stored, but it was not parsed. Ask the admin to re-run parsing for this match.
              </p>
              <div className="upload-actions">
                <button className="upload-primary" type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : null}

          {phase === "error" ? (
            <>
              <div className="upload-status failed" role="alert">
                <span className="upload-fail">
                  <Icon name="close" />
                </span>
                {detail ?? "The upload failed."}
              </div>
              <div className="upload-actions">
                <button className="upload-primary" type="button" onClick={() => setPhase("ready")}>
                  Try again
                </button>
                <button className="upload-ghost" type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
