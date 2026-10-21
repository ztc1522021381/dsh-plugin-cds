/**
 * dump-dark.mjs — 打印产物里 DSH 暗色作用域块的关键声明，供人工核对。
 * 用法: node tools/dump-dark.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_DARK_ATTRIBUTE } from './dark-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'dist/cds-theme.css'), 'utf8');
const ATTR = `body[${DSH_DARK_ATTRIBUTE}]`;

let start = -1;
let depth = 0;
const blocks = [];
for (let i = 0; i < css.length; i += 1) {
  if (css[i] === '{') {
    if (start === -1) start = i;
    depth += 1;
  } else if (css[i] === '}') {
    depth -= 1;
    if (depth === 0 && start !== -1) {
      blocks.push([start, i]);
      start = -1;
    }
  }
}

const want = [
  '--cds-surface-0',
  '--cds-surface-1',
  '--cds-surface-2',
  '--cds-surface-3',
  '--cds-surface-popover',
  '--cds-text-primary',
  '--cds-border',
  '--cds-border-strong',
];

for (const [s, e] of blocks) {
  const headEnd = css.indexOf('{', s);
  const selector = css.slice(css.lastIndexOf('}', s - 1) + 1, headEnd).trim();
  // 桥接后的 CDS 暗色块选择器以 `[data-mode="dark"]` 开头，DSH 属性只是列表末项，
  // 所以必须用 includes 而不是 startsWith，否则只会命中 §2 的别名块。
  if (!selector.includes(ATTR)) continue;
  const body = css.slice(headEnd + 1, e);
  const cdsDecls = (body.match(/--cds-[a-z0-9-]+\s*:/g) ?? []).length;
  const dswDecls = (body.match(/--dsw-[a-z0-9-]+\s*:/g) ?? []).length;
  console.log(`选择器: ${selector.replace(/\s+/g, ' ').slice(0, 110)}`);
  console.log(`声明数: --cds-* ${cdsDecls} / --dsw-* ${dswDecls}`);
  if (cdsDecls === 0) {
    console.log('  （别名桥接块，仅 --dsw-* → var(--cds-*)）\n');
    continue;
  }
  for (const name of want) {
    const m = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    console.log(`  ${name.padEnd(24)} ${m ? m[1].trim() : '(未重载)'}`);
  }
  console.log('');
}
