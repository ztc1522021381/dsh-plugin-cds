/**
 * verify-npm-live.mjs — 校验 npm 上真实发布的 tarball。
 *
 * 为什么不信任 `npm view`：它只读 packument（元数据），不证明 tarball 内容对。
 * 这里下载真实 tarball、解包、逐文件比对本地构建产物，并验证：
 *   · shasum / integrity 与 packument 一致
 *   · 每个文件与本地 plugin/ 逐字节相同
 *   · locale / icon / exports 仍然可用
 *
 * 用法: node tools/verify-npm-live.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = join(root, 'plugin');
const NAME = 'dsh-plugin-cds';
const localPkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const VERSION = localPkg.version;

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}${d ? `  ← ${d}` : ''}`); }
};

// ── 1. packument ──────────────────────────────────────────────────────────
console.log(`▸ packument  ${NAME}@${VERSION}`);
const pk = await (await fetch(`https://registry.npmjs.org/${NAME}`)).json();
check(`版本 ${VERSION} 存在`, Boolean(pk.versions?.[VERSION]), Object.keys(pk.versions ?? {}).join(','));
check('dist-tags.latest 指向本版', pk['dist-tags']?.latest === VERSION, pk['dist-tags']?.latest);
const meta = pk.versions?.[VERSION] ?? {};
check('license 为 MIT', meta.license === 'MIT', meta.license);
check('description 非空', typeof meta.description === 'string' && meta.description.length > 20);
check('repository 指向 GitHub', String(meta.repository?.url ?? '').includes('github.com/ztc1522021381/dsh-plugin-cds'));

// ── 2. 下载 tarball 并校验哈希 ────────────────────────────────────────────
const tgzUrl = meta.dist?.tarball;
console.log(`\n▸ tarball  ${tgzUrl}`);
const buf = Buffer.from(await (await fetch(tgzUrl)).arrayBuffer());
console.log(`  ${(buf.length / 1024).toFixed(1)} KB`);
const shasum = createHash('sha1').update(buf).digest('hex');
check('sha1 与 packument 一致', shasum === meta.dist?.shasum, `${shasum} vs ${meta.dist?.shasum}`);
const sri = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
check('integrity 与 packument 一致', sri === meta.dist?.integrity);

// ── 3. 解包并逐文件比对 ──────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cds-live-'));
const inst = join(tmp, 'package');
mkdirSync(inst, { recursive: true });
const tgzPath = join(tmp, 'pkg.tgz');
writeFileSync(tgzPath, buf);
execFileSync('tar', ['-xzf', tgzPath, '-C', inst, '--strip-components=1'], { stdio: 'ignore' });

const packed = JSON.parse(readFileSync(join(inst, 'package.json'), 'utf8'));
check('包内 version 一致', packed.version === VERSION, packed.version);
check('包内无 private 字段', packed.private === undefined);

console.log('\n▸ 逐文件比对（线上 vs 本地）');
function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}
const files = walk(inst).filter((f) => f !== 'package.json' || true);
let identical = 0;
const diffs = [];
for (const f of files) {
  const livePath = join(inst, f);
  const localPath = join(pluginDir, f);
  if (!existsSync(localPath)) { diffs.push(`${f} (本地无此文件)`); continue; }
  const a = readFileSync(livePath);
  const b = readFileSync(localPath);
  if (a.equals(b)) identical += 1;
  else diffs.push(`${f} (${a.length} vs ${b.length} B)`);
}
check(`全部 ${files.length} 个文件逐字节一致`, diffs.length === 0, diffs.slice(0, 5).join('; '));
console.log(`  ${identical} / ${files.length} 一致`);

// ── 4. 线上包的面板元数据 ────────────────────────────────────────────────
console.log('\n▸ 线上包的面板元数据');
const bootUrl = pathToFileURL(`${process.env.DSH_HOME ?? `${process.env.USERPROFILE}/.dsh`}/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`).href;
try {
  const boot = await import(bootUrl);
  const m = boot.readPluginMeta(NAME, pathToFileURL(join(inst, 'package.json')).href);
  check('title.zh = 「CDS 主题」', m.title?.zh === 'CDS 主题', JSON.stringify(m.title?.zh));
  check('title.en = 「CDS Theme」', m.title?.en === 'CDS Theme', JSON.stringify(m.title?.en));
  check('icon 已解析', String(m.icon ?? '').startsWith('data:image/png'));
} catch (e) {
  check('readPluginMeta', false, e.message);
}

// ── 5. 线上包可被 Node 加载 ──────────────────────────────────────────────
console.log('\n▸ 线上包可加载');
try {
  const host = await import(pathToFileURL(join(inst, 'lib/index.js')).href);
  check('name 导出正确', host.name === NAME, String(host.name));
  const client = readFileSync(join(inst, 'lib/client.js'), 'utf8');
  check('客户端半含 __ModuleLoader__', client.includes('__ModuleLoader__.load'));
  check('客户端半含 overrideTokens', client.includes('overrideTokens'));
} catch (e) {
  check('加载失败', false, e.message);
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${'═'.repeat(60)}`);
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail} 项失败 / ${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
