/**
 * audit-blast-radius.mjs — 量化「装上这个插件，DSH 界面到底有多少东西会变」。
 *
 * 三个问题：
 *   1. DSH 一共定义多少条 --dsw-alias-* 令牌？插件只覆盖 11 条，占比多少？
 *   2. 那 11 条里，哪些被其它令牌以 var() 引用（即会连带改变一片）？
 *   3. 覆盖后的前景/背景对比度是多少？有没有降到不可读。
 *
 * 用法: node tools/audit-blast-radius.mjs
 */
// __scrub_prelude__ 发布前由 tools/scrub-paths.mjs 注入：本机路径改为环境派生。
import { existsSync as __existsSync } from 'node:fs';
const __DSH_HOME__ = process.env.DSH_HOME
  ?? (process.env.USERPROFILE ? `${process.env.USERPROFILE}/.dsh` : '<DSH_HOME>');
const __PROFILE_DIR__ = process.env.DSH_PROFILE_DIR
  ?? `${__DSH_HOME__}/profiles/${process.env.DSH_PROFILE ?? 'desktop'}`;
const __AI_ROOT__ = `${__DSH_HOME__}/profiles/node_modules/@deepseek-ai`;
const __PROJECT_ROOT__ = process.env.CDS_PROJECT_ROOT ?? process.cwd();
/** dsh 自身安装根：npm 全局优先，Electron 打包兜底。 */
const __DSH_ROOT__ = [
  process.env.APPDATA ? `${process.env.APPDATA}/npm/node_modules/@deepseek-ai/dsh` : undefined,
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}/Programs/DeepSeek Harness/resources/app.asar.unpacked/dsh`
    : undefined,
].filter(Boolean).find((p) => __existsSync(p)) ?? '<DSH_ROOT>';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const THEME = `${__AI_ROOT__}/dsh-client-ui-theme/lib/client.js`;
const ROOT = `${__AI_ROOT__}`;
const css = readFileSync(THEME, 'utf8');
const cds = JSON.parse(readFileSync('src/cds-tokens.json', 'utf8'));

/** body{...} 块（亮色）与 body[data-ds-dark-theme]{...} 块（暗色）。 */
function blockAt(start) {
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}
const LIGHT = blockAt(css.indexOf('body{--dsw-alias-bg-base'));
const DARK = blockAt(css.indexOf('body[data-ds-dark-theme]{--dsw-alias-bg-base'));

// ── 1. 令牌总数 vs 覆盖数 ──────────────────────────────────────────────
const allAlias = new Set();
for (const m of css.matchAll(/(--dsw-(?:alias|specific)-[a-z0-9-]+)\s*:/g)) allAlias.add(m[1]);
const bridged = Object.keys(cds.bridge);

console.log('1 · 覆盖占比');
console.log(`  DSH 定义的 --dsw-alias-*/--dsw-specific-* 令牌: ${allAlias.size} 条`);
console.log(`  插件覆盖:                                    ${bridged.length} 条`);
console.log(`  占比: ${(bridged.length / allAlias.size * 100).toFixed(1)}%  —— 绝大多数令牌保持 DSH 原值`);

// ── 2. 连带影响：被其它令牌 var() 引用 ─────────────────────────────────
/** 在主题块里找 value 含 var(<name>) 的声明，返回引用它的令牌名。 */
function referrers(block, name) {
  const out = [];
  for (const m of block.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (m[1] === name) continue;
    if (new RegExp(`var\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(m[2])) {
      out.push(m[1]);
    }
  }
  return out;
}

console.log('\n2 · 连带改变（被其它令牌 var() 引用 ⇒ 跟着变）');
let totalChain = 0;
for (const name of bridged) {
  const lightRefs = referrers(LIGHT, name);
  const darkRefs = referrers(DARK, name);
  const refs = [...new Set([...lightRefs, ...darkRefs])];
  totalChain += refs.length;
  console.log(`  ${name.replace('--dsw-alias-', '').replace('--dsw-specific-', '').padEnd(26)} → ${refs.length === 0 ? '无派生（仅自身生效）' : `${refs.length} 条: ${refs.map((r) => r.replace('--dsw-alias-', '')).join(', ')}`}`);
}
console.log(`  派生令牌合计: ${totalChain} 条（连同 11 条本体，实际受影响约 ${bridged.length + totalChain} 条）`);

// ── 3. 对比度核算 ──────────────────────────────────────────────────────
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (m === null) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
/** hsla(h, s%, l%, a) 与 #rrggbb 都归一到 [r,g,b,a]。 */
function parseColor(v) {
  const h6 = hex(v);
  if (h6 !== null) return [...h6, 1];
  const m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v.trim());
  if (m === null) return null;
  const [h, s, l] = [Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255, a].map((x) => Math.round(x));
}
/** WCAG 相对亮度。 */
function lum([r, g, b]) {
  const c = (x) => {
    const v = x / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
/** alpha 混合到不透明底色上。 */
function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}
const contrast = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

console.log('\n3 · 对比度（覆盖后 / WCAG AA 正文需 ≥ 4.5，大字与图标 ≥ 3.0）');
for (const mode of ['light', 'dark']) {
  const base = parseColor(cds.override[mode]['--dsw-alias-bg-base']);
  console.log(`  ${mode === 'light' ? '亮色' : '暗色'}（底色 ${cds.override[mode]['--dsw-alias-bg-base']}）`);
  for (const [label, name, floor] of [
    ['主文字', '--dsw-alias-label-primary', 4.5],
    ['次要文字', '--dsw-alias-label-secondary', 4.5],
    ['品牌色作文字/图标', '--dsw-alias-brand-primary', 3.0],
    ['错误态作文字', '--dsw-alias-state-error-primary', 4.5],
  ]) {
    const fg = parseColor(cds.override[mode][name]);
    if (fg === null) { console.log(`    ${label}: 无法解析`); continue; }
    const ratio = contrast(over(fg, base), base);
    const verdict = ratio >= floor ? '✓' : '✗';
    console.log(`    ${label.padEnd(20)} ${cds.override[mode][name].padEnd(26)} ${ratio.toFixed(2)}:1  ${verdict}（阈值 ${floor}）`);
  }
}

// ── 4. CDS 工具类是否真的会被 DSH 用到 ────────────────────────────────
console.log('\n4 · CDS 工具类（52 条 .class 规则）的实际作用面');
const classNames = [...new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{]/gi)].map((m) => m[1]))];
const cdsCss = readFileSync('dist/cds-theme.css', 'utf8');
const cdsClasses = [...new Set([...cdsCss.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{]/gi)].map((m) => m[1]))].filter((c) => !classNames.includes(c));
console.log(`  CDS 引入的类名: ${cdsClasses.length} 个（如 ${cdsClasses.slice(0, 6).join(', ')}…）`);

/** 在 DSH 的 app shell 里搜这些类名，看有没有真实使用。 */
function scan(dir, patterns) {
  const hits = new Map();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      for (const [k, v] of scan(p, patterns)) hits.set(k, (hits.get(k) ?? 0) + v);
    } else if (name.endsWith('.js')) {
      const txt = readFileSync(p, 'utf8');
      if (txt.length > 4_000_000) continue; // devtools chunk，跳过
      for (const c of patterns) {
        if (new RegExp(`["'\\s]${c}["'\\s]`).test(txt)) hits.set(c, (hits.get(c) ?? 0) + 1);
      }
    }
  }
  return hits;
}
const used = scan(ROOT, cdsClasses);
console.log(`  DSH app shell 里被实际使用的: ${used.size} 个`);
if (used.size === 0) {
  console.log('  ⇒ 工具类对现有界面无影响（DSH 不使用这些类名）；它们只在你自己写 HTML 时才生效。');
}
