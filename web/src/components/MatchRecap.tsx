import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./ui";
import {
  RecapNotFoundError,
  fetchRecap,
  generateRecap,
  getStoredToken,
  isUploadConfigured,
  type MatchRecap as Recap,
} from "../lib/recap";
import { UploadAuthError, clearStoredToken, setStoredToken, verifyToken } from "../lib/upload";

export function MatchRecap({ matchId }: { matchId: string }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [password, setPassword] = useState("");
  const [recap, setRecap] = useState<Recap | null>(null);
  const [phase, setPhase] = useState<"loading" | "missing" | "generating" | "ready" | "error">(
    token ? "loading" : "missing",
  );
  const [error, setError] = useState<string | null>(null);
  const skipLoad = useRef(false);

  useEffect(() => {
    if (!isUploadConfigured() || !token || skipLoad.current) {
      skipLoad.current = false;
      return;
    }
    let cancelled = false;
    setPhase("loading");
    setRecap(null);
    setError(null);
    fetchRecap(matchId, token)
      .then((next) => {
        if (cancelled) return;
        setRecap(next);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UploadAuthError) {
          clearStoredToken();
          setToken(null);
          setPhase("missing");
          return;
        }
        if (err instanceof RecapNotFoundError) {
          setPhase("missing");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load the recap.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, token]);

  if (!isUploadConfigured()) return null;

  async function generate(activeToken: string) {
    setPhase("generating");
    setError(null);
    try {
      const next = await generateRecap(matchId, activeToken);
      setRecap(next);
      setPhase("ready");
    } catch (err: unknown) {
      if (err instanceof UploadAuthError) {
        clearStoredToken();
        setToken(null);
        setPhase("missing");
        setError("Upload password is missing or incorrect.");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not generate the recap.");
      setPhase("error");
    }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setPhase("generating");
    setError(null);
    try {
      await verifyToken(password);
      setStoredToken(password);
      skipLoad.current = true;
      setToken(password);
      await generate(password);
    } catch (err: unknown) {
      setPhase("missing");
      setError(err instanceof UploadAuthError ? "Upload password is missing or incorrect." : err instanceof Error ? err.message : "Could not verify the password.");
    }
  }

  return (
    <section className="match-recap" aria-labelledby="match-recap-title">
      <div className="match-detail-section-heading">
        <h2 id="match-recap-title" className="match-detail-section-title match-recap-title"><Icon name="sparkles" /> AI recap</h2>
        <span>From parsed statistics</span>
      </div>
      {phase === "loading" ? <p className="match-recap-status">Checking saved recap…</p> : null}
      {phase === "generating" ? <p className="match-recap-status" aria-live="polite">Generating recap…</p> : null}
      {error ? <p className="match-recap-error" role="alert">{error}</p> : null}
      {phase === "missing" && !token ? (
        <form className="match-recap-form" onSubmit={(event) => void unlock(event)}>
          <label>
            Upload password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="match-recap-button" type="submit" disabled={password.trim().length === 0}>
            Generate recap
          </button>
        </form>
      ) : null}
      {phase === "missing" && token ? (
        <button className="match-recap-button" type="button" onClick={() => void generate(token)}>
          Generate recap
        </button>
      ) : null}
      {phase === "error" && token ? (
        <button className="match-recap-button" type="button" onClick={() => void generate(token)}>
          Try again
        </button>
      ) : null}
      {recap && phase === "ready" ? <RecapBody recap={recap} /> : null}
    </section>
  );
}

function RecapBody({ recap }: { recap: Recap }) {
  const notes = [
    ["Turning point", recap.turningPoint],
    ["Radiant", recap.radiantInsight],
    ["Dire", recap.direInsight],
    ["MVP", recap.mvp ? `${recap.mvp.playerName}. ${recap.mvp.reason}` : ""],
  ].filter(([, text]) => text);
  return (
    <div className="match-recap-body">
      <p>{recap.summary}</p>
      <div className="match-recap-grid">
        {notes.map(([label, text]) => (
          <div className="match-recap-note" key={label}>
            <b>{label}</b>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <p className="match-recap-disclaimer">{recap.disclaimer}</p>
    </div>
  );
}
