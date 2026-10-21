/**
 * probe-install-input.mjs — 读插件面板的输入校验逻辑，确认它接受哪些来源。
 *
 * 用户说「插件找不到」，很可能是因为面板里只列出可安装来源（npm/GitHub/.tgz），
 * 而我们装的是本地 file: 目录依赖 —— 它压根不经过面板。
 *
 * 用法: node tools/probe-install-input.mjs
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

const count = (k) => (c.split(k).length - 1);

console.log('=== 关键词出现次数 ===');
for (const k of ['inputProblem', 'installProblem', 'localPath', 'file:', 'directory', 'tarball', '.tgz', 'npm', 'github']) {
  console.log(`  ${k.padEnd(18)} ${count(k)}`);
}

console.log('\n=== 输入校验相关片段 ===');
const re = /.{140}(?:inputProblem|installProblem|localPath|tarball|\.tgz).{140}/g;
let m;
let n = 0;
while ((m = re.exec(c)) !== null && n < 10) {
  n += 1;
  console.log(`--- ${n}`);
  console.log(`  ${m[0].replace(/\s+/g, ' ')}`);
}

console.log('\n=== 安装入口的 placeholder / 提示文案 ===');
const re2 = /placeholder[^,]{0,160}/g;
let k = 0;
while ((m = re2.exec(c)) !== null && k < 8) {
  k += 1;
  console.log(`  ${m[0].replace(/\s+/g, ' ').slice(0, 170)}`);
}
