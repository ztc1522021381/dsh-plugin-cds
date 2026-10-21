/**
 * diff-profile.mjs — 输出本次对 desktop profile 的全部改动，以及安装副本的逐字节核对。
 *
 * 为什么要单独做：profile 的改动是最难「看一眼就信」的部分 ——
 * package.json 里多一行、bundles 里多一项，看不出实际装了什么；
 * 而 pnpm 的 file: 依赖可能因缓存/hoisting 装成旧快照（本项目就踩过）。
 * 这里把「声明改了什么」与「实际装了什么」分开打印，并做内容哈希比对。
 *
 * 用法: node tools/diff-profile.mjs
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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${__PROFILE_DIR__}`;
const PKG = 'dsh-plugin-cds';
const SRC = resolve(root, 'plugin');
const DEST = resolve(PROFILE, 'node_modules', PKG);

const h = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/** 递归列出目录下的相对文件路径。 */
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

console.log('═'.repeat(72));
console.log(`profile: ${PROFILE}`);
console.log('═'.repeat(72));

// ── 1. package.json 的改动 ──────────────────────────────────────────────
const cur = JSON.parse(readFileSync(resolve(PROFILE, 'package.json'), 'utf8'));
const backups = existsSync(PROFILE)
  ? readdirSync(PROFILE).filter((n) => n.startsWith('_backup-cds-')).sort()
  : [];
const latest = backups.at(-1);
const orig = latest === undefined
  ? null
  : JSON.parse(readFileSync(resolve(PROFILE, latest, 'package.json'), 'utf8'));

console.log(`\n1 · dependencies 差异${latest === undefined ? '（无备份可比）' : `（基线 ${latest}）`}`);
if (orig !== null) {
  const a = orig.dependencies ?? {};
  const b = cur.dependencies ?? {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (a[k] === undefined) console.log(`  + ${k}: ${b[k]}`);
    else if (b[k] === undefined) console.log(`  - ${k}: ${a[k]}`);
    else console.log(`  ~ ${k}: ${a[k]} → ${b[k]}`);
  }
}

console.log('\n2 · bundles 差异');
if (orig !== null) {
  const a = orig.dsh?.profile?.bundles ?? [];
  const b = cur.dsh?.profile?.bundles ?? [];
  for (const name of b) {
    if (!a.includes(name)) console.log(`  + [${b.indexOf(name)}] ${name}`);
  }
  for (const name of a) {
    if (!b.includes(name)) console.log(`  - ${name}`);
  }
  console.log(`  bundles: ${a.length} → ${b.length} 条`);
}

// ── 3. 安装副本逐字节核对 ───────────────────────────────────────────────
console.log('\n3 · 安装副本 vs 源码（plugin/ → node_modules/dsh-plugin-cds/）');
if (!existsSync(DEST)) {
  console.log(`  ✗ 未安装: ${DEST}`);
  process.exit(1);
}
const srcFiles = walk(SRC);
const destFiles = walk(DEST);
let mismatch = 0;
for (const rel of srcFiles) {
  const s = resolve(SRC, rel);
  const d = resolve(DEST, rel);
  if (!existsSync(d)) {
    console.log(`  ✗ 缺失: ${rel}`);
    mismatch += 1;
    continue;
  }
  const hs = h(readFileSync(s));
  const hd = h(readFileSync(d));
  const same = hs === hd;
  if (!same) mismatch += 1;
  console.log(`  ${same ? '✓' : '✗'} ${rel.padEnd(34)} ${hs} ${same ? '=' : '≠'} ${hd}`);
}
const extra = destFiles.filter((f) => !srcFiles.includes(f));
if (extra.length > 0) console.log(`  · 安装侧额外文件: ${extra.join(', ')}`);

// ── 4. 运行时是否真的会看到它 ──────────────────────────────────────────
console.log('\n4 · 装载状态');
console.log(`  bundles 含本包: ${(cur.dsh?.profile?.bundles ?? []).includes(PKG) ? '是' : '否'}`);
console.log(`  依赖声明: ${cur.dependencies?.[PKG] ?? '(无)'}`);
console.log(`  dsh.client.platform: ${JSON.parse(readFileSync(resolve(DEST, 'package.json'), 'utf8')).dsh?.client?.platform ?? '(无)'}`);
console.log(`  客户端半: ${(statSync(resolve(DEST, 'lib/client.js')).size / 1024).toFixed(1)} KB`);
console.log(`  主题层:   ${(statSync(resolve(DEST, 'dist/cds-theme.css')).size / 1024).toFixed(1)} KB`);

console.log(`\n${mismatch === 0 ? '✓ 安装副本与源码逐字节一致' : `✗ ${mismatch} 个文件不一致`}`);
process.exit(mismatch === 0 ? 0 : 1);
