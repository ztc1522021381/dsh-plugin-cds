/**
 * make-icon.mjs — 生成插件图标 icon.png（CDS 陶土橙圆角方块 + 白字 C）。
 *
 * 为什么需要它：plugin-manager 的 readPluginMeta 会读 package.json 的 `icon`，
 * 没有图标时面板卡片是空占位，混在一堆插件里更难认。
 *
 * 纯手写 PNG 编码，不引第三方依赖。
 *
 * 用法: node tools/make-icon.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 128;
const BRAND = [0xc6, 0x61, 0x3f]; // --cds-brand #c6613f
const LIGHT = [0xf5, 0xf5, 0xf5];

/** 圆角矩形命中测试（含 4x4 超采样做抗锯齿）。 */
function insideRoundRect(x, y, r) {
  const minX = r;
  const maxX = SIZE - 1 - r;
  const minY = r;
  const maxY = SIZE - 1 - r;
  if (x >= minX && x <= maxX) return y >= 0 && y < SIZE;
  if (y >= minY && y <= maxY) return x >= 0 && x < SIZE;
  const cx = x < minX ? minX : maxX;
  const cy = y < minY ? minY : maxY;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 字形「C」：一段环形减去右侧开口，用极坐标判定。 */
function insideC(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const outer = SIZE * 0.30;
  const inner = SIZE * 0.195;
  if (dist > outer || dist < inner) return false;
  // 开口朝右：角度在 -40°..40° 之间挖掉
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return !(deg > -42 && deg < 42);
}

const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
let p = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[p] = 0; // filter: none
  p += 1;
  for (let x = 0; x < SIZE; x += 1) {
    let bgCov = 0;
    let fgCov = 0;
    for (let sy = 0; sy < 4; sy += 1) {
      for (let sx = 0; sx < 4; sx += 1) {
        const fx = x + (sx + 0.5) / 4;
        const fy = y + (sy + 0.5) / 4;
        if (!insideRoundRect(fx, fy, 26)) continue;
        bgCov += 1;
        if (insideC(fx, fy)) fgCov += 1;
      }
    }
    const total = 16;
    const a = bgCov / total;
    const f = fgCov / total;
    // 前景白字叠在品牌底色上，再整体按圆角覆盖度与页面底色混合（这里输出不透明 + alpha 用白底）
    const r0 = Math.round(BRAND[0] * (1 - f) + LIGHT[0] * f);
    const g0 = Math.round(BRAND[1] * (1 - f) + LIGHT[1] * f);
    const b0 = Math.round(BRAND[2] * (1 - f) + LIGHT[2] * f);
    // 圆角外按透明处理：这里合成到白色，避免平台差异
    raw[p] = Math.round(r0 * a + 255 * (1 - a));
    raw[p + 1] = Math.round(g0 * a + 255 * (1 - a));
    raw[p + 2] = Math.round(b0 * a + 255 * (1 - a));
    p += 3;
  }
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const OUT = 'plugin/icon.png';
writeFileSync(OUT, png);
console.log(`✓ ${OUT}  ${png.length} B  ${SIZE}x${SIZE} RGB`);
