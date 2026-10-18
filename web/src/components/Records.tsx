import { useDashboard } from "../lib/dashboard-context";
import { ActivityLeaderboards } from "./Behavior";
import { Heroes } from "./Heroes";
import { HeadToHead, Players, Teammates } from "./Tables";

export function Records() {
  const { stats } = useDashboard();

  return (
    <main className="wrap records-page">
      <div className="page-head">
        <h2>Records</h2>
        <p>Browse the full player, hero, partnership, and rivalry history.</p>
      </div>
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
