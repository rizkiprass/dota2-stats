import { Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "../lib/api";
import { DashboardContext } from "../lib/dashboard-context";
import { Header } from "./Header";

export function RootLayout() {
  const { data: stats, error, isLoading, isFetching, refetch } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });

  if (isLoading) return <LoadingState />;
  if (error || !stats) {
    return (
      <main className="wrap error-wrap">
        <section className="card error-card" role="alert">
          <span className="error-mark" aria-hidden="true">!</span>
          <div className="error-content">
            <p className="error-eyebrow">Connection issue</p>
            <h1>We couldn’t load lobby stats</h1>
            <p className="error-message">Check your connection and try again. The latest dashboard data may not be available yet.</p>
            {error ? (
              <details className="error-details">
                <summary>Technical details</summary>
                <code>{error instanceof Error ? error.message : String(error)}</code>
              </details>
            ) : null}
            <button className="error-retry" type="button" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <DashboardContext.Provider value={{ stats }}>
      <div className="app-shell">
        <Header stats={stats} />
        <div className="app-content">
          <Outlet />
          <footer className="site-footer">
            <div className="wrap">
              Dota 2 private-lobby statistics · built from replays parsed and aggregated on AWS.
            </div>
          </footer>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-label="Loading dashboard statistics" aria-busy="true">
      <header className="site-header">
        <div className="wrap header-inner" aria-hidden="true">
          <span className="skeleton loading-brand-mark" />
          <div className="loading-brand-copy">
            <span className="skeleton loading-brand-title" />
            <span className="skeleton loading-brand-subtitle" />
          </div>
        </div>
      </header>
      <main className="wrap" aria-hidden="true">
        <section className="section">
          <div className="bento">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="card loading-panel" key={index}>
                <span className="skeleton loading-label" />
                <span className="skeleton loading-value" />
                <div className="loading-lines">
                  <span className="skeleton loading-line loading-line-wide" />
                  <span className="skeleton loading-line loading-line-medium" />
                  <span className="skeleton loading-line loading-line-short" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="section">
          <span className="skeleton loading-section-title" />
          <div className="board-grid">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="lb loading-board" key={index}>
                <span className="skeleton loading-board-title" />
                <div className="loading-lines">
                  <span className="skeleton loading-line loading-line-wide" />
                  <span className="skeleton loading-line loading-line-medium" />
                  <span className="skeleton loading-line loading-line-wide" />
                  <span className="skeleton loading-line loading-line-short" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
