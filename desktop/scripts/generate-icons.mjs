/** Original Meetfolio vector → reproducible PNG, Windows ICO and NSIS BMP assets. */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const svg = await fs.readFile(path.join(assets, 'meetfolio.svg'));
const raster = size => sharp(svg).resize(size, size);
await raster(1024).png().toFile(path.join(assets, 'meetfolio.png'));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = [];
for (const size of sizes) {
  if (size === 256) { frames.push(await raster(size).png().toBuffer()); continue; }
  // DIB frames keep small icons compatible with NSIS/Explorer, including alpha and AND mask.
  const rgba = await raster(size).ensureAlpha().raw().toBuffer();
  const stride = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(40 + size * size * 4 + stride * size);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const src = (y * size + x) * 4; const dst = 40 + ((size - y - 1) * size + x) * 4;
    dib[dst] = rgba[src + 2]; dib[dst + 1] = rgba[src + 1]; dib[dst + 2] = rgba[src]; dib[dst + 3] = rgba[src + 3];
    if (rgba[src + 3] === 0) dib[40 + size * size * 4 + (size - y - 1) * stride + (x >> 3)] |= 0x80 >> (x % 8);
  }
  frames.push(dib);
}
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16; directory[entry] = sizes[i] % 256; directory[entry + 1] = sizes[i] % 256;
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frames[i].length, entry + 8); directory.writeUInt32LE(offset, entry + 12); offset += frames[i].length;
}
await fs.writeFile(path.join(assets, 'meetfolio.ico'), Buffer.concat([directory, ...frames]));
const icns = [];
for (const [type, size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]) {
  const png = await raster(size).png().toBuffer(); const h = Buffer.alloc(8);h.write(type);h.writeUInt32BE(png.length+8,4);icns.push(h,png);
}
const icnsHeader=Buffer.alloc(8);icnsHeader.write('icns');icnsHeader.writeUInt32BE(8+icns.reduce((n,b)=>n+b.length,0),4);
await fs.writeFile(path.join(assets,'meetfolio.icns'),Buffer.concat([icnsHeader,...icns]));
async function bitmap(name, width, height, background, size, left, top) {
  const rgb = await sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: await raster(size).png().toBuffer(), left, top }]).removeAlpha().raw().toBuffer();
  const stride = Math.ceil(width * 3 / 4) * 4; const bmp = Buffer.alloc(54 + stride * height);
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 3; const dst = 54 + (height - y - 1) * stride + x * 3;
    bmp[dst] = rgb[src + 2]; bmp[dst + 1] = rgb[src + 1]; bmp[dst + 2] = rgb[src];
  }
  await fs.writeFile(path.join(assets, name), bmp);
}
await bitmap('installer-header.bmp', 150, 57, '#FFFFFF', 42, 96, 7);
await bitmap('installer-sidebar.bmp', 164, 314, '#355F52', 112, 26, 88);
console.log(`Meetfolio: 1024px PNG, ${sizes.join('/')}px ICO, 150×57 and 164×314 NSIS bitmaps`);
