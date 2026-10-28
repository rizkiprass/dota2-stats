// Item artwork on the Dota CDN, keyed by the item name without its `item_` prefix.
const ITEM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items";

export function itemImageUrl(item: string): string {
  return `${ITEM_CDN}/${item}.png`;
}

export function itemLabel(item: string): string {
  return item.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
