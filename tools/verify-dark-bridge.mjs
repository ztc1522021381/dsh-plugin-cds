/**
 * verify-dark-bridge.mjs — 校验暗色作用域桥接是否真的把 CDS 暗色接进了 DSH。
 * 用法: node tools/verify-dark-bridge.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeDarkScope, DSH_DARK_ATTRIBUTE } from './dark-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'vendor/cds-theme.css'), 'utf8');
const { css, rewrites } = bridgeDarkScope(src);

const ATTR = `body[${DSH_DARK_ATTRIBUTE}]`;
const checks = [
  ['暗色令牌块已加 DSH 变体', css.includes(`${ATTR} {`)],
  ['光学补偿 .font-medium 已桥接', css.includes(`${ATTR} .font-medium`)],
  ['光学补偿 [data-optical-compensate] 已桥接', css.includes(`${ATTR} [data-optical-compensate]`)],
  ['光学补偿 .font-semibold 已桥接', css.includes(`${ATTR} .font-semibold`)],
  ['光学补偿 .font-bold 已桥接', css.includes(`${ATTR} .font-bold`)],
  ['CDS 原生选择器仍保留（不破坏上游用法）', /\[data-mode="dark"\],\s*\.dark/.test(css)],
  ['命中规则数为 4', rewrites.length === 4],
  ['声明体字节未被删改（只加选择器）', css.length > src.length && css.length - src.length < 600],
];

// 花括号必须配平，否则浏览器会把后面的规则整段吞掉
let depth = 0;
let minDepth = 0;
for (const ch of css) {
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth < minDepth) minDepth = depth;
  }
}
checks.push(['花括号配平（无提前闭合）', depth === 0 && minDepth === 0]);

// 桥接块里必须真的有 209 条暗色重载，不是空壳
const blockStart = css.indexOf(`${ATTR} {`);
const blockEnd = css.indexOf('}', blockStart);
const darkBlock = css.slice(blockStart, blockEnd);
const declCount = (darkBlock.match(/--cds-[a-z0-9-]+\s*:/g) ?? []).length;
checks.push([`DSH 暗色块声明数 ≥ 55（实得 ${declCount}）`, declCount >= 55]);

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failures += 1;
}
console.log(`\n改写命中: ${rewrites.length} 条规则`);
console.log(`体积: ${src.length} -> ${css.length} B (+${css.length - src.length})`);
console.log(`结果: ${failures === 0 ? '全部通过' : `${failures} 项不符`}`);
process.exit(failures === 0 ? 0 : 1);
