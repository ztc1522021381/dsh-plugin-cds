/**
 * install-profile.mjs — 把 dsh-plugin-cds 声明进 desktop profile（幂等）。
 *
 * 只改两个地方，且都可回滚：
 *   1. package.json 的 dependencies：加 `dsh-plugin-cds: file:./_local-pkgs/dsh-plugin-cds`
 *   2. package.json 的 dsh.profile.bundles：把本包插在 dsh-web-search-edge 之后
 *      （位置不敏感，但固定在同一个锚点后，重复执行不会漂移）
 *
 * 改前备份到 _backup-cds-<时间戳>/，并打印 diff。
 * 实际文件复制交给 tools/sync-profile.mjs —— 那条路绕开了 pnpm 的 specifier 改写。
 *
 * 用法: node tools/install-profile.mjs
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

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${__PROFILE_DIR__}`;
const PKG = 'dsh-plugin-cds';
const SPEC = `file:./_local-pkgs/${PKG}`;
const ANCHOR = 'dsh-web-search-edge';

const pkgPath = resolve(PROFILE, 'package.json');
const before = JSON.parse(readFileSync(pkgPath, 'utf8'));

// ── 先算改动，再决定是否备份 ───────────────────────────────────────────
// 无条件备份会每次执行都留一份目录，跑几遍就堆出一排内容相同的快照，
// 反而让人分不清哪份是真正的「改动前」。只在确实要写文件时才备份。
const nextDeps = { ...(before.dependencies ?? {}) };
nextDeps[PKG] = SPEC;
const sortedDeps = Object.fromEntries(
  Object.entries(nextDeps).sort(([a], [b]) => a.localeCompare(b)),
);
const bundles0 = before.dsh?.profile?.bundles;
if (!Array.isArray(bundles0)) {
  console.error('✗ profile 缺少 dsh.profile.bundles');
  process.exit(1);
}
const needsDep = before.dependencies?.[PKG] !== SPEC
  || JSON.stringify(Object.keys(before.dependencies ?? {})) !== JSON.stringify(Object.keys(sortedDeps));
const needsBundle = !bundles0.includes(PKG);

if (!needsDep && !needsBundle) {
  console.log(`▸ 无需改动（依赖 ${SPEC}，bundles[${bundles0.indexOf(PKG)}]），未写文件、未备份`);
  console.log('\n✓ 声明已是目标状态。下一步: node tools/sync-profile.mjs');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backupDir = resolve(PROFILE, `_backup-cds-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(pkgPath, resolve(backupDir, 'package.json'));
const patchPath = resolve(PROFILE, 'cordis.patch.yml');
if (existsSync(patchPath)) copyFileSync(patchPath, resolve(backupDir, 'cordis.patch.yml'));
console.log(`▸ 备份 → ${backupDir}`);

// ── 改动 ────────────────────────────────────────────────────────────────
const after = JSON.parse(JSON.stringify(before));
after.dependencies = sortedDeps;

const bundles = after.dsh.profile.bundles;
if (needsBundle) {
  const at = bundles.indexOf(ANCHOR);
  const insertAt = at === -1 ? bundles.length : at + 1;
  bundles.splice(insertAt, 0, PKG);
  console.log(`▸ bundles 插入位置: [${insertAt}]（锚点 ${ANCHOR} 之后）`);
} else {
  console.log(`▸ bundles 已含本包（位置 [${bundles.indexOf(PKG)}]），不重复插入`);
}

writeFileSync(pkgPath, `${JSON.stringify(after, null, 2)}\n`, 'utf8');

// ── 打印 diff ──────────────────────────────────────────────────────────
console.log('\n▸ package.json 改动');
const a = before.dependencies ?? {};
const b = after.dependencies ?? {};
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (a[k] === b[k]) continue;
  console.log(a[k] === undefined ? `  + ${k}: ${b[k]}` : b[k] === undefined ? `  - ${k}: ${a[k]}` : `  ~ ${k}: ${a[k]} → ${b[k]}`);
}
const ba = before.dsh?.profile?.bundles ?? [];
const bb = after.dsh?.profile?.bundles ?? [];
for (const name of bb) if (!ba.includes(name)) console.log(`  + bundles[${bb.indexOf(name)}] ${name}`);
console.log(`  bundles: ${ba.length} → ${bb.length} 条`);

console.log('\n✓ 声明完成。下一步: node tools/sync-profile.mjs');
