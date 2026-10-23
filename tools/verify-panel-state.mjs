/**
 * verify-panel-state.mjs — 复现面板两处的显示状态，确认禁用被正确呈现。
 *
 * 面板有两个独立列表，读的是不同来源：
 *   · 「已安装」段 = listBundles()，只看 dsh.profile.bundles（选中/未选中）
 *   · 「插件」段   = listPlugins()，读 profile patch 层的 disabled
 *
 * 我们的禁用写在 profile patch 层，所以：
 *   listBundles → enabled:true（仍在 bundles 里）
 *   listPlugins → 该入口应被判为 disabled
 *
 * 本脚本用 DSH 真实实现分别复现两者，避免只看文件内容自欺。
 *
 * 用法: node tools/verify-panel-state.mjs
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const DSH_HOME = process.env.DSH_HOME ?? `${process.env.USERPROFILE}/.dsh`;
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${DSH_HOME}/profiles/${process.env.DSH_PROFILE ?? 'desktop'}`;
const AI_ROOT = `${DSH_HOME}/profiles/node_modules/@deepseek-ai`;
const ENTRY_ID = 'plugin-cds';

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}${d ? `  ← ${d}` : ''}`); }
};

const boot = await import(pathToFileURL(join(AI_ROOT, 'dsh-app-boot/lib/index.js')).href);

const installAnchor = join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/package.json');
const patchPath = join(PROFILE, 'cordis.patch.yml');

// ── 「插件」段：listPlugins 读的 composeEntries（含全部 patch，不只 insert）──
console.log('▸ 「插件」段（listPlugins 视角）');
const patches = boot.readProfilePatches('dsh', {
  dir: PROFILE, installAnchor, patchPath, home: DSH_HOME, overlays: [],
});
const all = boot.composeEntries([patches], () => {});
const row = all.find((e) => e.id === ENTRY_ID);
check(`组合结果含 ${ENTRY_ID}`, Boolean(row));
check('该条目 disabled === true', row?.disabled === true, String(row?.disabled));
check('name 断言正确', row?.name === 'dsh-plugin-cds', String(row?.name));

// ── 「已安装」段：listBundles 只看 bundles 选中状态 ──────────────────────
console.log('\n▸ 「已安装」段（listBundles 视角）');
const manifest = boot.readProfileManifest('dsh', PROFILE);
const bundles = manifest.dsh?.profile?.bundles ?? [];
check('bundles 仍含本插件（未卸载）', bundles.includes('dsh-plugin-cds'));
check('依赖仍在（未卸载）', Boolean(manifest.dependencies?.['dsh-plugin-cds']),
  String(manifest.dependencies?.['dsh-plugin-cds']));

// ── 两者语义不同，说明为什么面板会这样显示 ─────────────────────────────
console.log('\n▸ 语义说明');
console.log('    「已安装」段显示「已启用」= 仍在 bundles（未卸载）');
console.log('    「插件」段  显示「已禁用」= patch 层 disabled（未运行）');
console.log('    两者不矛盾：这是 DSH 的「禁用 ≠ 卸载」设计。');

// ── patch 文件里确实有这一条 ────────────────────────────────────────────
console.log('\n▸ patch 文件内容');
const text = readFileSync(patchPath, 'utf8');
const block = text.match(new RegExp(`-\\s*id:\\s*${ENTRY_ID}[\\s\\S]{0,120}`))?.[0] ?? '';
console.log(block.split('\n').slice(0, 4).map((l) => `    ${l}`).join('\n'));
check('patch 文件含 disabled: true', block.includes('disabled: true'));

console.log(`\n${'═'.repeat(60)}`);
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail} 项失败 / ${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
