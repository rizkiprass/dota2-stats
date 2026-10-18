import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { fmtCount, fmtDate } from "../lib/format";
import { isUploadConfigured } from "../lib/upload";
import type { Stats } from "../types/stats";
import { Icon } from "./ui";
import { UploadReplay } from "./UploadReplay";

const NAV = [
  { id: "summary", label: "Snapshot" },
  { id: "recent", label: "Recent matches" },
  { id: "leaderboards", label: "Lobby leaders" },
] as const;

const NAV_IDS: string[] = NAV.map((item) => item.id);
const NO_IDS: string[] = [];
const SIDEBAR_COLLAPSED_KEY = "dota-lobby-stats.sidebar-collapsed";

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
  const active = useScrollSpy(isDashboard ? NAV_IDS : NO_IDS);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const uploadEnabled = isUploadConfigured();

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    navRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  const closeDrawer = () => setDrawerOpen(false);
  const openUpload = () => {
    setDrawerOpen(false);
    setUploadOpen(true);
  };
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={drawerOpen}
        aria-controls="primary-navigation"
        onClick={() => setDrawerOpen((open) => !open)}
      >
        <Icon name={drawerOpen ? "close" : "menu"} />
      </button>
      <Link to="/" className="mobile-brand" onClick={closeDrawer}>
        <span>Dota 2 Lobby Stats</span>
        <small>{fmtCount(meta.source_match_count, "match")}</small>
      </Link>
      {drawerOpen ? <button className="nav-overlay" type="button" aria-label="Close navigation" onClick={closeDrawer} /> : null}
      <aside className={`site-header${drawerOpen ? " is-open" : ""}${sidebarCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar-inner">
          <div className="sidebar-brand-row">
            <a className="header-brand" href={isDashboard ? "#summary" : "/"} onClick={closeDrawer}>
              <BrandMark />
              <span className="header-titles">
                <h1>Dota&nbsp;2 Lobby Stats</h1>
                <p className="subtitle">
                  {fmtCount(meta.source_match_count, "match")}
                  <span className="subtitle-built"> · last built {fmtDate(meta.generated_at)}</span>
                </p>
              </span>
            </a>
            <button
              type="button"
              className="desktop-sidebar-toggle"
              aria-label="Collapse navigation"
              aria-expanded={!sidebarCollapsed}
              onClick={toggleSidebar}
            >
              <Icon name="menu" />
            </button>
          </div>
          <button
            type="button"
            className="sidebar-logo-toggle"
            aria-label="Expand navigation"
            aria-expanded={false}
            onClick={toggleSidebar}
          >
            <BrandMark />
          </button>

          <nav className="site-nav" id="primary-navigation" aria-label="Primary navigation" ref={navRef} tabIndex={-1}>
            <Link to="/" aria-label="Overview" activeOptions={{ exact: true }} activeProps={{ className: "active" }} onClick={closeDrawer}>
              <Icon name="home" />
              <span className="nav-label">Overview</span>
            </Link>
            {isDashboard ? (
              <div className="nav-sections" aria-label="Overview sections">
                {NAV.map((item) => (
                  <a key={item.id} href={`#${item.id}`} className={active === item.id ? "active" : undefined} onClick={closeDrawer}>
                    {item.label}
                  </a>
                ))}
              </div>
            ) : null}
            <Link to="/matches" aria-label="History" activeProps={{ className: "active" }} onClick={closeDrawer}>
              <Icon name="clock" />
              <span className="nav-label">History</span>
            </Link>
            <Link to="/leaderboards" aria-label="Leaders" activeProps={{ className: "active" }} onClick={closeDrawer}>
              <Icon name="trophy" />
              <span className="nav-label">Leaders</span>
            </Link>
            <Link to="/records" aria-label="Records" activeProps={{ className: "active" }} onClick={closeDrawer}>
              <Icon name="book" />
              <span className="nav-label">Records</span>
            </Link>
          </nav>
          <div className="sidebar-footer">
            {uploadEnabled ? (
              <button type="button" className="nav-upload" onClick={openUpload}>
                <Icon name="upload" />
                Upload replay
              </button>
            ) : null}
            <p>Replay-derived data · private lobby only</p>
          </div>
        </div>
      </aside>
      {uploadEnabled ? <UploadReplay open={uploadOpen} onClose={() => setUploadOpen(false)} /> : null}
    </>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3.5 5.25h7.2L7.8 8.1l2.9 2.9H3.5z" fill="currentColor" />
        <path d="M20.5 18.75h-7.2l2.9-2.85-2.9-2.9h7.2z" fill="currentColor" />
        <path d="M9.4 12h5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
