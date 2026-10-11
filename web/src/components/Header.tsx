import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { fmtCount, fmtDate } from "../lib/format";
import type { Stats } from "../types/stats";

const NAV = [
  { id: "summary", label: "Summary" },
  { id: "leaderboards", label: "Leaderboards" },
  { id: "players", label: "Players" },
  { id: "heroes", label: "Heroes" },
  { id: "matchups", label: "Matchups" },
  { id: "activity", label: "Activity" },
] as const;

const NAV_IDS: string[] = NAV.map((item) => item.id);
const NAV_IDS_NO_ACTIVITY = NAV_IDS.filter((id) => id !== "activity");
const NO_IDS: string[] = [];

// Highlights the section currently occupying the middle of the viewport.
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export function Header({ stats }: { stats: Stats }) {
  const meta = stats.metadata;
  const location = useLocation();
  const isDashboard = location.pathname === "/";
  const hasActivity = Object.values(stats.behavior?.players ?? {}).some((record) => record.matches >= 3);
  const navigation = NAV.filter((item) => item.id !== "activity" || hasActivity);
  const active = useScrollSpy(isDashboard ? (hasActivity ? NAV_IDS : NAV_IDS_NO_ACTIVITY) : NO_IDS);

  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <a className="header-brand" href={isDashboard ? "#summary" : "/"}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3v6a6 6 0 0 0 12 0V3" />
              <path d="M12 15v6" />
              <path d="M8 21h8" />
              <path d="M6 3H3m15 0h3" />
            </svg>
          </span>
          <span className="header-titles">
            <h1>Dota&nbsp;2 Lobby Stats</h1>
            <p className="subtitle">
              {fmtCount(meta.source_match_count, "match")}
              <span className="subtitle-built"> · last built {fmtDate(meta.generated_at)}</span>
            </p>
          </span>
        </a>

        <nav className="site-nav" aria-label="Sections">
          {isDashboard
            ? navigation.map((item) => (
                <a key={item.id} href={`#${item.id}`} className={active === item.id ? "active" : undefined}>
                  {item.label}
                </a>
              ))
            : null}
          <Link to="/matches" activeProps={{ className: "active" }}>
            History
          </Link>
        </nav>
      </div>
    </header>
  );
}
