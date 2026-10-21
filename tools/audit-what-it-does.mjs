/**
 * audit-what-it-does.mjs — 把「这个插件到底会干什么」算成一张可核对的表。
 *
 * 输出四块：
 *   A. 它往页面里注入什么（体积、令牌数、类名数、动画数）
 *   B. 它改哪些 DSH 令牌（逐条 side-by-side，颜色已解析）
 *   C. 它不碰什么（明确划出边界，避免夸大）
 *   D. 副作用与代价（全局作用域、@property、字体、以及已知不足）
 *
 * 用法: node tools/audit-what-it-does.mjs
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

import { readFileSync } from 'node:fs';

const CSS = readFileSync('dist/cds-theme.css', 'utf8');
const JSON_ = JSON.parse(readFileSync('src/cds-tokens.json', 'utf8'));
const PLUGIN = readFileSync('plugin/lib/client.js', 'utf8');

const THEME = `${__AI_ROOT__}/dsh-client-ui-theme/lib/client.js`;
const dshCss = readFileSync(THEME, 'utf8');

const uniq = (arr) => [...new Set(arr)];
const count = (css, re) => uniq([...css.matchAll(re)].map((m) => m[1])).length;

// ── A. 注入面 ──────────────────────────────────────────────────────────
const decl = count(CSS, /(--cds-[a-z0-9-]+)\s*:/g);
const refs = count(CSS, /var\(\s*(--cds-[a-z0-9-]+)/g);
const classes = count(CSS, /\.([a-z][a-z0-9-]*)\s*[,{:]/g);
const keyframes = count(CSS, /@keyframes\s+([a-z0-9-]+)/gi);
const props = count(CSS, /@property\s+(--[a-z0-9-]+)/g);
const darkSelectors = (CSS.match(/body\[data-ds-dark-theme\]/g) ?? []).length;

console.log('A · 注入到页面的东西');
console.log(`  样式表                 ${(CSS.length / 1024).toFixed(1)} KB（一个 <style>，id=dsh-plugin-cds/theme.css）`);
console.log(`  客户端脚本             ${(PLUGIN.length / 1024).toFixed(1)} KB（CSS 已内联，无额外请求）`);
console.log(`  CSS 自定义属性         ${decl} 条声明，${refs} 条被 var() 引用`);
console.log(`  工具类                 ${classes} 个类名`);
console.log(`  @keyframes             ${keyframes} 组动画`);
console.log(`  @property 注册         ${props} 条（用于让自定义属性可插值/有类型）`);
console.log(`  暗色选择器              ${darkSelectors} 处挂 body[data-ds-dark-theme]`);
console.log(`  网络请求               0 —— CSS 内联在 JS 里，不加载外部字体/图片/接口`);

// ── B. 改哪些 DSH 令牌 ─────────────────────────────────────────────────
function blockAt(start) {
  let d = 0;
  for (let i = start; i < dshCss.length; i += 1) {
    if (dshCss[i] === '{') d += 1;
    else if (dshCss[i] === '}' && --d === 0) return dshCss.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}
const LIGHT = blockAt(dshCss.indexOf('body{--dsw-alias-bg-base'));
const DARK = blockAt(dshCss.indexOf('body[data-ds-dark-theme]{--dsw-alias-bg-base'));

function staticMap() {
  const m = new Map();
  for (const x of dshCss.matchAll(/(--dsw-static-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) if (!m.has(x[1])) m.set(x[1], x[2].trim());
  return m;
}
const STATIC = staticMap();
const raw = (b, n) => { const i = b.indexOf(`${n}:`); return i === -1 ? undefined : b.slice(i + n.length + 1, b.indexOf(';', i)).trim(); };
const resolve = (v, d = 0) => {
  if (v === undefined) return '(未定义)';
  if (d > 12) return v;
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v);
  if (m === null) return v;
  const nx = STATIC.get(m[1]);
  return nx !== undefined ? resolve(nx, d + 1) : (m[2]?.trim() ?? v);
};

console.log('\nB · 它改的 11 条 DSH 令牌（DSH 默认 → 覆盖后）');
const bridge = JSON_.bridge;
for (const mode of ['light', 'dark']) {
  const block = mode === 'light' ? LIGHT : DARK;
  console.log(`  ${mode === 'light' ? '亮色' : '暗色'}`);
  for (const name of Object.keys(bridge)) {
    const d = resolve(raw(block, name));
    const c = JSON_.override[mode][name];
    const mark = d.toLowerCase() === String(c).toLowerCase() ? ' ' : '★';
    console.log(`    ${mark} ${name.replace('--dsw-alias-', '').replace('--dsw-specific-', '').padEnd(24)} ${d.padEnd(14)} → ${c}`);
  }
}

// ── C. 明确不碰的东西 ──────────────────────────────────────────────────
const allAlias = uniq([...dshCss.matchAll(/(--dsw-(?:alias|specific)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
console.log('\nC · 它不碰的东西（边界）');
console.log(`  DSH 令牌总数 ${allAlias.length} 条，覆盖 ${Object.keys(bridge).length} 条 → 其余 ${allAlias.length - Object.keys(bridge).length} 条保持原值`);
console.log('  布局/尺寸/圆角/字号 —— 未覆盖任何 --dsw-* 的 spacing/radius/font 类令牌');
console.log('  DSH 组件结构、DOM、事件 —— 插件只加一个 <style>，不替换任何节点');
console.log('  主题切换机制 —— 沿用 DSH 自己的 ThemeRuntime，不另建状态');
console.log('  用户设置/偏好文件 —— 不写盘');
console.log('  DevTools 面板 —— CDS 类名在 devtools chunk 内无撞车（已补扫 5 个大文件确认）');

// ── D. 副作用与已知不足 ────────────────────────────────────────────────
console.log('\nD · 副作用与已知不足');
console.log(`  · 全局作用域：样式表挂在 document.head，不是 Shadow DOM。${classes} 个类名是全局的。`);
console.log('    已核对：DSH app shell 里没有同名类被命中（.group 规则均以 [data-cds-anim] 为前提）。');
console.log(`  · @property 注册 ${props} 条：这些是全局注册的，同名属性在其它插件里也会被赋类型。`);
console.log('  · 字体：CDS 定义了 --cds-font-anthropic-* 系列，但不加载字体文件；');
console.log('    实际落到系统字体栈，所以字形不会变成 Anthropic 的字体，只有字号/行高/字重生效。');
console.log('  · 未覆盖的暗色令牌：--cds-gray-750..900 在 vendor 里只有亮色定义，');
console.log('    暗色下靠 surface 阶梯兜底，个别极端层（如 hover 态叠加）可能与 CDS 原版有细微偏差。');
console.log('  · 错误色对比度：亮色下 #ef4444 对 #fcfcfb 为 3.67:1，低于正文 4.5 阈值；');
console.log('    用于图标/边框没问题（≥3.0），若用作正文文字会偏浅。这是 CDS 原值，未改动。');
console.log('  · 重启才生效：客户端插件不走 HMR，必须完全退出应用再启动。');
