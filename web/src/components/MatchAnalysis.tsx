import { useState } from "react";
import { analysisConfigured, generateInsight, type InsightCategory, type InsightItem, type MatchInsight } from "../lib/analysis";
import { Icon, type IconName } from "./ui";

const insightIcons: Record<InsightCategory, IconName> = { economy: "coin", death: "skull", objective: "tower", damage: "swords", defense: "shield", timing: "clock" };

function formatMatchTime(seconds: number): string {
  const value = Math.round(Math.abs(seconds));
  return `${seconds < 0 ? "−" : ""}${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// Models can still return prose containing seconds despite the structured prompt.
function readableText(text: string): string {
  return text.replace(/\b0\s*(?:seconds?|secs?|s)\s*\(unknown timestamp\)/gi, "time unavailable")
    .replace(/(?<![\w:])(-?\d+)\s*(?:seconds?|secs?|s)\b/gi, (_, seconds: string) => formatMatchTime(Number(seconds)));
}

export function MatchAnalysis({ matchId, radiantWin }: { matchId: string; radiantWin: boolean }) {
  const [insight, setInsight] = useState<MatchInsight | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!analysisConfigured) return null;
  const winner = radiantWin ? "Radiant" : "Dire";
  const loser = radiantWin ? "Dire" : "Radiant";

  async function generate() {
    setBusy(true); setError("");
    try { setInsight((await generateInsight(matchId)).insight); }
    catch (err) { setError(err instanceof Error ? err.message : "Analysis is unavailable. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <section className="match-insight" aria-labelledby="match-insight-title">
      <div className="match-insight-header">
        <div className="match-insight-title"><span className="match-insight-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" fill="currentColor" /></svg></span><h2 id="match-insight-title">Match insight</h2><span className="match-insight-tag"><span>AI powered</span></span></div>
      </div>
      {!insight ? <div className="match-insight-intro"><p>See the patterns behind {winner}’s win and what {loser} could improve next time.</p><button type="button" onClick={() => void generate()} disabled={busy}>{busy ? "Analyzing replay…" : "Generate insight"}</button></div> : <>
        <p className="match-insight-summary">{readableText(insight.summary)}</p>
        {expanded ? <div className="match-insight-details" id="match-insight-details">
          <InsightSection title={`Why ${winner} won`} items={insight.winning_factors} />
          <InsightSection title={`What challenged ${loser}`} items={insight.losing_challenges} />
          <InsightSection title={`What ${loser} could improve`} items={insight.improvements} />
          <p className="match-insight-limitations">{readableText(insight.limitations)}</p>
        </div> : null}
        <button className="match-insight-more" type="button" aria-expanded={expanded} aria-controls="match-insight-details" onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read analysis"} <span aria-hidden="true">{expanded ? "↑" : "→"}</span></button>
      </>}
      {error ? <p className="match-insight-error" role="alert">{error}</p> : null}
      <div className="match-insight-footer"><span>Based on replay data</span><span>AI interpretation</span></div>
    </section>
  );
}

function InsightSection({ title, items }: { title: string; items: InsightItem[] }) {
  return <section><h3>{title}</h3><ul className="insight-list">{items.map((item, index) => <li key={index} className="insight-list-item"><span className="insight-list-icon"><Icon name={insightIcons[item.category] ?? "sparkles"} /></span><div><div className="insight-list-heading"><strong>{readableText(item.title)}</strong>{item.time_seconds != null ? <span className="insight-time">{item.time_seconds < 0 ? "Pre-game · " : ""}{formatMatchTime(item.time_seconds)}</span> : null}</div><p>{readableText(item.text)}</p></div></li>)}</ul></section>;
}
