// Item artwork on the Dota CDN, keyed by the item name without its `item_` prefix.
const ITEM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items";

export function itemImageUrl(item: string): string {
  return `${ITEM_CDN}/${item}.png`;
}

export function itemLabel(item: string): string {
  return item.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export interface PurchasedItem {
  item: string;
  count: number;
  firstTime: number;
}

// Collapse repeat buys into one entry, keeping the order of first purchase.
export function groupPurchases(items: Array<{ item: string; time: number }> | undefined): PurchasedItem[] {
  const grouped = new Map<string, PurchasedItem>();
  for (const { item, time } of items ?? []) {
    const existing = grouped.get(item);
    if (existing) existing.count += 1;
    else grouped.set(item, { item, count: 1, firstTime: time });
  }
  return [...grouped.values()];
}
