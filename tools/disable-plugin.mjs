/**
 * disable-plugin.mjs — 用 DSH 原生机制禁用一个已安装的 bundle 插件。
 *
 * 为什么不用「从 bundles 移除」：那等于「卸载」，插件在面板里会变成
 * 「未安装」，而且会被 dsh-purge-community 之类的工具在改写
 * package.json 时反复冲掉。
 *
 * DSH 的禁用语义（面板开关走的也是这条）：
 *   在 profile 的 cordis.patch.yml 里，对该插件的 patch 入口 id 写
 *   `disabled: true`。cordis-plugin-loader 读到 disabled 就 dispose 掉
 *   fiber，插件的 apply 根本不会执行。
 *
 * 前置条件：插件必须已经在 dsh.profile.bundles 里，否则它的 patch 层
 * 根本不参与组合，写了 disabled 也无从生效。
 *
 * 用法:
 *   node tools/disable-plugin.mjs <bundle-name> [--enable] [--check]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DSH_HOME = process.env.DSH_HOME ?? `${process.env.USERPROFILE}/.dsh`;
const PROFILE = process.env.DSH_PROFILE_DIR ?? `${DSH_HOME}/profiles/${process.env.DSH_PROFILE ?? 'desktop'}`;

const argv = process.argv.slice(2);
const NAME = argv.find((a) => !a.startsWith('--'));
const ENABLE = argv.includes('--enable');
const CHECK = argv.includes('--check');

if (!NAME) {
  console.log('用法: node tools/disable-plugin.mjs <bundle-name> [--enable] [--check]');
  process.exit(1);
}

const manifestPath = join(PROFILE, 'package.json');
const patchPath = join(PROFILE, 'cordis.patch.yml');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// ── 1. 找到插件的 patch 入口 id ───────────────────────────────────────────
// 插件自带 cordis.patch.yml，其中 - insert: 下列出的 id 就是入口。
// 例：- insert: [ { id: plugin-cds, name: dsh-plugin-cds } ]
function findEntryIds(bundleName) {
  const pkgDir = join(PROFILE, 'node_modules', bundleName);
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return { ids: [], reason: '插件未安装到 node_modules' };

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const patchRel = pkg.dsh?.bundle?.patch;
  if (!patchRel) return { ids: [], reason: '插件没有 dsh.bundle.patch（不是 bundle 类型）' };

  const patchFile = join(pkgDir, patchRel);
  if (!existsSync(patchFile)) return { ids: [], reason: `补丁文件不存在: ${patchRel}` };

  const text = readFileSync(patchFile, 'utf8');
  const ids = [];
  // 抓所有 "id: xxx" 且其 name 指向本插件的条目
  for (const m of text.matchAll(/id:\s*([A-Za-z0-9._:-]+)/g)) {
    const id = m[1];
    // 该 id 所属条目里若 name === bundleName，则它就是本插件的入口
    const block = text.slice(text.lastIndexOf('- id:', text.indexOf(id)), text.indexOf(id) + 200);
    if (block.includes(`name: ${bundleName}`) || !block.includes('name:')) ids.push(id);
  }
  return { ids: [...new Set(ids)], reason: null };
}

const { ids: entryIds, reason } = findEntryIds(NAME);
console.log(`▸ 插件 ${NAME}`);
console.log(`  patch 入口 id: ${entryIds.length ? entryIds.join(', ') : '(未找到)'}${reason ? `  ← ${reason}` : ''}`);

if (entryIds.length === 0) {
  console.log('✗ 无法确定入口 id，退出');
  process.exit(1);
}

// ── 2. 确保在 bundles 里（禁用 ≠ 卸载）──────────────────────────────────
const bundles = manifest.dsh?.profile?.bundles ?? [];
const inBundles = bundles.includes(NAME);
console.log(`  bundles 中: ${inBundles ? '是' : '否'}`);

let manifestChanged = false;
if (!inBundles) {
  // 插件已装但没被选中 → 它的 patch 层不参与组合，disabled 无从生效。
  // 必须先加回 bundles，disabled 才有意义。
  const anchor = bundles.indexOf('dsh-web-search-edge');
  const at = anchor >= 0 ? anchor + 1 : bundles.length;
  bundles.splice(at, 0, NAME);
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } };
  manifestChanged = true;
  console.log(`  → 将加入 bundles[${at}]`);
}

// ── 3. 在 profile patch 层写 disabled ────────────────────────────────────
let patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n';

const entries = entryIds.map((id) => ({
  id,
  name: NAME,
  disabled: !ENABLE,
}));

const block = entries
  .map((e) => `- id: ${e.id}\n  name: ${e.name}\n  disabled: ${e.disabled}`)
  .join('\n');

// 移除同名旧条目后重新追加，避免重复 id
const cleaned = patchText
  .split('\n')
  .filter((line, i, arr) => {
    if (!/^-\s*id:\s*/.test(line)) return true;
    const id = line.replace(/^-\s*id:\s*/, '').trim();
    if (!entryIds.includes(id)) return true;
    // 命中旧条目：从这里开始删掉整个条目（到下一个顶层 "- " 或文件尾）
    const end = arr.findIndex((l, j) => j > i && /^-\s*id:/.test(l));
    for (let j = i; j < (end < 0 ? arr.length : end); j += 1) arr[j] = null;
    return false;
  })
  .filter((l) => l !== null)
  .join('\n');

const newPatch = `${cleaned.replace(/\s*$/, '')}\n${block}\n`;

if (CHECK) {
  console.log('\n--check（不改文件）将写入:');
  console.log(block);
  process.exit(0);
}

// ── 4. 备份 + 落盘 ───────────────────────────────────────────────────────
if (manifestChanged || patchText !== newPatch) {
  const bak = join(PROFILE, `_backup-cds-disable-${Date.now()}`);
  mkdirSync(bak, { recursive: true });
  copyFileSync(manifestPath, join(bak, 'package.json'));
  copyFileSync(patchPath, join(bak, 'cordis.patch.yml'));
  console.log(`\n▸ 备份 → ${bak}`);
}

if (manifestChanged) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('✓ package.json 已更新（bundles 加回）');
}
if (patchText !== newPatch) {
  writeFileSync(patchPath, newPatch, 'utf8');
  console.log(`✓ cordis.patch.yml 已更新（${ENABLE ? '启用' : '禁用'}）`);
}

console.log(`\n${ENABLE ? '已启用' : '已禁用'}。需完全退出 DSH 再启动才生效。`);
