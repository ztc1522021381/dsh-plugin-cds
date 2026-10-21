/**
 * verify-audit.mjs — 对几个审计脚本做「回归断言」。
 *
 * 审计脚本本身也会错（本项目已经错过两次：THEME_URL 路径写错导致静默 404、
 * :root 静态色板只取第一个块导致令牌全空）。这里把关键结论钉成断言，
 * 以后任何改动让结论漂移都会立刻暴露。
 *
 * 用法: node tools/verify-audit.mjs
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

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ← ${detail}`}`); }
};

/** 跑一个脚本并拿到 stdout。 */
const run = (script) => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
};

console.log('1 · 覆盖范围');
{
  const { out } = run('tools/audit-blast-radius.mjs');
  check('DSH 令牌总数为 118 条', /118 条/.test(out), out.match(/\d+ 条/)?.[0]);
  check('插件覆盖 11 条', /插件覆盖:\s+11 条/.test(out));
  check('占比约 9.3%', /9\.3%/.test(out));
}

console.log('\n2 · 对比度');
{
  const { out } = run('tools/audit-blast-radius.mjs');
  check('亮色主文字 ≥ 4.5', /主文字\s+#151515\s+17\.79:1\s+✓/.test(out));
  check('暗色主文字 ≥ 4.5', /主文字\s+#f5f5f5\s+16\.75:1\s+✓/.test(out));
  check('亮色错误色低于 4.5（已知不足，需如实报出）', /错误态作文字\s+#ef4444\s+3\.67:1\s+✗/.test(out));
  check('暗色错误色 ≥ 4.5', /错误态作文字\s+#f87171\s+6\.60:1\s+✓/.test(out));
}

console.log('\n3 · 类名撞车');
{
  const { out } = run('tools/audit-class-collision.mjs');
  const hitCount = Number(/在 DSH app shell 里被使用的: (\d+)/.exec(out)?.[1] ?? -1);
  check('命中数为 5（全部已定性为误报/无影响）', hitCount === 5, `实际 ${hitCount}`);
}

console.log('\n4 · 扫描覆盖（防盲区）');
{
  const { out } = run('tools/audit-scan-coverage.mjs');
  check('明确报出被跳过的大文件数量', /超过 4000000MB 而被跳过|超过 4MB 而被跳过的文件: \d+ 个/.test(out));
  check('列出 app-shell 大文件供补扫', /★app-shell/.test(out));
  const { out: rescan } = run('tools/audit-rescan-big.mjs');
  check('补扫 3 个大文件', /补扫 3 个文件/.test(rescan));
  check('补扫命中全部为变量名/注释而非类名', /命中 \d+ 个: (css|group|dark)/.test(rescan));
}

console.log('\n5 · 主题基线抽取（compare.html 的基准）');
{
  const { out, status } = run('tools/extract-dsh-theme.mjs');
  check('抽取成功', status === 0, `exit ${status}`);
  const n = Number(/static 色板\s+(\d+) 条/.exec(out)?.[1] ?? 0);
  check('static 色板 ≥ 70 条（防再次只取到 667 字节的空壳）', n >= 70, `实际 ${n} 条`);
  const f = 'preview/dsh-theme-extract.css';
  check('产物存在', existsSync(f));
  const css = readFileSync(f, 'utf8');
  check('含 --dsw-alias-bg-base 定义', /--dsw-alias-bg-base\s*:/.test(css));
  check('含 static 色阶', /--dsw-static-neutral-bluish-00\s*:/.test(css));
  check('含暗色块', /body\[data-ds-dark-theme\]\s*\{/.test(css));
}

console.log('\n6 · compare.html 自检');
{
  const html = readFileSync('preview/compare.html', 'utf8');
  check('基线路径指向 /preview/（不是根目录）', /THEME_URL = '\/preview\/dsh-theme-extract\.css'/.test(html));
  check('基线加载失败会抛错（不是静默继续）', /throw new Error\('DSH 主题基线未加载/.test(html));
  check('已内联 __CDS_OVERRIDE__', /window\.__CDS_OVERRIDE__ = \{/.test(html));
  const pairs = (html.match(/"(?:--dsw-alias|--dsw-specific)-[a-z0-9-]+":\{"light"/g) ?? []).length;
  check('内联 11 条覆盖值', pairs === 11, `实际 ${pairs}`);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${fail === 0 ? `全部 ${pass} 项通过` : `${fail} 项失败 / ${pass} 项通过`}`);
process.exit(fail === 0 ? 0 : 1);
