/**
 * sync-profile.mjs — 把 plugin/ 同步进 desktop profile 并逐字节核对。
 *
 * 为什么不走 pnpm：profile 用 `file:./_local-pkgs/dsh-plugin-cds` 声明依赖，
 * nodeLinker 是 hoisted，所以 pnpm 把它**复制**成普通目录而不是软链。实测过三条路都不行：
 *   · `pnpm install`           → 只比对 lockfile 的 specifier 字符串，内容变了报 "Already up to date"；
 *   · 删掉副本再 `pnpm install` → 它不会重建（lockfile 里已经"装过"了）；
 *   · `pnpm add`               → 能重建，但会把 specifier 改写成 `file:_local-pkgs\dsh-plugin-cds`
 *                                （反斜杠、丢 `./`），跨平台不可读，且每次同步都要再改回来。
 *
 * 结论：副本既然是普通目录，就直接覆盖。两个位置都写：
 *   · _local-pkgs/  —— 依赖声明的源头，将来任何 pnpm install 都从这里取；
 *   · node_modules/ —— 应用启动时真正被 import 的那份。
 * 这样既不触发 pnpm 的 specifier 改写，也不依赖 lockfile 的刷新时机。
 *
 * 用法: node tools/sync-profile.mjs
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

import { cpSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${__PROFILE_DIR__}`;
const PKG = 'dsh-plugin-cds';
const SRC = resolve(root, 'plugin');
const STAGED = resolve(PROFILE, '_local-pkgs', PKG);
const INSTALLED = resolve(PROFILE, 'node_modules', PKG);

const h = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/** 递归列出相对文件路径（正斜杠）。 */
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

/** 整目录替换复制（先删再拷，避免残留已删除的旧文件）。 */
function mirror(from, to) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

// ── 0. 前置检查：依赖必须已声明（否则副本装了也不会被加载）─────────────
const manifest = JSON.parse(readFileSync(resolve(PROFILE, 'package.json'), 'utf8'));
const spec = manifest.dependencies?.[PKG];
const inBundles = (manifest.dsh?.profile?.bundles ?? []).includes(PKG);
if (spec === undefined || !inBundles) {
  console.error(`✗ profile 未声明本包：dependencies=${spec ?? '(无)'}, bundles=${inBundles}`);
  console.error('  先执行 tools/install-profile.mjs 完成声明，再跑本脚本。');
  process.exit(1);
}
console.log(`▸ 依赖声明: ${spec}`);
console.log(`▸ bundles: ${inBundles ? '含本包' : '缺失'}`);

// ── 1. 镜像到 _local-pkgs ───────────────────────────────────────────────
console.log(`\n▸ 镜像源码 → _local-pkgs`);
mirror(SRC, STAGED);
console.log(`  ${walk(STAGED).length} 个文件`);

// ── 2. 镜像到 node_modules（应用真正加载的那份）────────────────────────
console.log(`▸ 镜像源码 → node_modules`);
mirror(SRC, INSTALLED);
console.log(`  ${walk(INSTALLED).length} 个文件`);

// ── 3. 逐字节核对两处副本 ──────────────────────────────────────────────
const srcFiles = walk(SRC);
let mismatch = 0;
for (const [label, dest] of [['_local-pkgs', STAGED], ['node_modules', INSTALLED]]) {
  for (const rel of srcFiles) {
    const d = resolve(dest, rel);
    if (!existsSync(d)) {
      console.error(`  ✗ ${label}: 缺失 ${rel}`);
      mismatch += 1;
      continue;
    }
    const hs = h(readFileSync(resolve(SRC, rel)));
    const hd = h(readFileSync(d));
    if (hs !== hd) {
      console.error(`  ✗ ${label}: 内容不同 ${rel}  ${hs} ≠ ${hd}`);
      mismatch += 1;
    }
  }
}
if (mismatch === 0) console.log(`\n  ✓ 两处副本各 ${srcFiles.length} 个文件，逐字节一致`);

console.log(`\n${mismatch === 0 ? '✓ profile 已同步，重启应用后生效' : `✗ ${mismatch} 处不一致`}`);
process.exit(mismatch === 0 ? 0 : 1);
