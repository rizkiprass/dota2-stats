import { useDashboard } from "../lib/dashboard-context";
import { Summary } from "./Summary";
import { RecentMatches } from "./RecentMatches";
import { Leaderboards } from "./Leaderboards";

export function Dashboard() {
  const { stats } = useDashboard();
  return (
    <main className="wrap">
      <Summary stats={stats} />
      <RecentMatches />
      <Leaderboards stats={stats} overview />
    </main>
  );
}
