// Xenaxio: the two programs built from this shell (src/shared/product.ts, scripts/xenaxio-*.cjs).
import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EMPTY_POLICY_LAYERS, resolvePolicies } from '../src/shared/policy-schema';
import { HOP_MAX_AGE_MS, hopUrlFrom, portalHop, productInfo, withProductPolicies } from '../src/shared/product';
import { decideStart } from '../src/main/policy-start';
import { configUrls } from '../src/main/instance-check';

const require = createRequire(import.meta.url);
const { productFor, brandSource } = require('../scripts/xenaxio-product.cjs');

const xenaxio = productInfo('xenaxio')!;
const xenrooms = productInfo('xenrooms')!;
const start = (snapshot: ReturnType<typeof resolvePolicies>) => decideStart(snapshot, null, {});

test.describe('product policies', () => {
  test('Xenaxio opens app.xenaxio.com, no standalone, no telemetry; another address stays possible', () => {
    const snapshot = resolvePolicies(withProductPolicies(EMPTY_POLICY_LAYERS, xenaxio));
    expect(snapshot.AllowStandalone).toMatchObject({ value: false, locked: true });
    expect(snapshot.TelemetryAllowed).toMatchObject({ value: false, locked: true });
    expect(snapshot.CrashReportsAllowed).toMatchObject({ value: false, locked: true });
    expect(snapshot.InstanceUrl).toMatchObject({ value: 'https://app.xenaxio.com/', locked: false });
    expect(start(snapshot)).toEqual({ kind: 'instance', url: 'https://app.xenaxio.com/', forced: false, canSwitch: true });
  });

  test('XenRooms is always xenrooms.app', () => {
    const snapshot = resolvePolicies(withProductPolicies(EMPTY_POLICY_LAYERS, xenrooms));
    expect(snapshot.InstanceUrl).toMatchObject({ value: 'https://xenrooms.app/', locked: true });
    expect(start(snapshot)).toEqual({ kind: 'instance', url: 'https://xenrooms.app/', forced: true, canSwitch: false });
  });

  test("an admin's policy wins over the product's (on-premise)", () => {
    const layers = { ...EMPTY_POLICY_LAYERS, forcedMachine: { InstanceUrl: 'https://mail.firma.de/' } };
    const snapshot = resolvePolicies(withProductPolicies(layers, xenrooms));
    expect(snapshot.InstanceUrl).toMatchObject({ value: 'https://mail.firma.de/', locked: true });
    expect(snapshot.AllowStandalone).toMatchObject({ value: false, locked: true });
  });

  test('a plain Bulwark build is left alone', () => {
    expect(withProductPolicies(EMPTY_POLICY_LAYERS, null)).toBe(EMPTY_POLICY_LAYERS);
  });
});

test.describe('hop to the company portal', () => {
  const here = 'https://app.xenaxio.com';
  test('to a portal under xenaxio.com, over https only', () => {
    expect(portalHop(here, new URL('https://acme.xenaxio.com/api/auth/handoff?t=1'), xenaxio)).toBe('https://acme.xenaxio.com');
    expect(portalHop(here, new URL('http://acme.xenaxio.com/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://acme.xenaxio.com:8443/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://user:pw@acme.xenaxio.com/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://xenaxio.com.evil.example/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://evil-xenaxio.com/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://a.b.xenaxio.com/'), xenaxio)).toBeNull();
    expect(portalHop(here, new URL('https://app.xenaxio.com/mail'), xenaxio)).toBeNull();
  });

  test('never in XenRooms or a Bulwark build', () => {
    expect(portalHop('https://xenrooms.app', new URL('https://acme.xenaxio.com/'), xenrooms)).toBeNull();
    expect(portalHop(here, new URL('https://acme.xenaxio.com/'), null)).toBeNull();
  });

  test('the hand-off link opens once, on that portal, while fresh', () => {
    const origin = 'https://acme.xenaxio.com';
    const mark = { origin, url: `${origin}/api/auth/handoff?t=1`, at: 1_000 };
    expect(hopUrlFrom(mark, origin, 2_000)).toBe(mark.url);
    expect(hopUrlFrom(mark, 'https://other.xenaxio.com', 2_000)).toBeNull();
    expect(hopUrlFrom(mark, origin, 1_000 + HOP_MAX_AGE_MS + 1)).toBeNull();
    expect(hopUrlFrom({ ...mark, url: 'https://evil.example/' }, origin, 2_000)).toBeNull();
    expect(hopUrlFrom('nonsense', origin, 2_000)).toBeNull();
  });
});

test('the Lite config is asked too, in a product build only', () => {
  expect(configUrls('https://acme.xenaxio.com/', xenaxio)).toEqual(['https://acme.xenaxio.com/api/config', 'https://acme.xenaxio.com/config.json']);
  expect(configUrls('https://acme.xenaxio.com/', null)).toEqual(['https://acme.xenaxio.com/api/config']);
});

test.describe('build-time names', () => {
  test('the product comes from XENAXIO_PRODUCT; test builds stay Bulwark unless asked', () => {
    expect(productFor({}, false).id).toBe('xenaxio');
    expect(productFor({ XENAXIO_PRODUCT: 'xenrooms' }, false).id).toBe('xenrooms');
    expect(productFor({}, true)).toBeNull();
    expect(productFor({ XENAXIO_PRODUCT: 'xenaxio' }, true).id).toBe('xenaxio');
    expect(() => productFor({ XENAXIO_PRODUCT: 'other' }, false)).toThrow();
  });

  test("text takes the product's name; the bridge keeps Bulwark's", () => {
    const product = productFor({ XENAXIO_PRODUCT: 'xenrooms' }, false);
    const text = "title: 'Bulwark', a: 'Vraťte se do Bulwarku', b: window.bulwarkDesktop, c: 'bulwark:menu.popup', d: looksLikeBulwarkConfig, e: 'https://bulwarkmail.org/docs'";
    expect(brandSource(text, 'src/main/strings.ts', product)).toBe(
      "title: 'XenRooms', a: 'Vraťte se do XenRooms', b: window.bulwarkDesktop, c: 'bulwark:menu.popup', d: looksLikeBulwarkConfig, e: 'https://xenrooms.com'",
    );
    expect(brandSource("DEEP_LINK_SCHEME = 'bulwark'", 'src/main/deep-link.ts', product)).toBe("DEEP_LINK_SCHEME = 'xenrooms'");
    expect(brandSource("const OWNER = 'bulwarkmail';", 'src/main/features/updater.ts', product)).toBe("const OWNER = 'xenaxiocom';");
    expect(brandSource(text, 'src/main/strings.ts', null)).toBe(text);
  });

  test('every place the scheme and policy names are rewritten still exists upstream', () => {
    // When upstream renames one of these, the build would quietly keep Bulwark's: this says so.
    expect(readFileSync('src/main/features/updater.ts', 'utf8')).toContain("const OWNER = 'bulwarkmail';");
    expect(readFileSync('src/main/deep-link.ts', 'utf8')).toContain("DEEP_LINK_SCHEME = 'bulwark'");
    expect(readFileSync('src/main/features/os-default-app.ts', 'utf8')).toContain("app.setAsDefaultProtocolClient('bulwark')");
    expect(readFileSync('src/main/features/os-rules.ts', 'utf8')).toMatch(/progId\('bulwark',/);
    expect(readFileSync('src/main/features/os-rules.ts', 'utf8')).toMatch(/, 'bulwark'\]\.map/);
    expect(readFileSync('src/shared/policy-schema.ts', 'utf8')).toContain('org.bulwarkmail.desktop');
    expect(readFileSync('src/shared/policy-schema.ts', 'utf8')).toContain('/etc/bulwark/');
  });
});

test.describe('packaging', () => {
  for (const id of ['xenaxio', 'xenrooms'] as const) {
    test(`${id}: its own app id, name, update feed and no webmail server`, () => {
      process.env.XENAXIO_PRODUCT = id;
      const path = require.resolve('../scripts/xenaxio-builder-config.cjs');
      delete require.cache[path];
      const config = require(path);
      delete process.env.XENAXIO_PRODUCT;
      const product = productFor({ XENAXIO_PRODUCT: id }, false);
      expect(config.appId).toBe(product.appId);
      expect(config.productName).toBe(product.name);
      expect(config.publish).toMatchObject({ provider: 'github', owner: 'xenaxiocom', repo: 'desktop' });
      expect(config.msi.upgradeCode).toBe(product.msiUpgradeCode);
      expect(JSON.stringify(config.extraResources)).not.toContain('server');
      expect(JSON.stringify(config)).not.toMatch(/\bBulwark(?! Project Authors)\b/);
      if (id === 'xenrooms') expect(JSON.stringify(config.mac.protocols)).not.toContain('mailto');
      expect(config.publish.channel).toBe(id === 'xenrooms' ? 'xenrooms' : undefined);
    });
  }
});
