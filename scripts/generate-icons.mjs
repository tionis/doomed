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
  const cornerRadius = maskable ? size * 0.5 : size * 0.23;
  const card = {
    x: size * 0.15,
    y: size * 0.13,
    w: size * 0.7,
    h: size * 0.72,
    r: size * 0.055,
  };
  const stamp = {
    cx: size * 0.54,
    cy: size * 0.59,
    w: size * 0.62,
    h: size * 0.19,
    angle: -12 * Math.PI / 180,
  };

  function inRoundRect(x, y, rect) {
    const dx = Math.abs(x - (rect.x + rect.w / 2));
    const dy = Math.abs(y - (rect.y + rect.h / 2));
    const cornerDx = Math.max(dx - (rect.w / 2 - rect.r), 0);
    const cornerDy = Math.max(dy - (rect.h / 2 - rect.r), 0);
    return cornerDx * cornerDx + cornerDy * cornerDy <= rect.r * rect.r;
  }

  function inRotatedRect(x, y, rect) {
    const cos = Math.cos(-rect.angle);
    const sin = Math.sin(-rect.angle);
    const dx = x - rect.cx;
    const dy = y - rect.cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return Math.abs(rx) <= rect.w / 2 && Math.abs(ry) <= rect.h / 2;
  }

  function rotatedCoords(x, y, rect) {
    const cos = Math.cos(-rect.angle);
    const sin = Math.sin(-rect.angle);
    const dx = x - rect.cx;
    const dy = y - rect.cy;
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    };
  }

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

      const t = Math.min(1, Math.max(0, y / size));
      let r = Math.round(18 + 42 * t);
      let g = Math.round(61 - 37 * t);
      let b = Math.round(69 - 34 * t);
      let a = insideRoundedRect ? 255 : 0;

      const shadowRect = { ...card, x: card.x + size * 0.025, y: card.y + size * 0.035 };
      if (inRoundRect(x, y, shadowRect)) {
        r = 10;
        g = 16;
        b = 20;
      }

      if (inRoundRect(x, y, card)) {
        const paperShade = Math.min(1, Math.max(0, (y - card.y) / card.h));
        r = Math.round(255 - 24 * paperShade);
        g = Math.round(250 - 28 * paperShade);
        b = Math.round(240 - 36 * paperShade);
      }

      const foldStart = card.x + card.w * 0.78;
      const fold =
        x > foldStart &&
        x < card.x + card.w &&
        y > card.y &&
        y < card.y + (x - foldStart) * 0.7;
      if (fold) {
        r = 207;
        g = 217;
        b = 223;
      }

      const promptLine1 = y > card.y + card.h * 0.22 && y < card.y + card.h * 0.29 && x > card.x + card.w * 0.13 && x < card.x + card.w * 0.58;
      const promptLine2 = y > card.y + card.h * 0.38 && y < card.y + card.h * 0.44 && x > card.x + card.w * 0.13 && x < card.x + card.w * 0.78;
      if (promptLine1) {
        r = 31;
        g = 111;
        b = 120;
      }
      if (promptLine2) {
        r = 184;
        g = 196;
        b = 203;
      }

      if (inRotatedRect(x, y, stamp)) {
        r = 139;
        g = 37;
        b = 37;
        const local = rotatedCoords(x, y, stamp);
        const borderX = Math.abs(local.x) > stamp.w * 0.43;
        const borderY = Math.abs(local.y) > stamp.h * 0.32;
        const textStripe = Math.abs(local.y) < stamp.h * 0.11 && Math.abs(local.x) < stamp.w * 0.36;
        const textBreak = Math.sin((local.x / stamp.w) * Math.PI * 12) > 0.38;
        if (borderX || borderY || (textStripe && textBreak)) {
          r = 255;
          g = 243;
          b = 232;
        }
      }

      const cursorH = x > size * 0.76 && x < size * 0.91 && y > size * 0.78 && y < size * 0.84;
      const cursorV = x > size * 0.88 && x < size * 0.94 && y > size * 0.7 && y < size * 0.91;
      if (cursorH || cursorV) {
        r = 159;
        g = 208;
        b = 202;
      }

      const spark = (x - size * 0.2) ** 2 + (y - size * 0.22) ** 2 <= (size * 0.03) ** 2;
      if (spark) {
        r = 243;
        g = 155;
        b = 114;
      }

      const vignette = Math.min(1, Math.hypot(x - center, y - center) / (size * 0.62));
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
