// Xenaxio: what differs between the two programs built from this shell, for the build
// (build.mjs) and the packaging (scripts/xenaxio-builder-config.cjs). The run-time side is
// src/shared/product.ts.
//
// XENAXIO_PRODUCT=xenaxio (the default for a release build) or xenrooms. `--test` builds
// stay Bulwark as upstream has it, unless XENAXIO_PRODUCT is set: upstream's tests read
// its own names.
'use strict';

const PRODUCTS = {
  xenaxio: {
    id: 'xenaxio',
    name: 'Xenaxio',
    appId: 'com.xenaxio.desktop',
    scheme: 'xenaxio',
    site: 'https://xenaxio.com',
    description: 'Xenaxio for the desktop',
    // MSI upgrade code: one per product, never changed once released.
    msiUpgradeCode: '3F6B1C2E-8A4D-4F7B-9C21-5E0D7A9B4C13',
  },
  xenrooms: {
    id: 'xenrooms',
    name: 'XenRooms',
    appId: 'com.xenaxio.xenrooms',
    scheme: 'xenrooms',
    site: 'https://xenrooms.com',
    description: 'XenRooms, the team chat by Xenaxio',
    msiUpgradeCode: 'A2D94E71-0C3B-4B65-8F1E-7D28C5B6E9A4',
  },
};

const SOURCE = 'https://github.com/xenaxiocom/desktop';

/** The product of this build, or null for a plain Bulwark build. */
function productFor(env = process.env, testBuild = false) {
  const raw = env.XENAXIO_PRODUCT;
  if (raw === 'none' || (!raw && testBuild)) return null;
  const id = raw || 'xenaxio';
  const product = PRODUCTS[id];
  if (!product) throw new Error(`XENAXIO_PRODUCT must be xenaxio or xenrooms, not ${raw}`);
  return product;
}

/**
 * Bulwark's names in the shell's own text, made the product's: titles, menus, dialogs, the
 * first-run page, the policy's registry and file places, the app's URL scheme. The bridge to
 * the page (`window.bulwarkDesktop`, the `bulwark:` IPC channels) keeps its names: the
 * Xenaxio web client is a Bulwark webmail and expects them.
 */
function brandSource(text, file, product) {
  if (!product) return text;
  const normal = file.replace(/\\/g, '/');
  let out = text
    .replace(/https:\/\/github\.com\/bulwarkmail\/desktop/g, SOURCE)
    .replace(/https:\/\/bulwarkmail\.org(?:\/[^\s'"`)<]*)?/g, product.site)
    // Inflected forms in other languages ("do Bulwarku", "Bulwarkhoz") take the plain name.
    .replace(/\bBulwark(?:(?: Mail| Webmail| Desktop)\b|[a-z\u00C0-\u024F]+\b|\b)/g, product.name);
  if (normal.endsWith('src/shared/policy-schema.ts')) {
    out = out.replace(/org\.bulwarkmail\.desktop/g, product.appId).replace(/\/etc\/bulwark\//g, `/etc/${product.id}/`);
  }
  if (normal.endsWith('src/main/deep-link.ts')) {
    out = out.replace("DEEP_LINK_SCHEME = 'bulwark'", `DEEP_LINK_SCHEME = '${product.scheme}'`);
  }
  if (normal.endsWith('src/main/features/os-default-app.ts')) {
    out = out.replace("app.setAsDefaultProtocolClient('bulwark')", `app.setAsDefaultProtocolClient('${product.scheme}')`);
  }
  if (normal.endsWith('src/main/features/os-rules.ts')) {
    out = out
      .replace(/progId\('bulwark',/g, `progId('${product.scheme}',`)
      .replace(/, 'bulwark'\]\.map/g, `, '${product.scheme}'].map`)
      .replace(/Icon=bulwark\b/g, `Icon=${product.id}`);
  }
  return out;
}

module.exports = { PRODUCTS, SOURCE, productFor, brandSource };
