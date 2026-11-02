import ITEM_NAMES from "./item-names.json";

// Item artwork on the Dota CDN, keyed by the item name without its `item_` prefix.
const ITEM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items";

export function itemImageUrl(item: string): string {
  return `${ITEM_CDN}/${item}.png`;
}

// Display names come from item-names.json (scripts/update-item-names.py). An
// item newer than that table falls back to its prettified key.
const NAMES: Record<string, string> = ITEM_NAMES;

export function itemLabel(item: string): string {
  return NAMES[item] ?? item.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
