import slugs from "./hero-slugs.json";

// Hero artwork on the Dota CDN, keyed by hero_id -> internal slug.
const HERO_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";
const HERO_SLUGS: Record<string, string> = slugs;

export function heroSlug(heroId: number | string | null | undefined): string | null {
  if (heroId === null || heroId === undefined) return null;
  return HERO_SLUGS[String(heroId)] ?? null;
}

// Square crop, ideal for avatar tiles (null when the hero is unknown).
export function heroCropUrl(heroId: number | string | null | undefined): string | null {
  const slug = heroSlug(heroId);
  return slug ? `${HERO_CDN}/crops/${slug}.png` : null;
}

// Wide portrait.
export function heroPortraitUrl(heroId: number | string | null | undefined): string | null {
  const slug = heroSlug(heroId);
  return slug ? `${HERO_CDN}/${slug}.png` : null;
}

// Deterministic avatar tint token from a seed string.
const AVATAR_TINTS = ["--av1", "--av2", "--av3", "--av4", "--av5", "--av6"];

export function tintFor(seed: string | null | undefined): string {
  let hash = 0;
  const text = String(seed ?? "");
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `var(${AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length]})`;
}
