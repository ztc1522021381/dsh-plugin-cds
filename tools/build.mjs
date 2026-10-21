/**
 * build.mjs — 把 vendor + src 组装成插件可装载的产物：
 *   dist/cds-theme.css       = 暗色桥接后的 CDS 令牌 + DSH 宿主桥接
 *   dist/cds-motion.mjs      = src/cds-motion.mjs（原样复制，浏览器可直接 import）
 *   dist/cds-tokens.json     = src/cds-tokens.json（原样复制）
 * 并做自检：令牌条数、桥接条数、暗色作用域、花括号配平、声明体完整性。
 *
 * 用法: node tools/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeDarkScope, DSH_DARK_ATTRIBUTE } from './dark-bridge.mjs';
import { namespaceCdsTokens } from './namespace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });

const themeRaw = readFileSync(resolve(root, 'vendor/cds-theme.css'), 'utf8');
const aliases = readFileSync(resolve(root, 'src/cds-host-aliases.css'), 'utf8');

// ① 命名空间净化：无前缀令牌全部改成 --cds-*（DSH 的 :root 是共享命名空间）
const { css: themed, renamed, merged } = namespaceCdsTokens(themeRaw);
// ② 暗色作用域桥接：把 [data-mode="dark"] 也挂到 body[data-ds-dark-theme] 上
const { css: theme, rewrites } = bridgeDarkScope(themed);

// 构建标识用**源码内容哈希**，不用时间戳：
// 时间戳会让每次构建的产物都不同，导致「源码没改但哈希对不上」的假失败，
// 也让 profile 同步核对失去意义（tools/sync-profile.mjs 靠逐字节比对判断是否最新）。
const buildId = createHash('sha256')
  .update(themeRaw)
  .update(aliases)
  .update(String(renamed.length))
  .digest('hex')
  .slice(0, 12);

const banner = `/* ==========================================================================
   dsh-plugin-cds — CDS 主题层（open-claude-ui 移植）
   §1 CDS 完整令牌 + 工具类（vendor/cds-theme.css，经两步构建期改写）
      · 命名空间净化：${renamed.length} 个无前缀令牌 → --cds-*（${merged.length} 条按别名规则合并）
      · 暗色作用域桥接：${rewrites.length} 条规则追加 body[${DSH_DARK_ATTRIBUTE}] 变体
   §2 DSH 宿主桥接（--dsw-alias-* ← --cds-*，由 tools/extract-tokens.mjs 生成）
   源码指纹: ${buildId}（内容哈希，同源同值，可复现构建）
   ========================================================================== */
`;

const bundle = `${banner}\n/* ── §1 CDS 令牌与工具类 ── */\n${theme}\n\n/* ── §2 DSH 宿主桥接 ── */\n${aliases}`;
writeFileSync(resolve(dist, 'cds-theme.css'), bundle, 'utf8');

copyFileSync(resolve(root, 'src/cds-motion.mjs'), resolve(dist, 'cds-motion.mjs'));
copyFileSync(resolve(root, 'src/cds-tokens.json'), resolve(dist, 'cds-tokens.json'));

// ── 自检 ────────────────────────────────────────────────────────────────
const tokens = JSON.parse(readFileSync(resolve(dist, 'cds-tokens.json'), 'utf8'));
const problems = [];

const declared = tokens.counts.declared;
const bridgeCount = Object.keys(tokens.bridge).length;
if (declared < 200) problems.push(`令牌声明数异常偏低: ${declared}`);
if (bridgeCount !== 11) problems.push(`桥接条数异常: ${bridgeCount}`);

for (const [dsw, cds] of Object.entries(tokens.bridge)) {
  if (tokens.override.light[dsw] === undefined) problems.push(`light 缺值: ${dsw}`);
  if (tokens.override.dark[dsw] === undefined) problems.push(`dark 缺值: ${dsw}`);
  if (tokens.override.light[dsw] === tokens.override.dark[dsw] && dsw !== '--dsw-alias-brand-primary') {
    problems.push(`light/dark 同值（可疑，品牌色除外）: ${dsw} = ${tokens.override.light[dsw]}`);
  }
  if (tokens.tokens.light[cds] === undefined) problems.push(`CDS 令牌未求值: ${cds}`);
}

// 暗色作用域必须真的重载了 surface 阶梯与文字色，且挂在 DSH 属性上
const ATTR = `body[${DSH_DARK_ATTRIBUTE}]`;
const darkStart = bundle.indexOf(`${ATTR} {`);
if (darkStart === -1) problems.push(`暗色块未桥接到 ${ATTR}`);
const darkScope = bundle.slice(darkStart, bundle.indexOf('}', darkStart));
const mustRedefine = ['--cds-surface-0', '--cds-surface-1', '--cds-surface-2', '--cds-surface-3', '--cds-text-primary', '--cds-border'];
for (const name of mustRedefine) {
  if (!new RegExp(`\\${name}\\s*:`).test(darkScope)) problems.push(`暗色作用域未重载: ${name}`);
}

// 桥接块必须存在
if (!/--dsw-alias-bg-base:\s*var\(--cds-surface-1\);/.test(bundle)) {
  problems.push('桥接块缺失 --dsw-alias-bg-base');
}

// 花括号配平：任何提前闭合都会让后续规则被浏览器整段丢弃
let depth = 0;
let minDepth = 0;
for (const ch of bundle) {
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth < minDepth) minDepth = depth;
  }
}
if (depth !== 0 || minDepth !== 0) problems.push(`花括号不配平: 终值 ${depth}, 最小值 ${minDepth}`);

// 体积守卫：命名空间净化 + 暗色桥接只应改名字与选择器，不应显著膨胀
const growth = Buffer.byteLength(bundle, 'utf8') - Buffer.byteLength(themeRaw + aliases, 'utf8');
if (growth > 4000) problems.push(`产物相对源膨胀异常: +${growth} B`);

// 命名空间守卫：产物里不许再出现无前缀的自定义属性（DSH 的 :root 是共享命名空间）
const bareDecls = [...bundle.matchAll(/(^|[{;\s])(--(?!cds-|dsw-|dsh-)[a-z0-9-]+)\s*:/gi)].map((m) => m[2]);
const bareRefs = [...bundle.matchAll(/var\(\s*(--(?!cds-|dsw-|dsh-)[a-z0-9-]+)/gi)].map((m) => m[1]);
const bareAll = [...new Set([...bareDecls, ...bareRefs])].sort();
if (bareAll.length > 0) problems.push(`产物仍有无前缀令牌: ${bareAll.join(', ')}`);

// 自引用环守卫：`--cds-x: var(--cds-x)` 会被浏览器视为无效，值整条丢失
for (const m of bundle.matchAll(/(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
  if (m[1] === m[2]) problems.push(`自引用环: ${m[1]}`);
}

const sizeKb = (Buffer.byteLength(bundle, 'utf8') / 1024).toFixed(1);
console.log('构建产物 dist/:');
console.log(`  cds-theme.css    ${sizeKb} KB  (CDS ${themeRaw.length} B → 净化 ${themed.length} B → 暗色桥接 ${theme.length} B)`);
console.log(`  cds-motion.mjs   ${(Buffer.byteLength(readFileSync(resolve(dist, 'cds-motion.mjs')), 'utf8') / 1024).toFixed(1)} KB`);
console.log(`  cds-tokens.json  ${(Buffer.byteLength(readFileSync(resolve(dist, 'cds-tokens.json')), 'utf8') / 1024).toFixed(1)} KB`);
console.log(`\n自检: 令牌 ${declared} 条，桥接 ${bridgeCount} 条，暗色重载 ${mustRedefine.length} 项，暗色块声明 ${(darkScope.match(/--cds-[a-z0-9-]+\s*:/g) ?? []).length} 条`);
console.log(`      命名空间净化 ${renamed.length} 个，别名合并 ${merged.length} 条，暗色改写 ${rewrites.length} 条，无前缀残留 ${bareAll.length} 个`);
if (problems.length > 0) {
  console.error('\n✗ 自检失败:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ 自检通过');
