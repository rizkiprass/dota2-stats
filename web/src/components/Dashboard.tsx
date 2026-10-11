import { useDashboard } from "../lib/dashboard-context";
import { Summary } from "./Summary";
import { Leaderboards } from "./Leaderboards";
import { Players, Teammates, HeadToHead } from "./Tables";
import { Heroes } from "./Heroes";
import { ActivityLeaderboards } from "./Behavior";

export function Dashboard() {
  const { stats } = useDashboard();
  return (
    <main className="wrap">
      <Summary stats={stats} />
      <Leaderboards stats={stats} />
      <Players stats={stats} />
      <Heroes stats={stats} />
      <div className="split-grid" id="matchups">
        <Teammates stats={stats} />
        <HeadToHead stats={stats} />
      </div>
      <ActivityLeaderboards stats={stats} />
    </main>
  );
}
