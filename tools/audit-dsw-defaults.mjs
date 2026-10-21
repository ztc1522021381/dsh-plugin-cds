/**
 * audit-dsw-defaults.mjs — 把 DSH 内置主题的默认值解析成具体颜色，与 CDS 值逐条对比。
 *
 * 用途：回答「装上插件后到底哪些东西会变、变成什么」。不靠肉眼读 CSS 文本，
 * 而是把 var() 链解析到底层 static 色板，输出 side-by-side 表。
 *
 * 用法: node tools/audit-dsw-defaults.mjs
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

import { readFileSync } from 'node:fs';

const FILE = `${__AI_ROOT__}/dsh-client-ui-theme/lib/client.js`;
const css = readFileSync(FILE, 'utf8');

/** 取 body{...} 与 body[data-ds-dark-theme]{...} 两个块的文本。 */
function blockAt(startIdx) {
  let depth = 0;
  for (let i = startIdx; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(startIdx, i + 1);
    }
  }
  throw new Error('unbalanced');
}

const lightStart = css.indexOf('body{--dsw-alias-bg-base');
const darkStart = css.indexOf('body[data-ds-dark-theme]{--dsw-alias-bg-base');
if (lightStart === -1 || darkStart === -1) throw new Error('未找到主题块');
const LIGHT = blockAt(lightStart);
const DARK = blockAt(darkStart);

/** 全文件的 static 色板（:root 里定义）。 */
function staticMap() {
  const m = new Map();
  for (const x of css.matchAll(/(--dsw-static-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (!m.has(x[1])) m.set(x[1], x[2].trim());
  }
  return m;
}
const STATIC = staticMap();

/** 从某个主题块里读一条令牌的原始值。 */
function raw(block, name) {
  const i = block.indexOf(`${name}:`);
  if (i === -1) return undefined;
  const end = block.indexOf(';', i);
  return block.slice(i + name.length + 1, end).trim();
}

/** 把 var() 链解析到 static 色板；解析不出来就原样返回。 */
function resolve(value, depth = 0) {
  if (value === undefined) return '(未定义)';
  if (depth > 12) return value;
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value);
  if (m === null) return value;
  const next = STATIC.get(m[1]);
  if (next !== undefined) return resolve(next, depth + 1);
  return m[2]?.trim() ?? value;
}

const TOKENS = [
  ['--dsw-alias-bg-base', '画布底色'],
  ['--dsw-alias-bg-layer-1', '一级层（卡片/输入框）'],
  ['--dsw-alias-bg-layer-2', '二级层'],
  ['--dsw-alias-bg-overlay', '浮层（弹窗/菜单）'],
  ['--dsw-alias-border-l1', '细边框'],
  ['--dsw-alias-border-l2', '常规边框'],
  ['--dsw-alias-brand-primary', '品牌主色'],
  ['--dsw-alias-label-primary', '主文字'],
  ['--dsw-alias-label-secondary', '次要文字'],
  ['--dsw-alias-state-error-primary', '错误态'],
  ['--dsw-specific-sidebar-fill', '侧栏底色'],
];

const cds = JSON.parse(readFileSync('src/cds-tokens.json', 'utf8'));
const bridge = cds.bridge;
const override = cds.override;

console.log('DSH 默认值 vs CDS 覆盖值（均已解析到底层色值）\n');
const pad = (s, n) => String(s).padEnd(n);

for (const mode of ['light', 'dark']) {
  const block = mode === 'light' ? LIGHT : DARK;
  console.log(`${mode === 'light' ? '亮色' : '暗色'}`);
  console.log(`  ${pad('令牌', 34)}${pad('DSH 默认', 16)}${pad('CDS 覆盖', 16)}变化`);
  for (const [name, label] of TOKENS) {
    const dsh = resolve(raw(block, name));
    const cdsVal = override[mode]?.[name] ?? '(未桥接)';
    const changed = dsh.toLowerCase() !== String(cdsVal).toLowerCase();
    console.log(`  ${pad(name.replace('--dsw-alias-', '').replace('--dsw-specific-', ''), 34)}${pad(dsh, 16)}${pad(cdsVal, 16)}${changed ? '★' : '—'}`);
  }
  console.log('');
}

console.log('桥接范围（overrideTokens 提交的 11 条）:');
for (const [dsw, cdsName] of Object.entries(bridge)) {
  console.log(`  ${dsw.padEnd(34)} ← ${cdsName}`);
}
