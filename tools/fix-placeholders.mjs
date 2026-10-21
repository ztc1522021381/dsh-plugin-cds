/**
 * fix-placeholders.mjs — 把 scrub 留下的「字符串字面量里的占位符」改成模板字符串。
 *
 * 为什么需要这一步：scrub-paths 用 `'${__AI_ROOT__}'` 这种形式替换硬编码路径，
 * 但**单引号字符串不做插值**，结果得到一个字面量 `${__AI_ROOT__}` 目录名，
 * 运行时 ENOENT。
 *
 * 规则：任何单引号字符串里含 `${__XXX__}` 的，把整条字符串换成反引号，
 * 同时把字符串内部的 `\\` 转成 `/`（模板字符串里反斜杠会被当转义符）。
 *
 * 用法: node tools/fix-placeholders.mjs [--check]
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const FILES = globSync('tools/**/*.mjs', { cwd: root })
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => !p.startsWith('tools/fix-placeholders') && !p.startsWith('tools/scrub-paths'));

// 单引号字符串，内容含 ${__XXX__}
const QUOTED = /'([^'\n]*\$\{__[A-Z_]+__\}[^'\n]*)'/g;

let touched = 0;
for (const rel of FILES) {
  const abs = resolve(root, rel);
  const before = readFileSync(abs, 'utf8');

  const after = before.replace(QUOTED, (_m, inner) => {
    // 模板字符串里反斜杠是转义符：路径分隔符统一成正斜杠
    const fixed = inner.replace(/\\\\/g, '/').replace(/\\/g, '/');
    return `\`${fixed}\``;
  });

  if (after !== before) {
    touched += 1;
    const n = (before.match(QUOTED) ?? []).length;
    if (CHECK) {
      console.log(`  ${rel}: ${n} 处`);
    } else {
      writeFileSync(abs, after, 'utf8');
      console.log(`  ✓ ${rel}  (${n} 处)`);
    }
  }
}

console.log(`\n${CHECK ? '待修' : '已修'} ${touched} 个文件`);
