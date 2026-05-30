import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const iconDir = new URL("../public/icons/", import.meta.url);
mkdirSync(iconDir, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(name, size, { maskable = false } = {}) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const center = size / 2;
  const cornerRadius = maskable ? size * 0.5 : size * 0.22;
  const badgeRadius = size * 0.4;
  const eyeWidth = size * 0.58;
  const eyeHeight = size * 0.18;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;

    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const dx = Math.abs(x + 0.5 - center);
      const dy = Math.abs(y + 0.5 - center);
      const cornerDx = Math.max(dx - (center - cornerRadius), 0);
      const cornerDy = Math.max(dy - (center - cornerRadius), 0);
      const insideRoundedRect = cornerDx * cornerDx + cornerDy * cornerDy <= cornerRadius * cornerRadius;

      let r = 23;
      let g = 32;
      let b = 38;
      let a = insideRoundedRect ? 255 : 0;

      const shieldY = y - size * 0.08;
      const shieldWidthAtY = size * (0.26 + 0.46 * Math.max(0, 1 - Math.abs(shieldY - center) / (size * 0.48)));
      const inShield = Math.abs(x - center) < shieldWidthAtY / 2 && y > size * 0.12 && y < size * 0.9;
      if (inShield) {
        const t = y / size;
        r = Math.round(31 + 108 * Math.max(0, t - 0.45));
        g = Math.round(111 - 74 * Math.max(0, t - 0.45));
        b = Math.round(120 - 83 * Math.max(0, t - 0.45));
      }

      const eye = Math.pow((x - center) / eyeWidth, 2) + Math.pow((y - center) / eyeHeight, 2) <= 1;
      if (eye) {
        r = 247;
        g = 243;
        b = 223;
      }

      const iris = (x - center) ** 2 + (y - center) ** 2 <= (size * 0.105) ** 2;
      if (iris) {
        r = 23;
        g = 32;
        b = 38;
      }

      const pupil = (x - center) ** 2 + (y - center) ** 2 <= (size * 0.044) ** 2;
      if (pupil) {
        r = 159;
        g = 208;
        b = 202;
      }

      const topBar = Math.abs(y - size * 0.28) < size * 0.025 && Math.abs(x - center) < size * 0.14;
      const stem = Math.abs(x - center) < size * 0.024 && y > size * 0.21 && y < size * 0.36;
      if (topBar || stem) {
        r = 247;
        g = 243;
        b = 223;
      }

      const vignette = Math.min(1, Math.hypot(x - center, y - center) / badgeRadius);
      r = Math.round(r * (1 - vignette * 0.1));
      g = Math.round(g * (1 - vignette * 0.1));
      b = Math.round(b * (1 - vignette * 0.1));

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  writeFileSync(
    new URL(name, iconDir),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

writePng("icon-192.png", 192);
writePng("icon-512.png", 512);
writePng("maskable-512.png", 512, { maskable: true });
writePng("apple-touch-icon.png", 180);
