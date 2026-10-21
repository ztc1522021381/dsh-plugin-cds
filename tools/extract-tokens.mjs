/**
 * extract-tokens.mjs — 从 vendor/cds-theme.css 提取 CDS 设计令牌的 light/dark 双份
 * 已解析值，输出 src/cds-tokens.json。
 *
 * 为什么需要它：cds-theme.css 用 var() 链式引用（--cds-surface-0 → --cds-gray-20 →
 * #f9f9f7）。DSH 的主题服务 ctx.theme.overrideTokens() 只接受**字面值**字符串
 * （{ light, dark } 成对），不接受 var()，所以必须先把链路求值成具体颜色。
 *
 * 用法: node tools/extract-tokens.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_DARK_ATTRIBUTE } from './dark-bridge.mjs';
import { namespaceCdsTokens } from './namespace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CSS = resolve(root, 'vendor/cds-theme.css');

// 必须先过命名空间净化，再解析：产物里的令牌名是 --cds-* 前缀化的（--brand → --cds-brand），
// 桥接表指向的就是净化后的名字。若在这里直接读 vendor 原文，桥接表会引用一个
// 产物里并不存在的变量 —— 浏览器静默取空值，整条桥接失效且没有任何报错。
const source = namespaceCdsTokens(readFileSync(CSS, 'utf8')).css;

/** 去掉注释，保留字符串内容。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

const clean = stripComments(source);

/** 取某个选择器开头的规则块（花括号配平），返回块内文本。 */
function blockOf(selector) {
  const idx = clean.indexOf(selector);
  if (idx === -1) throw new Error(`未找到选择器: ${selector}`);
  const open = clean.indexOf('{', idx);
  let depth = 0;
  for (let i = open; i < clean.length; i += 1) {
    if (clean[i] === '{') depth += 1;
    else if (clean[i] === '}') {
      depth -= 1;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  throw new Error(`选择器未闭合: ${selector}`);
}

/** 把块文本解析成 { --name: value }。 */
function declarations(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*;?\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/;\s*$/, '').trim();
  }
  return out;
}

const lightRaw = declarations(blockOf(':root {'));
const darkRaw = { ...lightRaw, ...declarations(blockOf('[data-mode="dark"], .dark {')) };

/**
 * 不动点求值：反复把 var(--x[, fallback]) 替换成表中的值，直到没有 var() 残留。
 * 用不动点而不是递归，是因为同一个值可以合法地多次引用同一令牌
 * （如 --cds-shadow-composer-focus 里 var(--cds-border-strong) 出现两次）；
 * 真正的循环引用表现为「一轮之后毫无变化」，在这里显式报错。
 */
function resolveAll(table) {
  const work = { ...table };
  for (let pass = 0; pass < 64; pass += 1) {
    let changed = false;
    for (const name of Object.keys(work)) {
      const before = work[name];
      const after = before.replace(
        /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/g,
        (whole, ref, fallback) => (work[ref] !== undefined ? work[ref] : (fallback ?? whole)),
      );
      if (after !== before) {
        work[name] = after;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const unresolved = Object.entries(work).filter(([, v]) => /var\(/.test(v));
  if (unresolved.length > 0) {
    throw new Error(`存在无法求值的引用（循环或缺失）:\n${unresolved.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`);
  }
  return work;
}

const light = resolveAll(lightRaw);
const dark = resolveAll(darkRaw);

/** 语义令牌 → DSH --dsw-alias-* 的桥接表（CDS 是权威色板，注入宿主）。 */
const BRIDGE = {
  '--dsw-alias-bg-base': '--cds-surface-1',            // 主聊天画布
  '--dsw-alias-bg-layer-1': '--cds-surface-2',         // 抬升层：卡片 / 输入条
  '--dsw-alias-bg-layer-2': '--cds-surface-3',         // 嵌套层：hover 填充
  '--dsw-alias-bg-overlay': '--cds-surface-popover',   // 浮层 / 下拉
  '--dsw-alias-border-l1': '--cds-border',             // 发丝分割线
  '--dsw-alias-border-l2': '--cds-border-strong',      // 强调描边
  '--dsw-alias-brand-primary': '--cds-brand',          // 官方品牌陶土（构建期由 --brand 改名而来）
  '--dsw-alias-label-primary': '--cds-text-primary',
  '--dsw-alias-label-secondary': '--cds-text-secondary',
  '--dsw-alias-state-error-primary': '--cds-fill-danger',
  '--dsw-specific-sidebar-fill': '--cds-surface-0',    // 侧栏列底色（比画布更沉）
};
// 注意：`--brand` 在构建期被 tools/namespace.mjs 改名成 `--cds-brand`（无前缀令牌全部
// 加 --cds- 前缀，避免污染 DSH 的 :root 共享命名空间）。桥接表必须指向改名后的名字，
// 否则别名层会引用一个产物里不存在的变量 —— 浏览器静默取到空值，桥接整条失效。

const override = { light: {}, dark: {} };
for (const [dswToken, cdsToken] of Object.entries(BRIDGE)) {
  const l = light[cdsToken];
  const d = dark[cdsToken];
  if (l === undefined) throw new Error(`CDS 令牌缺失（light）: ${cdsToken}`);
  if (d === undefined) throw new Error(`CDS 令牌缺失（dark）: ${cdsToken}`);
  if (/var\(/.test(l) || /var\(/.test(d)) throw new Error(`求值不彻底: ${cdsToken} -> ${l} / ${d}`);
  override.light[dswToken] = l;
  override.dark[dswToken] = d;
}

const payload = {
  $comment:
    '由 tools/extract-tokens.mjs 从 vendor/cds-theme.css 生成；CDS 设计令牌的已求值 light/dark 值 + DSH --dsw-alias-* 桥接表。请勿手改。',
  source: 'open-claude-ui/code-examples/cds-theme.css',
  counts: {
    declared: Object.keys(lightRaw).length,
    light: Object.keys(light).length,
    dark: Object.keys(dark).length,
    bridge: Object.keys(BRIDGE).length,
  },
  bridge: BRIDGE,
  override,
  tokens: { light, dark },
};

writeFileSync(resolve(root, 'src/cds-tokens.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

/**
 * 同时生成静态桥接样式表：纯 CSS 消费者（预览页 / 任何 <link> 引入的场景）用它
 * 把 --dsw-* 宿主令牌指到 --cds-* 上，与运行时 overrideTokens() 的桥接表一一对应。
 *
 * 必须写两份作用域。原因：自定义属性的 var() 在**声明该属性的元素**上就完成替换，
 * 继承下去的是已算好的值。若只在 :root 声明，html 上的 --cds-* 是亮色值，
 * 子元素即便在 body[data-ds-dark-theme] 里把 --cds-* 改成暗色值，也改不动
 * 已经从 html 继承下来的 --dsw-alias-*。所以暗色作用域要重新声明一遍。
 */
const aliasLines = [
  '/* ==========================================================================',
  '   cds-host-aliases.css — DSH 宿主令牌 ← CDS 设计令牌 桥接层',
  '   由 tools/extract-tokens.mjs 生成，请勿手改。',
  '   运行时等价物：ctx.theme.overrideTokens("dsh-plugin-cds", …)（见 lib/client.js）。',
  '   两份作用域：:root 供亮色，body[data-ds-dark-theme] 供 DSH 暗色。',
  '   ========================================================================== */',
  '',
  ':root {',
];
for (const [dswToken, cdsToken] of Object.entries(BRIDGE)) {
  aliasLines.push(`  ${dswToken}: var(${cdsToken});`);
}
aliasLines.push('}', '');
aliasLines.push(`body[${DSH_DARK_ATTRIBUTE}] {`);
for (const [dswToken, cdsToken] of Object.entries(BRIDGE)) {
  aliasLines.push(`  ${dswToken}: var(${cdsToken});`);
}
aliasLines.push('}', '');

writeFileSync(resolve(root, 'src/cds-host-aliases.css'), `${aliasLines.join('\n')}`, 'utf8');

console.log(`声明令牌: ${payload.counts.declared}`);
console.log(`求值令牌: light ${payload.counts.light} / dark ${payload.counts.dark}`);
console.log(`桥接映射: ${payload.counts.bridge} 条 --dsw-alias-* ← --cds-*`);
for (const [k, v] of Object.entries(BRIDGE)) {
  console.log(`  ${k.padEnd(38)} ← ${v.padEnd(24)} ${override.light[k]} | ${override.dark[k]}`);
}
