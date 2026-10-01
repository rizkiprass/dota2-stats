import { useDashboard } from "../lib/dashboard-context";
import { Summary } from "./Summary";
import { Leaderboards } from "./Leaderboards";
import { Players, Teammates, HeadToHead } from "./Tables";
import { Heroes } from "./Heroes";

export function Dashboard() {
  const { stats } = useDashboard();
  return (
    <main className="wrap">
      <Summary stats={stats} />
      <Leaderboards stats={stats} />
      <Players stats={stats} />
      <Heroes stats={stats} />
      <div className="split-grid">
        <Teammates stats={stats} />
        <HeadToHead stats={stats} />
      </div>
    </main>
  );
}
