import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./components/Dashboard";

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

// Lazily loaded so Recharts and the profile view stay out of the dashboard chunk.
const playerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/player/$playerId",
  component: lazyRouteComponent(() => import("./components/PlayerProfile"), "PlayerProfile"),
});

const routeTree = rootRoute.addChildren([indexRoute, playerRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
