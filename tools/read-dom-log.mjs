/**
 * read-dom-log.mjs — 从 --dump-dom 的结果里抽出预览页的日志与探针结果。
 * 用法: node tools/read-dom-log.mjs <dumped.html> [log|probe]
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

const file = process.argv[2];
const mode = process.argv[3] ?? 'log';
const html = readFileSync(file, 'utf8');

if (mode === 'probe') {
  const m = /window\.__CDS_PLUGIN__\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (m === null) {
    console.log('未找到 window.__CDS_PLUGIN__');
    process.exit(1);
  }
  console.log(JSON.stringify(JSON.parse(m[1]), null, 2));
} else {
  const i = html.indexOf('id="log"');
  if (i === -1) {
    console.log('未找到 #log');
    process.exit(1);
  }
  const seg = html.slice(i, i + 2200);
  const text = seg
    .replace(/^[^>]*>/, '')
    .replace(/<\/div>[\s\S]*$/, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  console.log(text.trim());
}
