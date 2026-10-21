/**
 * probe-plugin-panel.mjs — 弄清插件面板的「已安装」列表从哪来、为什么看不到本地插件。
 *
 * 用法: node tools/probe-plugin-panel.mjs
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

const show = (label, needle, before = 220, after = 420) => {
  const i = c.indexOf(needle);
  console.log(`\n=== ${label} ===`);
  if (i === -1) { console.log('  (未找到)'); return; }
  console.log(`  ${c.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' ')}`);
};

show('安装输入 placeholder', 'installSpecPlaceholder');
show('pluginInventory 使用点', 'pluginInventory');
show('已安装列表渲染', 'partsFilter');

console.log('\n=== 所有 install* 文案键 ===');
const keys = new Set();
for (const m of c.matchAll(/"?(install[A-Za-z]+)"?\s*:/g)) keys.add(m[1]);
console.log([...keys].sort().join('\n'));

console.log('\n=== 所有 source* 文案键 ===');
const keys2 = new Set();
for (const m of c.matchAll(/"?(source[A-Za-z]+)"?\s*:/g)) keys2.add(m[1]);
console.log([...keys2].sort().join('\n'));
