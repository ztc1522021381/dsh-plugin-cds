/**
 * audit-dark-completeness.mjs — 找出「暗色作用域引用了但没重定义」的令牌。
 *
 * 背景：CDS 暗色块只重载了一部分令牌，其余靠 var() 指向的灰阶令牌也必须在暗色块里
 * 重新定义，否则解析出来还是亮色值。这类残缺在亮色下完全看不出来，是暗色专属 bug。
 *
 * 用法: node tools/audit-dark-completeness.mjs [vendor/cds-theme.css]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? resolve(root, 'vendor/cds-theme.css');
const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取某个选择器规则的声明表。 */
function declsOf(selector) {
  const i = css.indexOf(`${selector} {`);
  if (i === -1) return {};
  const open = css.indexOf('{', i);
  let depth = 0;
  let end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = css.slice(open + 1, end);
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const light = declsOf(':root');
const dark = declsOf('[data-mode="dark"], \n.dark');
const darkAlt = Object.keys(dark).length > 0 ? dark : declsOf('[data-mode="dark"], .dark');

const darkKeys = Object.keys(darkAlt);
console.log(`:root 声明 ${Object.keys(light).length} 条；暗色块声明 ${darkKeys.length} 条`);

// 暗色块里每条声明右侧引用的令牌，若不在暗色块中重定义，就会取到亮色值
const referenced = new Set();
for (const value of Object.values(darkAlt)) {
  for (const m of value.matchAll(/var\((--[a-z0-9-]+)/gi)) referenced.add(m[1]);
}
const missing = [...referenced].filter((name) => !(name in darkAlt)).sort();

console.log(`\n暗色块引用但未重定义的令牌: ${missing.length} 个`);
for (const name of missing) {
  console.log(`  ${name.padEnd(26)} 亮色值 ${light[name] ?? '(未定义)'}`);
}

// 只重载了浅层、深层灰阶没重载 → 暗色下仍然发亮
const surfaceChain = ['--cds-surface-0', '--cds-surface-1', '--cds-surface-2', '--cds-surface-3', '--cds-surface-popover'];
console.log('\n表面阶梯在暗色块中的直接值:');
for (const name of surfaceChain) {
  console.log(`  ${name.padEnd(24)} ${darkAlt[name] ?? '(未重载 → 取亮色)'}`);
}
process.exit(0);
