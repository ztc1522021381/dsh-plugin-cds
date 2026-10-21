/**
 * audit-class-collision.mjs — 查 CDS 引入的类名有没有和 DSH 现有类名撞车。
 *
 * 为什么重要：CDS 的工具类（.font-medium / .rounded-lg 之类）是全局 CSS。
 * 如果 DSH 的 app shell 也在用同名类，插件的样式就会**意外改到 DSH 自己的元素**上，
 * 这类问题肉眼极难定位（"某个按钮的字重怎么变了"）。
 *
 * 用法: node tools/audit-class-collision.mjs
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

const ROOT = `${__AI_ROOT__}`;
const cdsCss = readFileSync('dist/cds-theme.css', 'utf8');

const classesOf = (css) =>
  new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{:]/gi)].map((m) => m[1]));

/** CDS 的类名（排除 vendor 里本来就有、属于 DSH 无关的通用名，只留真正新增的）。 */
const cdsClasses = [...classesOf(cdsCss)];

/** 逐个在 DSH 的 js 里找「作为完整字符串/类名出现」的痕迹。 */
const found = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const txt = readFileSync(p, 'utf8');
    if (txt.length > 4_000_000) continue; // devtools/lighthouse chunk 不算 app shell
    for (const c of cdsClasses) {
      if (found.has(c)) continue;
      // 作为 className 里的独立词出现，或 CSS 里被声明为 .c{
      const re = new RegExp(`(?:^|[\\s"'\`])${c}(?:[\\s"'\`]|$)|(?:^|[\\s,>])${c}\\s*\\{`);
      if (re.test(txt)) found.set(c, p.replace(ROOT, '').replace(/\\/g, '/'));
    }
  }
}
walk(ROOT);

console.log(`CDS 引入的类名总数: ${cdsClasses.length}`);
console.log(`在 DSH app shell 里被使用的: ${found.size}\n`);
for (const [c, where] of [...found].sort()) {
  console.log(`  ⚠ .${c.padEnd(20)} ${where}`);
}
if (found.size === 0) {
  console.log('  无撞车 —— CDS 工具类不会影响 DSH 现有界面。');
} else {
  console.log('\n这些名字需要人工确认：若 DSH 元素带同名 class，会被 CDS 的样式命中。');
  // 打印 CDS 里这些规则的具体声明，便于判断危害
  for (const c of found.keys()) {
    const i = cdsCss.indexOf(`.${c}`);
    if (i === -1) continue;
    const end = cdsCss.indexOf('}', i);
    console.log(`\n  .${c} → ${cdsCss.slice(i, end + 1).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}
