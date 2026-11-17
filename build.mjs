// Bundles the shell into dist/: main as ESM (top-level await), the preloads and the
// server host as CommonJS (a sandboxed preload can't be ESM, and the host loads Next
// with require). esbuild is what the webmail uses too.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { addonPins } from './scripts/addon-pins.mjs';
import { APP_ICON_FILE, APP_ICON_SOURCE, TASK_ICON_FOLDER } from './scripts/task-icons.mjs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/pages', { recursive: true });
cpSync('assets/os', `dist/${TASK_ICON_FOLDER}`, { recursive: true });
// The Files drive's icon, where a build from source looks for it (features/files-drive.ts).
cpSync(APP_ICON_SOURCE, `dist/${TASK_ICON_FOLDER}/${APP_ICON_FILE}`);

const testBuildFlag = process.argv.includes('--test');
// xenaxio: which program this is (scripts/xenaxio-product.cjs); null keeps Bulwark's names.
const { productFor, brandSource } = createRequire(import.meta.url)('./scripts/xenaxio-product.cjs');
const product = productFor(process.env, testBuildFlag);
const brandPlugin = {
  name: 'xenaxio-brand',
  setup(b) {
    if (!product) return;
    b.onLoad({ filter: /[\\/]src[\\/].*\.(ts|json)$/ }, (args) => ({
      contents: brandSource(readFileSync(args.path, 'utf8'), args.path, product),
      loader: args.path.endsWith('.json') ? 'json' : 'ts',
    }));
  },
};

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: false, logLevel: 'warning', plugins: [brandPlugin], define: { __XENAXIO_PRODUCT__: JSON.stringify(product?.id ?? '') } };

// BULWARK_UPDATER_TEST_BUILD=1 keeps the updater's test switches. In any other build the
// constant is false and the code behind it is gone (test/updater-rules.spec.ts checks).
const updaterTest = process.env.BULWARK_UPDATER_TEST_BUILD === '1';
// `--test` lets the app read a stand-in policy root. A package is never built with it:
// scripts/after-pack.cjs fails on one. It has to be the build, not a run-time check,
// since Electron decides app.isPackaged by the name of the exe, and anyone can rename it.
const testBuild = testBuildFlag;
// Behaves as production, with its profile compiled in: a test of what production does
// mustn't touch the real profile, and no switch may move it. See scripts/pack-test.mjs.
const bakedProfile = process.argv.find((arg) => arg.startsWith('--baked-profile='))?.slice('--baked-profile='.length) ?? '';

await build({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main.mjs',
  format: 'esm',
  // A native module, loaded at run time from node_modules.
  external: ['electron', '@vscode/policy-watcher'],
  define: { ...common.define, __BULWARK_ADDON_PINS__: JSON.stringify(addonPins(process.cwd())), __BULWARK_TEST_BUILD__: String(testBuild), __BULWARK_TEST_PROFILE__: JSON.stringify(bakedProfile), __BULWARK_UPDATER_TEST__: String(updaterTest) },
  // Takes out what's behind the false above, and the functions only it used.
  minifySyntax: true,
});
// electron-updater in a file of its own, loaded some time after the window is up. Bundled
// so that a package has no node_modules for this, and the first paint doesn't pay for it.
await build({ ...common, entryPoints: ['node_modules/electron-updater/out/main.js'], outfile: 'dist/updater-lib.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/welcome.ts'], outfile: 'dist/welcome-preload.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/dialog.ts'], outfile: 'dist/dialog-preload.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/print.ts'], outfile: 'dist/print-preload.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/server/host.ts'], outfile: 'dist/server-host.cjs', format: 'cjs' });
// Run at package time only (scripts/server-archive.mjs), and left out of app.asar.
await build({ ...common, entryPoints: ['src/server/code-cache-gen.ts'], outfile: 'dist/code-cache-gen.cjs', format: 'cjs' });
await build({ ...common, entryPoints: ['src/main/import-worker.ts'], outfile: 'dist/import-worker.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/main/recent-files-worker.ts'], outfile: 'dist/recent-files-worker.cjs', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/main/crash-scrub-host.ts'], outfile: 'dist/crash-scrub-host.cjs', format: 'cjs', external: ['electron'] });

// Main loads this as a data: page, so the script goes inside it, allowed by its hash.
// LF: an HTML parser turns CRLF into LF before the hash is checked, so a Windows
// checkout's line endings would get its own script refused.
// Its strings, all languages, go in as one line of JSON.
const welcomeStrings = JSON.stringify(JSON.parse(brandSource(readFileSync('src/pages/welcome-strings.json', 'utf8'), 'src/pages/welcome-strings.json', product)));
const script = brandSource(readFileSync('src/pages/welcome.js', 'utf8'), 'src/pages/welcome.js', product)
  .replace(/\r\n/g, '\n')
  .replace('__WELCOME_STRINGS__', () => welcomeStrings);
const hash = createHash('sha256').update(script).digest('base64');
const page = brandSource(readFileSync('src/pages/welcome.html', 'utf8'), 'src/pages/welcome.html', product)
  .replace("script-src 'self'", `script-src 'sha256-${hash}'`)
  .replace('<script src="welcome.js"></script>', () => `<script>${script}</script>`);
writeFileSync('dist/pages/welcome.html', page);

// The dialog window's page (src/main/dialog-window.ts), built the same way.
const dialogScript = readFileSync('src/pages/dialog.js', 'utf8').replace(/\r\n/g, '\n');
const dialogHash = createHash('sha256').update(dialogScript).digest('base64');
const dialogPage = brandSource(readFileSync('src/pages/dialog.html', 'utf8'), 'src/pages/dialog.html', product)
  .replace("script-src 'self'", `script-src 'sha256-${dialogHash}'`)
  .replace('<script src="dialog.js"></script>', () => `<script>${dialogScript}</script>`);
writeFileSync('dist/pages/dialog.html', dialogPage);

// The print preview's page (src/main/print-preview.ts), built the same way.
const printScript = readFileSync('src/pages/print.js', 'utf8').replace(/\r\n/g, '\n');
const printHash = createHash('sha256').update(printScript).digest('base64');
const printPage = brandSource(readFileSync('src/pages/print.html', 'utf8'), 'src/pages/print.html', product)
  .replace("script-src 'self'", `script-src 'sha256-${printHash}'`)
  .replace('<script src="print.js"></script>', () => `<script>${printScript}</script>`);
writeFileSync('dist/pages/print.html', printPage);
writeFileSync('dist/product.json', JSON.stringify({ product: product?.id ?? null }));
if (testBuild || bakedProfile) writeFileSync('dist/test-build.json', JSON.stringify({ testBuild, bakedProfile }));
