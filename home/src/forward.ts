/**
 * Before Zenith was a collection, the view from above was the whole site, and
 * a link to a particular moment of it looks like `/zenith/?seed=7&era=citadel`.
 * That address is the chooser now. A link that carries one of Above's own URL
 * settings is sent on to Above with the same query, so it still opens the
 * moment it was made for. The list is fixed: it covers the links that were
 * made before the move, and Above's new links point at Above directly.
 */
const ABOVE_SETTINGS = ['seed', 'hour', 'pause', 'alt', 'at', 'era', 'day', 'scene'] as const;

/**
 * Where an old link should go, relative to the site's base, or `null` to stay
 * on the chooser. Pure, so it is tested without a browser.
 */
export function forwardTarget(search: string): string | null {
  const query = new URLSearchParams(search);
  if (!ABOVE_SETTINGS.some((key) => query.has(key))) return null;
  const kept = search.startsWith('?') ? search : `?${search}`;
  return `above/${kept}`;
}
