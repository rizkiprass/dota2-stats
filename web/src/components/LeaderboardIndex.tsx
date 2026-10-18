import { useDashboard } from "../lib/dashboard-context";
import { Leaderboards } from "./Leaderboards";

export function LeaderboardIndex() {
  const { stats } = useDashboard();

  return (
    <main className="wrap records-page">
      <div className="page-head">
        <h2>All leaderboards</h2>
        <p>Compare the lobby's strongest players, hero picks, duos, and rivalries.</p>
      </div>
      <Leaderboards stats={stats} />
    </main>
  );
}
