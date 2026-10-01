import { Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "../lib/api";
import { DashboardContext } from "../lib/dashboard-context";
import { Header } from "./Header";

export function RootLayout() {
  const { data: stats, error, isLoading } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });

  if (isLoading) return <p className="status">Loading statistics…</p>;
  if (error || !stats) {
    return (
      <p className="status">
        Could not load stats.json ({String(error)}). Make sure the aggregator has published it.
      </p>
    );
  }

  return (
    <DashboardContext.Provider value={{ stats }}>
      <Header stats={stats} />
      <Outlet />
      <footer className="site-footer">
        <div className="wrap">
          Dota 2 private-lobby statistics · built from replays parsed and aggregated on AWS.
        </div>
      </footer>
    </DashboardContext.Provider>
  );
}
