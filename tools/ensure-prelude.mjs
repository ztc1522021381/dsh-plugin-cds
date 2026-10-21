/**
 * ensure-prelude.mjs — 给缺少占位符定义的文件补上 prelude。
 *
 * scrub-paths 的 prelude 注入曾按 `__PROFILE_DIR__` 判断，只用了 `__AI_ROOT__`
 * 的文件就被漏掉，运行时 `ReferenceError: __AI_ROOT__ is not defined`。
 * 这里按「引用了任意占位符但没有 prelude」统一补齐。
 *
 * 用法: node tools/ensure-prelude.mjs [--check]
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const PRELUDE = `
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

const FILES = globSync('tools/**/*.mjs', { cwd: root })
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => !/tools\/(scrub-paths|fix-placeholders|ensure-prelude)/.test(p));

let touched = 0;
for (const rel of FILES) {
  const abs = resolve(root, rel);
  const src = readFileSync(abs, 'utf8');

  const uses = /__[A-Z_]+__/.test(src);
  const has = src.includes('// __scrub_prelude__');
  if (!uses || has) continue;

  const bannerEnd = src.indexOf('*/');
  const at = bannerEnd === -1 ? 0 : bannerEnd + 2;
  const next = src.slice(0, at) + PRELUDE + src.slice(at);

  touched += 1;
  if (CHECK) console.log(`  需要补: ${rel}`);
  else {
    writeFileSync(abs, next, 'utf8');
    console.log(`  ✓ ${rel}`);
  }
}

console.log(`\n${CHECK ? '待补' : '已补'} ${touched} 个文件`);
