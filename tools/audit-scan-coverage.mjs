/**
 * audit-scan-coverage.mjs — 检查上一轮类名扫描有没有漏掉大文件。
 *
 * 上一轮为了避开 devtools 的 lighthouse chunk，跳过了 >4MB 的 js。
 * 但「主界面 bundle 本身很大」也是可能的 —— 如果被跳过，那份扫描结论就是空的。
 * 这里列出所有被跳过的文件及其体积，把盲区明确摊开。
 *
 * 用法: node tools/audit-scan-coverage.mjs
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

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = `${__AI_ROOT__}`;
const LIMIT = 4_000_000;

const big = [];
const byArea = new Map();
let total = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    total += 1;
    const rel = p.replace(ROOT, '').replace(/\\/g, '/');
    const area = /devtools/.test(rel) ? 'devtools' : 'app-shell';
    const cur = byArea.get(area) ?? { files: 0, bytes: 0 };
    byArea.set(area, { files: cur.files + 1, bytes: cur.bytes + st.size });
    if (st.size > LIMIT) big.push([rel, st.size]);
  }
}
walk(ROOT);

console.log(`扫描目录: ${ROOT}`);
console.log(`js 文件总数: ${total}\n`);
for (const [area, s] of [...byArea].sort()) {
  console.log(`  ${area.padEnd(12)} ${String(s.files).padStart(5)} 个, ${(s.bytes / 1e6).toFixed(1)} MB`);
}

console.log(`\n超过 ${LIMIT / 1e6}MB 而被跳过的文件: ${big.length} 个`);
for (const [rel, size] of big.sort((a, b) => b[1] - a[1])) {
  const isDev = /devtools/.test(rel);
  console.log(`  ${(size / 1e6).toFixed(1).padStart(6)} MB  ${isDev ? 'devtools' : '★app-shell'}  ${rel}`);
}

const appShellBig = big.filter(([rel]) => !/devtools/.test(rel));
console.log(`\n${appShellBig.length === 0
  ? '✓ 被跳过的全部是 devtools chunk —— 主界面（app shell）没有被跳过，上一轮结论有效。'
  : `⚠ 有 ${appShellBig.length} 个 app-shell 大文件被跳过，上一轮扫描存在盲区，需要补扫。`}`);
