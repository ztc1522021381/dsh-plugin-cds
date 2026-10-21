/**
 * probe-panel-sections.mjs — 列出插件面板的所有分区标题与分组逻辑。
 *
 * 目的：确认「第三方/本地插件」到底在面板的哪一段显示，而不是靠滚动截图猜。
 *
 * 用法: node tools/probe-panel-sections.mjs
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

const P = `${__AI_ROOT__}/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`;
const c = readFileSync(P, 'utf8');

console.log('=== 所有含「插件」的中文文案 ===');
const seen = new Set();
for (const m of c.matchAll(/([a-zA-Z]*[Tt]itle|[a-zA-Z]*[Ss]ection|[a-zA-Z]*[Gg]roup|[a-zA-Z]*[Hh]eading)[A-Za-z]*\s*:\s*"([^"]{2,60})"/g)) {
  const v = m[2];
  if (!/[\u4e00-\u9fa5]/.test(v)) continue;
  const k = `${m[1]} = ${v}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  ${k}`);
}

console.log('\n=== 分区/分组相关的标识符 ===');
for (const key of ['sections', 'groups', 'thirdParty', 'third-party', 'community', 'builtin', 'experimental', 'installedSection', 'packagesTitle']) {
  const i = c.indexOf(key);
  if (i === -1) { console.log(`  ${key.padEnd(20)} (无)`); continue; }
  console.log(`  ${key.padEnd(20)} @${i}  ${c.slice(i - 90, i + 140).replace(/\s+/g, ' ')}`);
}
