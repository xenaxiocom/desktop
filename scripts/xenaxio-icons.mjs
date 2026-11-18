#!/usr/bin/env node
// Xenaxio: the app icons in build/ from the Xenaxio mark (one mark for Xenaxio and XenRooms,
// step 67). Run by hand when the mark changes; the results are committed, like Bulwark's
// (scripts/make-icons.mjs, whose ICO and ICNS writers this reuses by copy).
//
//   node scripts/xenaxio-icons.mjs --any <mark 512 png, transparent> --mac <mark on its dark field, 512 png> --webmail <webmail checkout>
//
// The webmail has both: public/xenrooms/icon-512.png and public/xenrooms/icon-maskable-512.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`--${name} is required`);
  return path.resolve(process.argv[index + 1]);
};
const sharp = createRequire(path.join(option('webmail'), 'package.json'))('sharp');
const any = readFileSync(option('any'));
const mac = readFileSync(option('mac'));

const render = (input, size) => sharp(input).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();

async function bitmapEntry(input, size) {
  const raw = await sharp(input).resize(size, size).ensureAlpha().raw().toBuffer();
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = raw[from + 2];
      pixels[to + 1] = raw[from + 1];
      pixels[to + 2] = raw[from];
      pixels[to + 3] = raw[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]);
}

async function ico(input, sizes, { png = false } = {}) {
  const entries = [];
  for (const size of sizes) entries.push({ size, data: png || size >= 256 ? await render(input, size) : await bitmapEntry(input, size) });
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, index) => {
    const at = 6 + 16 * index;
    head[at] = size >= 256 ? 0 : size;
    head[at + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((entry) => entry.data)]);
}

/** Apple's grid: the field 824 of 1024 with its corner; the dark field is part of the mark. */
async function macMaster() {
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="824" height="824"><rect width="824" height="824" rx="185" ry="185"/></svg>');
  const field = await sharp(mac).resize(824, 824).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: field, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}

async function icns(master) {
  const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = [];
  for (const [type, size] of types) {
    const data = size === 1024 ? master : await sharp(master).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(data.length + 8, 4);
    chunks.push(head, data);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

const out = path.join(ROOT, 'build');
mkdirSync(path.join(out, 'icons'), { recursive: true });
writeFileSync(path.join(out, 'icon.ico'), await ico(any, [16, 20, 24, 32, 40, 48, 64, 128, 256]));
writeFileSync(path.join(out, 'installer-logo.ico'), await ico(any, [96, 120, 144, 168, 192, 216, 240, 256], { png: true }));
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(path.join(out, 'icons', `${size}x${size}.png`), await render(any, size));
}
writeFileSync(path.join(out, 'icon.png'), await render(any, 1024));
writeFileSync(path.join(out, 'icon.icns'), await icns(await macMaster()));
// The tray: the mark's shape in one colour, as Bulwark's (scripts/make-os-icons.cjs), from its alpha.
async function silhouette(size, [r, g, b]) {
  const alpha = await sharp(any).resize(size, size).ensureAlpha().extractChannel(3).raw().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } }).joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
}
const os = path.join(ROOT, 'assets', 'os');
for (const size of [16, 20, 22, 24, 32, 40, 44, 48]) {
  writeFileSync(path.join(os, `tray-light-${size}.png`), await silhouette(size, [255, 255, 255]));
  writeFileSync(path.join(os, `tray-dark-${size}.png`), await silhouette(size, [24, 24, 27]));
}
writeFileSync(path.join(os, 'trayTemplate.png'), await silhouette(16, [0, 0, 0]));
writeFileSync(path.join(os, 'trayTemplate@2x.png'), await silhouette(32, [0, 0, 0]));
console.log(`[xenaxio-icons] wrote ${out}`);
