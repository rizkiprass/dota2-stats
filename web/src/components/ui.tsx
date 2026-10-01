import { useState, type CSSProperties, type ReactNode } from "react";
import { heroCropUrl, tintFor } from "../lib/heroes";
import { initials } from "../lib/format";
import { playerName, playerTopHero } from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";

/* ---------------- icons ---------------- */

const ICON_PATHS = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5v-1a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5v1"/>' +
    '<path d="M16 4.6a3.2 3.2 0 0 1 0 6.1"/><path d="M17.4 13.6a5 5 0 0 1 3.1 4.6v1.3"/>',
  sparkles:
    '<path d="M12 3.5 13.6 8l4.5 1.6-4.5 1.6L12 15.7l-1.6-4.5L5.9 9.6 10.4 8z"/>' +
    '<path d="M18.5 15.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3 2"/>',
  scale: '<path d="M12 3.5v17"/><path d="M6 7h12"/><path d="M5.5 7 3 13h5z"/><path d="M18.5 7 21 13h-5z"/>',
  check: '<path d="m5 12.6 4.2 4.2L19 7"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}

export function Tile({ icon, variant = "" }: { icon: IconName; variant?: "sm" | "gold" | "green" | "" }) {
  return (
    <div className={`tile ${variant}`.trim()}>
      <Icon name={icon} />
    </div>
  );
}

/* ---------------- bars & badges ---------------- */

export function Bar({ pct, gold = false }: { pct: number; gold?: boolean }) {
  const width = Math.max(2, Math.min(100, pct || 0));
  return (
    <div className={`bar${gold ? " gold" : ""}`}>
      <i style={{ width: `${width}%` }} />
    </div>
  );
}

export function Badge({ label, tone }: { label: string; tone?: "b1" | "b2" | "b3" }) {
  return <span className={`badge${tone ? ` ${tone}` : ""}`}>{label}</span>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}

/* ---------------- avatars ---------------- */

function useHeroImage(heroId: number | null) {
  const url = heroCropUrl(heroId);
  const [failed, setFailed] = useState(false);
  const isInitial = !url || failed;
  return { url, isInitial, fail: () => setFailed(true) };
}

function avatarClass(base: string, size: string, isInitial: boolean) {
  return `${base} ${size}${isInitial ? " initial" : ""}`.replace(/\s+/g, " ").trim();
}

function initialStyle(name: string, isInitial: boolean): CSSProperties | undefined {
  return isInitial ? ({ "--av": tintFor(name) } as CSSProperties) : undefined;
}

export function Avatar({
  heroId = null,
  name,
  size = "",
}: {
  heroId?: number | null;
  name: string;
  size?: "sm" | "lg" | "";
}) {
  const { url, isInitial, fail } = useHeroImage(heroId);
  return (
    <span className={avatarClass("avatar", size, isInitial)} style={initialStyle(name, isInitial)}>
      {url && !isInitial ? (
        <img src={url} alt={name} loading="lazy" decoding="async" onError={fail} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function PlayerAvatar({ id, size = "" }: { id: string; size?: "sm" | "lg" | "" }) {
  const { stats, openPlayer } = useDashboard();
  const name = playerName(stats, id);
  const { url, isInitial, fail } = useHeroImage(playerTopHero(stats, id));
  return (
    <button
      type="button"
      className={avatarClass("avatar player-link", size, isInitial)}
      style={initialStyle(name, isInitial)}
      title={`View ${name}'s details`}
      onClick={() => openPlayer(id)}
    >
      {url && !isInitial ? (
        <img src={url} alt={name} loading="lazy" decoding="async" onError={fail} />
      ) : (
        initials(name)
      )}
    </button>
  );
}

export function AvatarPair({ a, b }: { a: string; b: string }) {
  return (
    <span className="avatar-pair">
      <PlayerAvatar id={a} />
      <PlayerAvatar id={b} />
    </span>
  );
}

/* ---------------- clickable names ---------------- */

export function PlayerName({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children?: ReactNode;
}) {
  const { stats, openPlayer } = useDashboard();
  const name = playerName(stats, id);
  return (
    <button
      type="button"
      className={`${className} player-link`.trim()}
      title={`View ${name}'s details`}
      onClick={() => openPlayer(id)}
    >
      {children ?? name}
    </button>
  );
}

export function PlayerCell({ id, sub }: { id: string; sub?: ReactNode }) {
  return (
    <span className="pcell">
      <PlayerAvatar id={id} />
      <span className="pinfo">
        <PlayerName id={id} className="pname" />
        {sub ? <span className="psub">{sub}</span> : null}
      </span>
    </span>
  );
}
