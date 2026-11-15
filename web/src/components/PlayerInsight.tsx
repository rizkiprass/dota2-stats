import { useEffect, useState } from "react";
import { fmtEpochDate } from "../lib/format";
import {
  generatePlayerProfile,
  getStoredProfile,
  playerAnalysisConfigured,
  profileIsStale,
  type ProfileFinding,
  type ProfileResult,
} from "../lib/player-analysis";
import { Icon, type IconName } from "./ui";

const TREND_LABEL = { improving: "Improving", declining: "Declining", stable: "Stable", unknown: "No trend published" } as const;

/**
 * The on-demand AI read of one player's recent lobby record.
 *
 * Nothing here calls a model on page load. The stored analysis is fetched with a
 * GET, which the server answers from one S3 read; a POST is the only thing that
 * can spend provider tokens, and it is always behind a button. That is what keeps
 * the feature inside a one-dollar monthly provider budget however often profiles
 * are viewed.
 */
export function PlayerInsight({ id, name, newestMatchTime }: { id: string; name: string; newestMatchTime: number | null }) {
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!playerAnalysisConfigured) return undefined;
    let cancelled = false;
    // A read failure is not an error worth showing: it means no analysis has been
    // generated yet, or the AI API is unreachable, and either way the card falls
    // back to its idle state with the button still available.
    getStoredProfile(id)
      .then((stored) => { if (!cancelled) setResult(stored); })
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [id]);

  if (!playerAnalysisConfigured) return null;

  const ready = result?.kind === "ready" ? result : null;
  const insufficient = result?.kind === "insufficient" ? result : null;
  const stale = ready ? profileIsStale(ready.meta, newestMatchTime) : false;

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setResult(await generatePlayerProfile(id));
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="player-insight" aria-labelledby="player-insight-title">
      <div className="player-insight-header">
        <div className="player-insight-title">
          <span className="player-insight-icon" aria-hidden="true"><Icon name="sparkles" /></span>
          <h2 id="player-insight-title">Player read</h2>
          <span className="player-insight-tag"><span>AI powered</span></span>
        </div>
        {ready ? <span className="player-insight-meta">{fmtEpochDate(ready.meta.generated_at)}</span> : null}
      </div>

      {insufficient ? (
        <p className="player-insight-intro">{insufficient.message}</p>
      ) : !ready ? (
        <div className="player-insight-intro">
          <p>A structured read of {name}’s recent lobby record: strengths, focus areas, inferred role and direction of travel. Generated on demand from the published statistics, never from chat or behaviour data.</p>
          <button type="button" onClick={() => void generate()} disabled={busy}>{busy ? "Analyzing recent matches…" : "Generate analysis"}</button>
        </div>
      ) : (
        <>
          <p className="player-insight-headline">{ready.profile.headline}</p>
          {expanded ? (
            <div className="player-insight-details" id="player-insight-details">
              <FindingList title="Strengths" items={ready.profile.strengths} icon="check" />
              <FindingList title="Focus areas" items={ready.profile.focus_areas} icon="scale" />
              <p className="player-insight-role"><Icon name="users" /><span>{ready.profile.role_read.text}</span></p>
              <p className="player-insight-trend">
                <strong>{TREND_LABEL[ready.profile.trend.direction]}</strong>
                <span>{ready.profile.trend.text}</span>
              </p>
              <p className="player-insight-limitations">{ready.profile.limitations}</p>
            </div>
          ) : null}
          <div className="player-insight-actions">
            <button className="player-insight-more" type="button" aria-expanded={expanded} aria-controls="player-insight-details" onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read analysis"} <span aria-hidden="true">{expanded ? "↑" : "→"}</span></button>
            <button className="player-insight-refresh" type="button" onClick={() => void generate()} disabled={busy}>{busy ? "Analyzing…" : stale ? "Refresh analysis" : "Regenerate"}</button>
          </div>
          {stale ? <p className="player-insight-stale">Matches have been published since this analysis was generated.</p> : null}
          {ready.stored === false ? <p className="player-insight-stale">This analysis could not be saved, so it will be generated again on your next visit.</p> : null}
          {ready.meta.sample_tier === "small" ? <p className="player-insight-stale">Small sample: {ready.meta.matches_analyzed} matches. Read these as an observed record, not an established pattern.</p> : null}
        </>
      )}

      {error ? <p className="player-insight-error" role="alert">{error}</p> : null}
      {ready ? (
        <div className="player-insight-footer">
          <span>Based on {ready.meta.matches_analyzed} recent matches</span>
          <span>{ready.meta.confidence === "medium" ? "Medium" : "Low"} confidence · AI interpretation</span>
        </div>
      ) : null}
    </section>
  );
}

function FindingList({ title, items, icon }: { title: string; items: ProfileFinding[]; icon: IconName }) {
  if (!items.length) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul className="player-insight-list">
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <span className="player-insight-list-icon" aria-hidden="true"><Icon name={icon} /></span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
