import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "./lib/api";
import { DashboardContext } from "./lib/dashboard-context";
import { Header } from "./components/Header";
import { Summary } from "./components/Summary";
import { Leaderboards } from "./components/Leaderboards";
import { Players, Teammates, HeadToHead } from "./components/Tables";
import { Heroes } from "./components/Heroes";
import { PlayerDrawer } from "./components/PlayerDrawer";

function playerIdFromHash(): string | null {
  const match = decodeURIComponent(window.location.hash || "").match(/player=([^&]+)/);
  return match ? match[1] : null;
}

export default function App() {
  const { data: stats, error, isLoading } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const [selected, setSelected] = useState<string | null>(null);

  // Open the player in the URL hash on load, and follow hash changes.
  useEffect(() => {
    if (!stats) return;
    const initial = playerIdFromHash();
    if (initial && stats.players[initial]) setSelected(initial);

    const onHash = () => {
      const id = playerIdFromHash();
      if (id && stats.players[id]) setSelected(id);
      else setSelected(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [stats]);

  const openPlayer = (id: string) => {
    setSelected(id);
    if (playerIdFromHash() !== id) {
      window.history.replaceState(null, "", `#player=${encodeURIComponent(id)}`);
    }
  };

  const closePlayer = () => {
    setSelected(null);
    if (playerIdFromHash()) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  if (isLoading) {
    return <p className="status">Loading statistics…</p>;
  }
  if (error || !stats) {
    return <p className="status">Could not load stats.json ({String(error)}). Make sure the aggregator has published it.</p>;
  }

  return (
    <DashboardContext.Provider value={{ stats, openPlayer }}>
      <Header stats={stats} />
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
      <footer className="site-footer">
        <div className="wrap">
          Dota 2 private-lobby statistics · built from replays parsed and aggregated on AWS.
        </div>
      </footer>
      <PlayerDrawer playerId={selected} onClose={closePlayer} />
    </DashboardContext.Provider>
  );
}
