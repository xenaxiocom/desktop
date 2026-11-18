// Xenaxio: electron-builder's configuration for this build's product, made from Bulwark's
// electron-builder.yml so that upstream's changes there carry over by themselves.
//
//   XENAXIO_PRODUCT=xenrooms npx electron-builder --config scripts/xenaxio-builder-config.cjs --linux
//
// The NSIS scripts (build/*.nsh) name the product in their own text; branded copies go into
// .xenaxio-build/nsis and the installer includes those.
'use strict';

const { mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { productFor, SOURCE } = require('./xenaxio-product.cjs');

const ROOT = path.resolve(__dirname, '..');

/** Bulwark's names in a packaging text, the product's. Lower-case ids are handled one by one. */
function brandPackaging(text, product) {
  return text
    .replace(/org\.bulwarkmail\.desktop/g, product.appId)
    .replace(/https:\/\/github\.com\/bulwarkmail\/desktop/g, SOURCE)
    .replace(/https:\/\/bulwarkmail\.org(?:\/[^\s'"`)<]*)?/g, product.site)
    .replace(/<dev@bulwarkmail\.org>/g, '<hello@xenaxio.com>')
    .replace(/\bBulwark Project Authors\b/g, 'Xenaxio and the \u0000 Project Authors')
    .replace(/\bBulwark(?: Mail| Webmail| Desktop)?\b/g, product.name)
    .replace(/\u0000/g, 'Bulwark');
}

function config(env = process.env) {
  const product = productFor(env, false);
  const text = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  const base = yaml.load(brandPackaging(text, product));

  base.appId = product.appId;
  // No webmail server inside: standalone mode is off for both products. The hooks read this
  // (scripts/before-pack.cjs, after-pack.cjs). Bulwark's policy templates (from the webmail)
  // name Bulwark's keys, so they stay out too until there are Xenaxio ones.
  process.env.XENAXIO_NO_SERVER = '1';
  // The MSI hooks name the product's policy key (scripts/msi-policies.cjs).
  process.env.XENAXIO_PRODUCT = product.id;
  base.extraResources = (base.extraResources ?? []).filter((r) => typeof r === 'string' || (r.from !== 'policies' && !String(r.from).startsWith('.server-build')));
  base.productName = product.name;
  base.publish = { ...base.publish, provider: 'github', owner: 'xenaxiocom', repo: 'desktop', ...(product.id === 'xenrooms' ? { channel: 'xenrooms' } : {}) };
  if (base.msi) base.msi.upgradeCode = product.msiUpgradeCode;
  if (base.mac?.protocols) {
    base.mac.protocols = base.mac.protocols.map((p) => (Array.isArray(p.schemes) && p.schemes.includes('bulwark') ? { name: product.name, schemes: [product.scheme] } : p));
  }
  if (base.linux) base.linux.executableName = product.id;
  // XenRooms is a chat: it doesn't offer itself for mail, calendar files or contacts.
  if (product.id === 'xenrooms') {
    if (base.mac?.protocols) base.mac.protocols = base.mac.protocols.filter((p) => p.schemes.includes(product.scheme));
    if (base.mac) delete base.mac.fileAssociations;
    delete base.fileAssociations;
    if (base.linux) {
      delete base.linux.mimeTypes;
      delete base.linux.fileAssociations;
    }
  }
  // Two products side by side: the artifacts carry the name, the GitHub release holds both.
  if (base.nsis) {
    const nsisDir = path.join(ROOT, '.xenaxio-build', 'nsis');
    mkdirSync(nsisDir, { recursive: true });
    for (const name of readdirSync(path.join(ROOT, 'build')).filter((n) => n.endsWith('.nsh'))) {
      writeFileSync(path.join(nsisDir, name), brandPackaging(readFileSync(path.join(ROOT, 'build', name), 'utf8'), product));
    }
    base.nsis.include = path.relative(ROOT, path.join(nsisDir, 'installer.nsh')).split(path.sep).join('/');
  }
  return base;
}

// Only the configuration: electron-builder refuses any other property on it.
module.exports = config();
