/**
 * verify-npm-pack.mjs — 从真实的 npm tarball 里验证包能不能用。
 *
 * 为什么不能只信 `npm pack --dry-run`：那只列出文件名，不证明
 *   · exports 里的每条路径在包内真实存在
 *   · locale/*.json 能被 readPluginMeta 解析出中文标题
 *   · lib/client.js 是合法的模块工厂
 *   · dsh.bundle.patch 指向的文件真的在
 *
 * 做法：真打一个 tgz → 解到临时目录 → 当它是一个「全新安装」来检查。
 *
 * 用法: node tools/verify-npm-pack.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = join(root, 'plugin');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `  ← ${detail}` : ''}`); }
}

// ── 1. 真打一个 tarball ───────────────────────────────────────────────────
console.log('▸ 打包');
const tmp = mkdtempSync(join(tmpdir(), 'cds-pack-'));
let tgz;
try {
  const out = execFileSync('npm', ['pack', '--pack-destination', tmp], {
    cwd: pluginDir,
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tgz = resolve(tmp, out.trim().split(/\r?\n/).pop());
} catch (e) {
  console.log(`  ✗ npm pack 失败: ${e.message}`);
  process.exit(1);
}
const tgzSize = readFileSync(tgz).length;
console.log(`  ${tgz.split(/[\\/]/).pop()}  ${(tgzSize / 1024).toFixed(1)} KB`);

// ── 2. 解包（模拟全新安装）────────────────────────────────────────────────
const inst = join(tmp, 'node_modules', 'dsh-plugin-cds');
mkdirSync(inst, { recursive: true });
execFileSync('tar', ['-xzf', tgz, '-C', inst, '--strip-components=1'], { stdio: 'ignore' });

const pkgPath = join(inst, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
console.log(`\n▸ 解包到 ${inst.replace(root, '.')}`);

// ── 3. exports 每条路径真实存在 ───────────────────────────────────────────
console.log('\n▸ exports 路径');
for (const [key, val] of Object.entries(pkg.exports ?? {})) {
  const target = typeof val === 'string' ? val : val.default ?? val.types;
  if (target.includes('*')) continue; // 通配由下一步覆盖
  check(`exports["${key}"] → ${target}`, existsSync(join(inst, target)));
}
check('exports 含 "./locale/*.json"', typeof pkg.exports?.['./locale/*.json'] === 'string');
check('exports 含 "./icon"', typeof pkg.exports?.['./icon'] === 'string');

// ── 4. files 白名单每一项都在包里 ─────────────────────────────────────────
console.log('\n▸ files 白名单');
for (const f of pkg.files ?? []) {
  check(f, existsSync(join(inst, f)));
}

// ── 5. 关键文件非空 ───────────────────────────────────────────────────────
console.log('\n▸ 关键文件');
for (const f of ['lib/client.js', 'lib/index.js', 'dist/cds-theme.css', 'icon.png', 'locale/zh.json', 'cordis.patch.yml', 'README.md']) {
  const p = join(inst, f);
  const size = existsSync(p) ? readFileSync(p).length : 0;
  check(`${f}  ${size} B`, size > 0);
}

// ── 6. 客户端半是合法的模块工厂 ───────────────────────────────────────────
console.log('\n▸ 客户端半');
const client = readFileSync(join(inst, 'lib/client.js'), 'utf8');
check('走 __ModuleLoader__.load', client.includes('__ModuleLoader__.load'));
check('声明 id 为包名', client.includes(`id: "dsh-plugin-cds"`));
check('CSS 已内联（无外部 fetch）', !/fetch\(|@import\s+url/.test(client));
check('inject 含 theme 服务', /const inject = \["theme"\]/.test(client));
check('用 overrideTokens', client.includes('overrideTokens'));

// ── 7. 真实 readPluginMeta：标题/图标必须被解析 ──────────────────────────
console.log('\n▸ 面板元数据（调真实实现）');
const bootUrl = pathToFileURL(`${process.env.DSH_HOME ?? `${process.env.USERPROFILE}/.dsh`}/profiles/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`).href;
try {
  const boot = await import(bootUrl);
  const meta = boot.readPluginMeta('dsh-plugin-cds', pathToFileURL(pkgPath).href);
  check('无 meta.error', meta.error === undefined, String(meta.error));
  const t = meta.title;
  check('title.zh 为「CDS 主题」', t?.zh === 'CDS 主题', JSON.stringify(t?.zh));
  check('title.en 为「CDS Theme」', t?.en === 'CDS Theme', JSON.stringify(t?.en));
  check('description.zh 非空', typeof meta.description?.zh === 'string' && meta.description.zh.length > 0);
  check('icon 已解析成 data URL', typeof meta.icon === 'string' && meta.icon.startsWith('data:image/png'));
} catch (e) {
  check('加载 dsh-app-boot', false, e.message);
}

// ── 8. 宿主半可被 Node 加载 ───────────────────────────────────────────────
console.log('\n▸ 宿主半');
try {
  const host = await import(pathToFileURL(join(inst, 'lib/index.js')).href);
  check('name 导出等于包名', host.name === 'dsh-plugin-cds', String(host.name));
  check('apply 是函数', typeof host.apply === 'function');
} catch (e) {
  check('加载 lib/index.js', false, e.message);
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${'═'.repeat(60)}`);
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail} 项失败 / ${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
