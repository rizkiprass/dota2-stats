import { createContext, useContext } from "react";
import type { Stats } from "../types/stats";

export interface DashboardValue {
  stats: Stats;
  openPlayer: (id: string) => void;
}

export const DashboardContext = createContext<DashboardValue | null>(null);

export function useDashboard(): DashboardValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardContext");
  return ctx;
}
