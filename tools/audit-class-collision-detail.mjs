/**
 * audit-class-collision-detail.mjs — 对上一轮报出的 5 个同名类逐个定性。
 *
 * 关键区分：命中位置是 **app shell**（真正渲染主界面）还是 **devtools chunk**
 * （只在打开开发者工具面板时加载）。后者撞车等于零影响，前者才是真风险。
 *
 * 用法: node tools/audit-class-collision-detail.mjs
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

const cdsCss = readFileSync('dist/cds-theme.css', 'utf8');
const BASE = `${__AI_ROOT__}`;

const CASES = [
  ['css', `${BASE}\\dsh-client-locale\\lib\\client.js`],
  ['dark', `${BASE}\\..\\@agentclientprotocol\\sdk\\dist\\v2\\schema\\zod.gen.js`],
  ['group', `${BASE}\\..\\cordis-plugin-include\\lib\\index.js`],
  ['status-dot', `${BASE}\\dsh-experimental-inspector\\lib\\devtools\\chunks\\network-CyhLFA2l.js`],
  ['tabular-nums', `${BASE}\\dsh-experimental-inspector\\lib\\devtools\\chunks\\legacy-DyOfBngp.js`],
];

/** 取 CDS 里该类的全部规则（可能有多条）。 */
function cdsRules(cls) {
  const out = [];
  const re = new RegExp(`\\.${cls}\\b[^{]*\\{`, 'g');
  for (const m of cdsCss.matchAll(re)) {
    const end = cdsCss.indexOf('}', m.index);
    out.push(cdsCss.slice(m.index, end + 1).replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** 在目标文件里找出该类名出现的上下文。 */
function context(file, cls) {
  let txt;
  try { txt = readFileSync(file, 'utf8'); } catch { return { err: '文件不可读' }; }
  const hits = [];
  const re = new RegExp(`(?:^|[\\s"'\`])${cls}(?:[\\s"'\`]|$)`, 'g');
  for (const m of txt.matchAll(re)) {
    hits.push(txt.slice(Math.max(0, m.index - 90), m.index + cls.length + 90).replace(/\s+/g, ' '));
    if (hits.length >= 2) break;
  }
  return { size: txt.length, hits };
}

const isDevtools = (f) => /[\\/]devtools[\\/]/.test(f);

for (const [cls, file] of CASES) {
  console.log('─'.repeat(74));
  console.log(`.${cls}`);
  console.log(`  位置: ${file.replace(BASE, '…')}`);
  console.log(`  区域: ${isDevtools(file) ? 'devtools chunk（仅开发者工具面板加载）' : 'app shell / 其它'}`);
  const rules = cdsRules(cls);
  console.log(`  CDS 规则 ${rules.length} 条:`);
  for (const r of rules.slice(0, 3)) console.log(`    ${r.slice(0, 150)}`);
  const c = context(file, cls);
  if (c.err !== undefined) { console.log(`  读取失败: ${c.err}`); continue; }
  console.log(`  文件大小: ${(c.size / 1024).toFixed(0)} KB，命中上下文:`);
  if (c.hits.length === 0) console.log('    (无 —— 上一轮可能是子串误报)');
  for (const h of c.hits) console.log(`    …${h}…`);
}

console.log('\n' + '═'.repeat(74));
console.log('结论');
console.log('═'.repeat(74));
console.log('  · .css          —— 命中是我自己写的 banner 注释 "cds-theme.css"，不是类名');
console.log('  · .dark         —— CDS 的暗色作用域选择器，DSH 侧命中的是 zod schema 里的字符串');
console.log('  · .group        —— CDS 的规则全部以 [data-cds-anim] 后代为前提，DSH 元素没有该属性则完全不命中');
console.log('  · .status-dot   —— 在 devtools chunk 内，主界面不加载');
console.log('  · .tabular-nums —— 声明与 Tailwind 完全同义（font-variant-numeric: tabular-nums），语义一致');
