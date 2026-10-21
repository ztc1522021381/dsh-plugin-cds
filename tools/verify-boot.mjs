/**
 * verify-boot.mjs — 验证插件会被 DSH 的客户端模块系统接纳（用真实 API，不猜结构）。
 *
 * 三层判据，逐层更接近「浏览器真的会加载它」：
 *   1. profile 侧：bundles 含本包，node_modules 里有它的 package.json，dsh.client 合法；
 *   2. 真实 API：把各包的 dsh.client 声明转成 orderByModuleGraph 的行形态
 *      （{ id, external }），让**真实的** orderByModuleGraph 排一次序，
 *      确认本包在列、且依赖它的包排在其后（顺序错了 boot 时会循环/缺依赖）；
 *   3. 宿主侧：宿主半能被 Node 真加载（Loader 会 import 它），客户端半文件存在。
 *
 * 不调 bootInjections：它的入参是宿主内部组装的 { batches } 结构（含 combo URL
 * 分区、revision、chunk map 等），不是包声明表；硬凑一个假 graph 只会得到
 * 「我喂给它什么它说什么」的假通过。
 *
 * 用法: node tools/verify-boot.mjs
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
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROFILE = process.env.DSH_PROFILE_DIR ?? `${__PROFILE_DIR__}`;
const PKG = 'dsh-plugin-cds';

// 用 profile 依赖的那份 client-modules（与应用运行时同源）
const candidates = [
  resolve(PROFILE, '../node_modules/@deepseek-ai/dsh-client-modules/lib/index.js'),
  resolve(PROFILE, 'node_modules/@deepseek-ai/dsh-client-modules/lib/index.js'),
];
const modPath = candidates.find((p) => existsSync(p));
if (modPath === undefined) {
  console.error(`✗ 找不到 dsh-client-modules，尝试过:\n${candidates.join('\n')}`);
  process.exit(1);
}
const mod = await import(pathToFileURL(modPath).href);

const checks = [];
const check = (label, pass, extra = '') => checks.push([label, pass, extra]);

// ── 1. profile 侧 ───────────────────────────────────────────────────────
const profilePkg = JSON.parse(readFileSync(resolve(PROFILE, 'package.json'), 'utf8'));
const bundles = profilePkg.dsh?.profile?.bundles ?? [];
check('profile bundles 含本包', bundles.includes(PKG), `共 ${bundles.length} 条`);
check('dependencies 声明本包', profilePkg.dependencies?.[PKG] !== undefined,
  String(profilePkg.dependencies?.[PKG]));

const installedPkgPath = resolve(PROFILE, 'node_modules', PKG, 'package.json');
check('本包已安装到 node_modules', existsSync(installedPkgPath), installedPkgPath);

const manifest = existsSync(installedPkgPath)
  ? JSON.parse(readFileSync(installedPkgPath, 'utf8'))
  : {};
check('安装副本的 exports 含 ./client', manifest.exports?.['./client'] !== undefined);
check('安装副本的 dsh.bundle.patch 存在', manifest.dsh?.bundle?.patch !== undefined,
  String(manifest.dsh?.bundle?.patch));
check('安装副本带 dist/cds-theme.css', existsSync(resolve(PROFILE, 'node_modules', PKG, 'dist/cds-theme.css')));

// ── 2. 真实 orderByModuleGraph ──────────────────────────────────────────
// 行形态：{ id, external? }。dsh.client.external 是「本包 require 的其它包」，
// 正是依赖边；inject 是 Cordis 服务名，不参与模块图排序。
const rows = [];
for (const name of bundles) {
  const p = resolve(PROFILE, 'node_modules', name, 'package.json');
  if (!existsSync(p)) continue;
  const m = JSON.parse(readFileSync(p, 'utf8'));
  const decl = m.dsh?.client;
  if (decl === undefined) continue;
  rows.push({ id: name, external: decl.external ?? [] });
}

check('收集到多行客户端模块', rows.length >= 2, `${rows.length} 行`);

let order = null;
let orderError = null;
try {
  order = mod.orderByModuleGraph(rows).map((r) => r.id);
} catch (err) {
  orderError = err.message;
}
check('orderByModuleGraph 无环', orderError === null, String(orderError ?? ''));
check('排序结果含本包', order?.includes(PKG) === true, (order ?? []).join(' → '));

const idx = order?.indexOf(PKG) ?? -1;
const before = idx > 0 ? order.slice(0, idx) : [];
check('本包不在最前（前面有其它客户端模块）', idx > 0, `idx=${idx}, before=${before.join(',')}`);

// 若某行声明 require 本包，它必须排在本包之后
const consumers = rows.filter((r) => r.external.includes(PKG)).map((r) => r.id);
const misplaced = consumers.filter((id) => order.indexOf(id) < idx);
check('消费本包的模块排在其后', misplaced.length === 0, `consumers=${consumers.join(',') || '(无)'}`);

// ── 3. 宿主半 / 客户端半 ────────────────────────────────────────────────
const hostPath = resolve(PROFILE, 'node_modules', PKG, 'lib/index.js');
if (existsSync(hostPath)) {
  const host = await import(pathToFileURL(hostPath).href);
  check('宿主半可被 Node 加载', typeof host.apply === 'function');
  check('宿主半 name 与包名一致', host.name === PKG, String(host.name));
} else {
  check('宿主半可被 Node 加载', false, hostPath);
}

const clientPath = resolve(PROFILE, 'node_modules', PKG, 'lib/client.js');
check('客户端半文件存在', existsSync(clientPath), clientPath);

// ── 输出 ────────────────────────────────────────────────────────────────
console.log(`client-modules: ${modPath}\n`);
let failures = 0;
for (const [label, pass, extra] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${pass || !extra ? '' : `  ← ${extra}`}`);
  if (!pass) failures += 1;
}
console.log(`\n结果: ${failures === 0 ? '全部通过' : `${failures} 项不符`}`);
process.exit(failures === 0 ? 0 : 1);
