/**
 * read-pixels.mjs — 从 live-app.png 采样关键区域像素，与两套主题的预期值比对。
 *
 * 为什么要这样做：HTTP 探测被令牌拦住，插件清单接口也读不到，
 * 唯一可信的证据是「屏幕上的真实像素」。DSH 默认暗色与 CDS 暗色在
 * bg-base / sidebar-fill 上差异最大（#151517 vs #151515、#1b1b1c vs #0b0b0b），
 * 侧边栏那一块是最干净的判别点。
 *
 * 用法: node tools/read-pixels.mjs [png]
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const FILE = process.argv[2] ?? 'preview/live-app.png';

/** 极简 PNG 解码：只处理 8bit RGB/RGBA 非隔行，够读截图用。 */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8bit，实际 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`不支持 colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

const png = decodePng(readFileSync(FILE));
const px = (x, y) => {
  const i = (y * png.width + x) * png.channels;
  return '#' + [png.data[i], png.data[i + 1], png.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
};

console.log(`图像 ${png.width}x${png.height}  通道 ${png.channels}`);

// 采样点：避开文字与图标，取纯色区块
const SAMPLES = [
  ['侧边栏底色（左栏空白处）', 250, 640],
  ['侧边栏底色（标题下方）', 240, 130],
  ['主区域底色（对话背景）', 700, 700],
  ['主区域底色（右侧空白）', 1260, 640],
  ['会话卡片底色', 240, 495],
  ['顶部栏底色', 900, 30],
];

// 预期值
const DSH_DARK = { 'bg-base': '#151517', 'sidebar-fill': '#1b1b1c', 'bg-layer-1': '#232324' };
const CDS_DARK = { 'bg-base': '#151515', 'sidebar-fill': '#0b0b0b', 'bg-layer-1': '#1a1a19' };

const near = (a, b) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return Math.max(...pa.map((v, i) => Math.abs(v - pb[i])));
};

console.log('\n采样：');
for (const [label, x, y] of SAMPLES) {
  const c = px(x, y);
  console.log(`  ${label.padEnd(24)} (${x},${y}) = ${c}`);
}

console.log('\n与预期值比对（暗色）：');
const sidebar = px(250, 640);
const main = px(700, 700);
const rows = [
  ['sidebar-fill', sidebar],
  ['bg-base', main],
];
for (const [token, actual] of rows) {
  const d = near(actual, DSH_DARK[token]);
  const c = near(actual, CDS_DARK[token]);
  const verdict = c < d ? '★ CDS' : 'DSH 默认';
  console.log(`  ${token.padEnd(16)} 实际 ${actual}  Δdsh=${d}  Δcds=${c}  → ${verdict}`);
}
