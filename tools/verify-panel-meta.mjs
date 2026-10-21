/**
 * verify-panel-meta.mjs — 用 DSH 自己的 readPluginMeta 验证面板会显示什么。
 *
 * 这是本次「插件找不到」问题的回归断言：
 *   · 没有 locale/*.json → 面板只显示裸包名 dsh-plugin-cds（中文界面认不出）
 *   · 没有 icon → 卡片是空占位
 *
 * 直接 import 官方实现，而不是重写一份 —— 重写只能证明「我抄对了」，
 * 调用真实现才能证明「DSH 真的会这样显示」。
 *
 * 用法: node tools/verify-panel-meta.mjs
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

import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// Windows 绝对路径不能直接 import，必须先转成 file:// URL。
const { readPluginMeta } = await import(
  pathToFileURL(`${__AI_ROOT__}/dsh-app-boot/lib/index.js`).href
);

const PKG = 'dsh-plugin-cds';
const DIRS = [
  `${__PROFILE_DIR__}/node_modules/dsh-plugin-cds`,
  `${__PROFILE_DIR__}/_local-pkgs/dsh-plugin-cds`,
  `${__PROJECT_ROOT__}/plugin`,
];

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ← ${detail}`}`); }
};

for (const dir of DIRS) {
  const pkgPath = `${dir}/package.json`;
  if (!existsSync(pkgPath)) { console.log(`\n▸ ${dir}\n  (目录不存在，跳过)`); continue; }
  console.log(`\n▸ ${dir.replace(`${__PROFILE_DIR__}/`, 'profile:').replace(`${__PROJECT_ROOT__}/`, '源码:')}`);

  const meta = readPluginMeta(PKG, pathToFileURL(pkgPath).href);
  if (meta === undefined) {
    check('readPluginMeta 有返回', false, '返回 undefined —— 面板不会显示标题/图标');
    continue;
  }
  if (meta.error !== undefined) {
    check('无元数据错误', false, meta.error);
    continue;
  }
  check('无元数据错误', true);
  const t = meta.title;
  const d = meta.description;
  console.log(`    title       ${JSON.stringify(t)}`);
  console.log(`    description ${JSON.stringify(d)?.slice(0, 90)}…`);
  console.log(`    icon        ${meta.icon === undefined ? '(无)' : `有，${String(meta.icon).slice(0, 40)}…`}`);

  check('title 是本地化对象', typeof t === 'object' && t !== null);
  check('title.zh 有中文名', typeof t?.zh === 'string' && t.zh.trim() !== '');
  check('title.en 有英文名', typeof t?.en === 'string' && t.en.trim() !== '');
  check('description.zh 存在', typeof d?.zh === 'string' && d.zh.trim() !== '');
  check('icon 已解析', meta.icon !== undefined && meta.icon !== null);
  // 关键回归：zh 标题不能退化成裸包名
  check('title.zh 不等于裸包名', t?.zh !== PKG, `实际 ${JSON.stringify(t?.zh)}`);
}

// ── 面板分区归属 ───────────────────────────────────────────────────────────
// 光有标题还不够：卡片必须落在「已安装」段。面板把 bundle 列表放在
// bundlesTitle（中文「已安装」）下，而「内置插件配置 / 实验性插件」是另一套渲染，
// 我们的插件不会出现在那两段里 —— 用户滚动到那里找不到，就会以为没装上。
const panelPath = `${__AI_ROOT__}/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`;
if (existsSync(panelPath)) {
  console.log('\n▸ 面板分区');
  const panel = readFileSync(panelPath, 'utf8');
  const bundlesTitle = panel.match(/bundlesTitle\s*:\s*"([^"]+)"/)?.[1];
  const officialTitle = panel.match(/officialTitle\s*:\s*"([^"]+)"/)?.[1];
  console.log(`    bundlesTitle  = ${JSON.stringify(bundlesTitle)}`);
  console.log(`    officialTitle = ${JSON.stringify(officialTitle)}`);
  check('bundlesTitle 为「已安装」', bundlesTitle === '已安装', `实际 ${JSON.stringify(bundlesTitle)}`);
  // listBundles 的数据源必须是 profile manifest（而不是 registry）
  const src = readFileSync(`${__AI_ROOT__}/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js`, 'utf8');
  check('listBundles 读 profile manifest', /listBundles\(\)\s*\{\s*const manifest = readProfileManifest/.test(src));
}

console.log(`\n${'═'.repeat(60)}`);
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail} 项失败 / ${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
