/**
 * replay-list-bundles.mjs — 独立复现 plugin-manager 的 listBundles()，看面板会怎么显示我们的插件。
 *
 * 复现而不是猜：listBundles() 是纯文件读取（profile package.json + 安装锚点 manifest
 * + 每个包的 package.json），不依赖运行中的服务，所以可以在这里精确重放。
 *
 * 用法: node tools/replay-list-bundles.mjs
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

import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

const PROFILE = `${__PROFILE_DIR__}`;
const MANIFEST = join(PROFILE, 'package.json');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const selected = manifest.dsh?.profile?.bundles ?? [];
const recorded = manifest.dependencies ?? {};

// installAnchor：dsh 自身安装根的 package.json
const anchorCandidates = [
  `${__DSH_ROOT__}/package.json`,
  `${__DSH_ROOT__}/package.json`,
];
const anchor = anchorCandidates.find((p) => existsSync(p));
if (anchor === undefined) throw new Error('找不到 installAnchor');
const installation = JSON.parse(readFileSync(anchor, 'utf8'));

console.log(`installAnchor: ${anchor}`);
console.log(`selected(bundles): ${selected.length} 条`);
console.log(`recorded(deps):    ${Object.keys(recorded).length} 条`);

const names = [...new Set([...selected, ...Object.keys(recorded), ...Object.keys(installation.dependencies ?? {})])];
console.log(`合并后待列出的名字: ${names.length} 条\n`);

/** 复现 bundleManifest：读包 manifest 的 dsh.bundle.patch。 */
function bundleManifest(name, dir) {
  for (const base of [dir, resolve(dir, 'node_modules')]) {
    const pkgPath = join(base, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
    const patch = pkg.dsh?.bundle?.patch;
    if (patch === undefined) return undefined;
    return { name: pkg.name, version: pkg.version, description: pkg.description, patch, pkgPath };
  }
  return undefined;
}

/** 复现 readPluginMeta：读 dsh.client 声明。 */
function readPluginMeta(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const client = pkg.dsh?.client;
  if (client === undefined) return undefined;
  return { platform: client.platform, inject: client.inject ?? [], immediately: client.immediately === true };
}

const rows = [];
for (const name of names) {
  const installed = Object.keys(recorded).includes(name);
  const enabled = selected.includes(name);
  const shipped = Object.hasOwn(installation.dependencies ?? {}, name);
  const owned = installed && !shipped;
  const optional = false;
  const removable = owned || (enabled && !installed && !shipped);

  const info = bundleManifest(name, PROFILE);
  if (info === undefined) {
    rows.push({ name, enabled, installed, removable, error: enabled ? 'not-bundle' : '(未选中，不列出)' });
    continue;
  }
  const meta = readPluginMeta(info.pkgPath);
  rows.push({
    name,
    version: info.version,
    description: info.description,
    enabled,
    installed,
    removable,
    source: owned ? recorded[name] : undefined,
    meta,
  });
}

console.log('=== 面板列表重放结果 ===');
for (const r of rows) {
  const flags = [
    r.enabled ? '已启用' : '未启用',
    r.installed ? '已安装' : '未安装',
    r.removable ? '可移除' : '受保护',
  ].join(' · ');
  const extra = r.error !== undefined ? `  ⚠ ${r.error}` : '';
  console.log(`  ${String(r.name).padEnd(42)} ${String(r.version ?? '-').padEnd(9)} ${flags}${extra}`);
}

console.log('\n=== 我们的插件 ===');
const ours = rows.find((r) => r.name === 'dsh-plugin-cds');
if (ours === undefined) {
  console.log('  ✗ 不在列表里 —— 面板不会显示它');
} else {
  console.log(`  name      ${ours.name}`);
  console.log(`  version   ${ours.version}`);
  console.log(`  enabled   ${ours.enabled}`);
  console.log(`  installed ${ours.installed}`);
  console.log(`  removable ${ours.removable}`);
  console.log(`  source    ${ours.source}`);
  console.log(`  meta      ${JSON.stringify(ours.meta)}`);
  console.log(`  error     ${ours.error ?? '(无)'}`);
}
