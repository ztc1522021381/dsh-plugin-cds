/**
 * build-compare.mjs — 把 CDS 覆盖值内联进 preview/compare.html，做成可截图的自包含页面。
 *
 * 内联而不是 fetch：compare.html 只用一次，避免再引一条请求路径，
 * 也让「页面里出现的每个颜色都能追到 src/cds-tokens.json」这件事成立。
 *
 * 用法: node tools/build-compare.mjs
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

import { readFileSync, writeFileSync } from 'node:fs';

const tokens = JSON.parse(readFileSync('src/cds-tokens.json', 'utf8'));
const html = readFileSync('preview/compare.html', 'utf8');

// override 是「按模式分组」，页面需要的是 { name: { light, dark } }
const transposed = {};
for (const mode of ['light', 'dark']) {
  for (const [name, value] of Object.entries(tokens.override[mode] ?? {})) {
    transposed[name] ??= {};
    transposed[name][mode] = value;
  }
}

const inject = `<script>window.__CDS_OVERRIDE__ = ${JSON.stringify(transposed)};</script>`;
const marker = '<script type="module">';
const at = html.indexOf(marker);
if (at === -1) throw new Error('未找到 module script 标记');

const out = `${html.slice(0, at)}${inject}\n${html.slice(at)}`;
writeFileSync('preview/compare.html', out, 'utf8');

console.log(`✓ preview/compare.html 已内联 ${Object.keys(transposed).length} 条覆盖值`);
for (const [name, pair] of Object.entries(transposed)) {
  console.log(`  ${name.replace('--dsw-alias-', '').replace('--dsw-specific-', '').padEnd(24)} light=${pair.light.padEnd(12)} dark=${pair.dark}`);
}
