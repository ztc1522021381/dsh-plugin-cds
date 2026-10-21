/**
 * verify-manifest.mjs — 用 DSH 自己的校验规则预检 plugin/package.json。
 *
 * 直接读 dsh-client-modules 的 lib/index.js 取 parseDshClient 的规则太脆，
 * 这里按它的**语义**复刻校验（字段名、类型、报错条件逐条对齐），
 * 目的是在装进 profile 之前就发现「dsh.client 声明不合格」这类只在启动日志里
 * 露一行、GUI 却毫无反应的故障。
 *
 * 用法: node tools/verify-manifest.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = resolve(root, 'plugin');
const pkgPath = resolve(pkgDir, 'package.json');

const checks = [];
const check = (label, pass, extra = '') => checks.push([label, pass, extra]);

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  console.error(`✗ 无法解析 plugin/package.json: ${err.message}`);
  process.exit(1);
}

// ── 基础字段 ────────────────────────────────────────────────────────────
check('name 为 dsh-plugin-cds', pkg.name === 'dsh-plugin-cds', String(pkg.name));
check('type 为 module', pkg.type === 'module', String(pkg.type));
check('version 存在', typeof pkg.version === 'string' && pkg.version.length > 0, String(pkg.version));

// ── exports：必须有 "." 与 "./client" ───────────────────────────────────
const ex = pkg.exports ?? {};
check('exports 含 "."', ex['.'] !== undefined);
check('exports 含 "./client"', ex['./client'] !== undefined,
  '缺失会让 client-modules 报 "declares dsh.client but exports no \'./client\' bundle"');
check('exports 含 "./cordis.patch.yml"', ex['./cordis.patch.yml'] !== undefined);
check('exports 含 "./package.json"', ex['./package.json'] !== undefined);

// ── dsh.bundle.patch ────────────────────────────────────────────────────
const patch = pkg.dsh?.bundle?.patch;
const patchList = Array.isArray(patch) ? patch : patch === undefined ? [] : [patch];
check('dsh.bundle.patch 已声明', patchList.length > 0, String(patch));
for (const p of patchList) {
  check(`补丁文件存在: ${p}`, existsSync(resolve(pkgDir, p)));
}

// ── dsh.client（按 parseDshClient 语义）────────────────────────────────
const decl = pkg.dsh?.client;
check('dsh.client 已声明', decl !== undefined);
check('dsh.client 是对象', typeof decl === 'object' && decl !== null);
check('dsh.client.platform 是字符串', typeof decl?.platform === 'string', String(decl?.platform));
check('platform 为 web', decl?.platform === 'web', String(decl?.platform));
check('inject 是字符串数组', Array.isArray(decl?.inject) && decl.inject.every((s) => typeof s === 'string'),
  JSON.stringify(decl?.inject));
if (decl?.immediately !== undefined) {
  check('immediately 是布尔', typeof decl.immediately === 'boolean', String(decl.immediately));
}
if (decl?.external !== undefined) {
  check('external 是字符串数组', Array.isArray(decl.external) && decl.external.every((s) => typeof s === 'string'));
}

// ── 入口文件实际存在 ────────────────────────────────────────────────────
const mainPath = resolve(pkgDir, pkg.main ?? 'lib/index.js');
check('宿主入口存在', existsSync(mainPath), mainPath);
const clientEntry = typeof ex['./client'] === 'string' ? ex['./client'] : ex['./client']?.default;
check('./client 指向存在的文件', typeof clientEntry === 'string' && existsSync(resolve(pkgDir, clientEntry)), String(clientEntry));

// ── files 白名单覆盖所有入口（发布/软链时不丢文件）───────────────────
const files = pkg.files ?? [];
for (const need of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  check(`files 含 ${need}`, files.includes(need), files.join(','));
}

// ── cordis.patch.yml 内容形态：顶层必须是数组，含 insert ───────────────
const patchText = readFileSync(resolve(pkgDir, patchList[0]), 'utf8');
check('补丁顶层以 "- " 开头（YAML 数组）', /^- /m.test(patchText), patchText.slice(0, 40).replace(/\n/g, '\\n'));
check('补丁含 insert 行', /^-?\s*insert:/m.test(patchText));
check('补丁 insert 的 name 指向本包', /name:\s*dsh-plugin-cds/.test(patchText));

// ── 输出 ────────────────────────────────────────────────────────────────
let failures = 0;
for (const [label, pass, extra] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${pass || !extra ? '' : `  ← ${extra}`}`);
  if (!pass) failures += 1;
}
console.log(`\n结果: ${failures === 0 ? '全部通过' : `${failures} 项不符`}`);
process.exit(failures === 0 ? 0 : 1);
