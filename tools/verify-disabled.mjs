/**
 * verify-disabled.mjs — 用 DSH 真实实现验证插件确实被禁用。
 *
 * 为什么不能只看 profile 文件里有没有 "disabled: true"：
 * patch 匹配不到目标条目时，DSH 会「warn 并跳过」（applyEntryPatches
 * 第 96–98 行），静默失效。必须真的把 patch 组合一遍，看结果条目上
 * 的 disabled 字段。
 *
 * 用法: node tools/verify-disabled.mjs <bundle-name>
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const NAME = process.argv[2] ?? 'dsh-plugin-cds';
const DSH_HOME = process.env.DSH_HOME ?? `${process.env.USERPROFILE}/.dsh`;
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${DSH_HOME}/profiles/${process.env.DSH_PROFILE ?? 'desktop'}`;
const AI_ROOT = `${DSH_HOME}/profiles/node_modules/@deepseek-ai`;

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}${d ? `  ← ${d}` : ''}`); }
};

const boot = await import(pathToFileURL(join(AI_ROOT, 'dsh-app-boot/lib/index.js')).href);

// ── 1. 读 profile 的所有 patch 层并组合 ───────────────────────────────────
console.log('▸ 组合 patch 层');
const installAnchor = join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/package.json');
const patchPath = join(PROFILE, 'cordis.patch.yml');
const warnings = [];
const profile = boot.loadProfileDirectory('dsh', PROFILE, installAnchor, { userLayer: false });
const patches = boot.readProfilePatches('dsh', {
  dir: PROFILE,
  installAnchor,
  patchPath,
  home: DSH_HOME,
  overlays: [],
});
const entries = boot.composeEntries([patches], (msg, ...args) => warnings.push(msg.replace(/%C/g, () => JSON.stringify(args[0]))));

console.log(`  层数 ${profile.layers.length}，patch ${patches.length} 条，组合后条目 ${entries.length}`);

// ── 2. 找到本插件的条目，看 disabled ───────────────────────────────────────
console.log('\n▸ 插件条目');
const mine = entries.filter((e) => e.name === NAME || e.id === 'plugin-cds');
check('组合结果含本插件条目', mine.length > 0, `找到 ${mine.length} 条`);
for (const e of mine) {
  console.log(`    id=${e.id}  name=${e.name}  disabled=${e.disabled}`);
}
const target = mine.find((e) => e.name === NAME) ?? mine[0];
check('条目 disabled === true', target?.disabled === true, String(target?.disabled));

// ── 3. patch 没有「匹配不到」而静默跳过 ───────────────────────────────────
console.log('\n▸ patch 匹配诊断');
const relevant = warnings.filter((w) => w.includes('plugin-cds') || w.includes('plugin_cds'));
check('无「entry not found」告警', !relevant.some((w) => w.includes('not found')), relevant.join('; '));
if (relevant.length) for (const w of relevant) console.log(`    ${w}`);

// ── 4. bundles 里确实有它（否则 patch 层不参与组合）────────────────────────
console.log('\n▸ bundles 选中');
const manifest = boot.readProfileManifest('dsh', PROFILE);
const bundles = manifest.dsh?.profile?.bundles ?? [];
check('bundles 含本插件', bundles.includes(NAME), bundles.join(','));

// ── 5. 依赖仍在（禁用 ≠ 卸载）────────────────────────────────────────────
console.log('\n▸ 安装状态');
check('依赖声明仍在', Boolean(manifest.dependencies?.[NAME]), String(manifest.dependencies?.[NAME]));

console.log(`\n${'═'.repeat(60)}`);
console.log(fail === 0 ? `全部 ${pass} 项通过 —— 插件确认为禁用` : `${fail} 项失败 / ${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
