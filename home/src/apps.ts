import listed from '../apps.json';

/**
 * One card on the chooser. The list itself is `home/apps.json`, so that
 * `scripts/build.mjs` can check it too: every app listed there must have been
 * built, and its still must exist, or the build stops.
 */
export interface AppEntry {
  /** The app's folder under `apps/`, which is also its path on the site. */
  slug: string;
  name: string;
  /** One plain line under the name. */
  line: string;
  /** A picture of the app, in `home/public/stills/`. */
  still: string;
}

/**
 * Only finished apps are listed. An app that is still being built is deployed
 * at its own address but gets no card, for the same reason Above's era dial
 * gave up two dark stops: four finished places beat five with two unfinished.
 */
export const APPS: readonly AppEntry[] = listed;
