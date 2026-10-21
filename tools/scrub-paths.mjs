/**
 * scrub-paths.mjs — 发布前把硬编码的本机路径换成环境变量 / 占位符。
 *
 * 为什么必须做：这些文件要推到公开仓库。本机用户名、用户目录绝对路径
 * 一旦推上去就被索引，事后删除也留痕。
 *
 * 替换策略（不是简单删掉，要保持脚本仍可运行）：
 *   · profile 目录      → process.env.DSH_PROFILE_DIR ?? 由 DSH_HOME 派生
 *   · @deepseek-ai 根   → 由 DSH_HOME 派生
 *   · dsh 安装根        → npm 全局优先，Electron 打包兜底
 *
 * 注意：源码里 Windows 路径常写成转义形式，所以分隔符必须匹配
 * 「一个或多个反斜杠或正斜杠」，否则漏改。
 *
 * 用法:
 *   node tools/scrub-paths.mjs --check   # 只报告，不改
 *   node tools/scrub-paths.mjs           # 执行改写
 */
import { readFileSync, writeFileSync, globSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const FILES = globSync('{tools,plugin,src,preview}/**/*.{mjs,js,json,yml,html,css,ts}', { cwd: root })
  .concat(['README.md', 'docs/dsh-plugin-notes.md'])
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => existsSync(resolve(root, p)))
  .filter((p) => p !== 'tools/scrub-paths.mjs');

const S = '[\\\\/]+';
const USER = '15220';
const RULES = [
  [new RegExp(`C:${S}Users${S}${USER}${S}\\.dsh${S}profiles${S}node_modules${S}@deepseek-ai`, 'g'), '${__AI_ROOT__}'],
  [new RegExp(`C:${S}Users${S}${USER}${S}AppData${S}Roaming${S}npm${S}node_modules${S}@deepseek-ai${S}dsh`, 'g'), '${__DSH_ROOT__}'],
  [new RegExp(`C:${S}Users${S}${USER}${S}AppData${S}Local${S}Programs${S}DeepSeek Harness${S}resources${S}app\\.asar\\.unpacked${S}dsh`, 'g'), '${__DSH_ROOT__}'],
  [new RegExp(`C:${S}Users${S}${USER}${S}\\.dsh${S}profiles${S}desktop`, 'g'), '${__PROFILE_DIR__}'],
  [new RegExp(`C:${S}Users${S}${USER}${S}\\.dsh`, 'g'), '${__DSH_HOME__}'],
  [new RegExp(`C:${S}Users${S}${USER}`, 'g'), '<USER>'],
  [/E:[\\/]+Desktop[\\/]+DeepSeek[\\/]+DSH work[\\/]+cds-dsh/g, '${__PROJECT_ROOT__}'],
];

const RESIDUAL = new RegExp(`C:${S}Users${S}${USER}|(?<![0-9])${USER}(?![0-9])`, 'g');

function injectPrelude(src) {
  if (!/__[A-Z_]+__/.test(src)) return src;
  if (src.includes('// __scrub_prelude__')) return src;

  const prelude = `
// __scrub_prelude__ 发布前由 tools/scrub-paths.mjs 注入：本机路径改为环境派生。
import { existsSync as __existsSync } from 'node:fs';
const __DSH_HOME__ = process.env.DSH_HOME
  ?? (process.env.USERPROFILE ? \`\${process.env.USERPROFILE}/.dsh\` : '<DSH_HOME>');
const __PROFILE_DIR__ = process.env.DSH_PROFILE_DIR
  ?? \`\${__DSH_HOME__}/profiles/\${process.env.DSH_PROFILE ?? 'desktop'}\`;
const __AI_ROOT__ = \`\${__DSH_HOME__}/profiles/node_modules/@deepseek-ai\`;
const __PROJECT_ROOT__ = process.env.CDS_PROJECT_ROOT ?? process.cwd();
/** dsh 自身安装根：npm 全局优先，Electron 打包兜底。 */
const __DSH_ROOT__ = [
  process.env.APPDATA ? \`\${process.env.APPDATA}/npm/node_modules/@deepseek-ai/dsh\` : undefined,
  process.env.LOCALAPPDATA
    ? \`\${process.env.LOCALAPPDATA}/Programs/DeepSeek Harness/resources/app.asar.unpacked/dsh\`
    : undefined,
].filter(Boolean).find((p) => __existsSync(p)) ?? '<DSH_ROOT>';
`;

  const bannerEnd = src.indexOf('*/');
  const at = bannerEnd === -1 ? 0 : bannerEnd + 2;
  return src.slice(0, at) + prelude + src.slice(at);
}

let touched = 0;
const residual = [];
for (const rel of FILES) {
  const abs = resolve(root, rel);
  let src = readFileSync(abs, 'utf8');
  const before = src;

  for (const [re, to] of RULES) src = src.replace(re, to);
  if (/\.(mjs|js)$/.test(rel)) src = injectPrelude(src);

  if (src !== before) {
    touched += 1;
    if (CHECK) console.log(`  需要改写: ${rel}`);
    else {
      writeFileSync(abs, src, 'utf8');
      console.log(`  ✓ ${rel}`);
    }
  }

  for (const m of src.matchAll(RESIDUAL)) residual.push(`${rel}: ${m[0]}`);
}

console.log(`\n${CHECK ? '待改写' : '已改写'} ${touched} 个文件`);
if (residual.length > 0) {
  console.log(`✗ 仍有 ${residual.length} 处残留:`);
  for (const r of residual.slice(0, 20)) console.log(`  ${r}`);
  process.exit(1);
}
console.log('✓ 无本机路径残留');
