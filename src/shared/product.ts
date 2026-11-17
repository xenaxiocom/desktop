/**
 * Xenaxio: which product this build is. One shell, two programs:
 *
 *  - "xenaxio": the whole Xenaxio (mail, calendar, files, Rooms, …) on app.xenaxio.com, a
 *    company portal (<company>.xenaxio.com), a company's own domain or an on-premise server.
 *  - "xenrooms": XenRooms, the team chat, always on xenrooms.app. Its page switches between
 *    the companies itself, so the shell never asks for a server.
 *
 * Both talk only to the Xenaxio platform: the shell runs in "instance" mode alone, a window
 * on the platform's address. Bulwark's "standalone" mode (a webmail server inside the app,
 * any JMAP server) is off: the Xenaxio client doesn't work without the platform.
 *
 * Chosen at build time (build.mjs, XENAXIO_PRODUCT). A build without it is Bulwark as
 * upstream ships it, which keeps upstream's own tests meaningful.
 *
 * No Electron here, so the rules can be tested in plain Node.
 */
import type { PolicyLayers } from './policy-schema';

export type ProductId = 'xenaxio' | 'xenrooms';

declare const __XENAXIO_PRODUCT__: string | undefined;

export interface ProductInfo {
  id: ProductId;
  /** The program's name: windows, menus, dialogs, the installer. */
  name: string;
  /** Where the first window opens. */
  startUrl: string;
  /** XenRooms opens on its own address and nothing else; Xenaxio lets people type their portal. */
  urlLocked: boolean;
  /** The product's site, for "About" and links that went to Bulwark's. */
  site: string;
  /**
   * Hosts a sign-in may send the window on to (the platform's hand-off to a company portal,
   * step 17): https and these only. Null: none.
   */
  portalHost: RegExp | null;
}

const PRODUCTS: Record<ProductId, ProductInfo> = {
  xenaxio: {
    id: 'xenaxio',
    name: 'Xenaxio',
    startUrl: 'https://app.xenaxio.com/',
    urlLocked: false,
    site: 'https://xenaxio.com',
    portalHost: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)xenaxio\.com$/,
  },
  xenrooms: {
    id: 'xenrooms',
    name: 'XenRooms',
    startUrl: 'https://xenrooms.app/',
    urlLocked: true,
    site: 'https://xenrooms.com',
    portalHost: null,
  },
};

export function productInfo(id: string | null | undefined): ProductInfo | null {
  return id === 'xenaxio' || id === 'xenrooms' ? PRODUCTS[id] : null;
}

/** This build's product; null in a plain Bulwark build. */
export const PRODUCT: ProductInfo | null = productInfo(typeof __XENAXIO_PRODUCT__ === 'string' ? __XENAXIO_PRODUCT__ : null);

/**
 * The product's own policies, under what an admin sets. They are the floor, not the ceiling:
 * an admin's policy of the same name still wins, so an on-premise customer can point the app
 * at their own server (InstanceUrl) without a build of their own.
 *
 * - AllowStandalone off (forced): there is no Xenaxio without the platform.
 * - Telemetry and crash reports off (forced): nothing goes to Bulwark's collector, and the
 *   first run doesn't ask about it.
 * - InstanceUrl: XenRooms forced to xenrooms.app; Xenaxio only recommended, so the first
 *   screen offers app.xenaxio.com and people can type their portal instead.
 */
export function withProductPolicies(layers: PolicyLayers, product: ProductInfo | null = PRODUCT): PolicyLayers {
  if (!product) return layers;
  const forced: Record<string, unknown> = {
    AllowStandalone: false,
    TelemetryAllowed: false,
    CrashReportsAllowed: false,
    ...(product.urlLocked ? { InstanceUrl: product.startUrl } : {}),
  };
  const recommended: Record<string, unknown> = product.urlLocked ? {} : { InstanceUrl: product.startUrl };
  const set = (layer: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(layer, key);
  const machineForced = { ...layers.forcedMachine } as Record<string, unknown>;
  for (const [key, value] of Object.entries(forced)) {
    if (!set(layers.forcedMachine, key) && !set(layers.forcedUser, key)) machineForced[key] = value;
  }
  const machineRecommended = { ...layers.recommendedMachine } as Record<string, unknown>;
  for (const [key, value] of Object.entries(recommended)) {
    if (!set(layers.recommendedMachine, key) && !set(layers.recommendedUser, key)) machineRecommended[key] = value;
  }
  return { ...layers, forcedMachine: machineForced as PolicyLayers['forcedMachine'], recommendedMachine: machineRecommended as PolicyLayers['recommendedMachine'] };
}

/**
 * The platform's sign-in on app.xenaxio.com hands the session to the company's portal
 * (another origin, with a one-time link). A window on one origin can't follow it: the
 * bridge and the stored sign-in belong to that origin. So the app makes the portal its
 * server and starts again on that link. Returns the portal's origin, or null when `target`
 * is not such a portal.
 */
export function portalHop(currentOrigin: string, target: URL, product: ProductInfo | null = PRODUCT): string | null {
  if (!product?.portalHost) return null;
  if (target.protocol !== 'https:' || target.username || target.password || target.port) return null;
  if (target.origin === currentOrigin) return null;
  return product.portalHost.test(target.hostname) ? target.origin : null;
}

/** How long the link of a hop stays good for the restart that follows it. */
export const HOP_MAX_AGE_MS = 2 * 60_000;

export interface HopMark {
  origin: string;
  url: string;
  at: number;
}

/** The link to open once after a hop, if it is for this origin and fresh. Anything else: null. */
export function hopUrlFrom(mark: unknown, origin: string, now: number): string | null {
  if (!mark || typeof mark !== 'object') return null;
  const { origin: markOrigin, url, at } = mark as Partial<HopMark>;
  if (markOrigin !== origin || typeof url !== 'string' || typeof at !== 'number') return null;
  if (at > now || now - at > HOP_MAX_AGE_MS) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
