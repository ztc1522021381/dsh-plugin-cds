/**
 * build-plugin.mjs — 生成 plugin/lib/client.js（浏览器半）。
 *
 * 为什么需要生成而不是手写：CDS 样式表 48.8 KB、令牌覆盖 11 对 × 双模式，
 * 手抄进 bundle 必然漂移（改一处 CSS 就要同步改一处 JS 字符串）。这里把
 * dist/cds-theme.css 与 dist/cds-tokens.json 在构建期内联成 JS 字面量，
 * 产物与 dist 严格同源，且每次构建都重新校验条数。
 *
 * 客户端半必须遵守 dsh 的懒加载 CJS 契约（见 dsh-client-modules）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … } })
 *   · 工厂体在**物化时**才执行，所以样式注入放在工厂里，不在脚本顶层；
 *   · 工厂返回 module.exports，末尾必须挂 exports.apply / exports.inject。
 *
 * 用法: node tools/build-plugin.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const plugin = resolve(root, 'plugin');
const libDir = resolve(plugin, 'lib');
const pkgDist = resolve(plugin, 'dist');
mkdirSync(libDir, { recursive: true });
mkdirSync(pkgDist, { recursive: true });

// 把 dist 产物同步进插件目录：package.json 的 exports 声明了 "./theme.css"、
// "./motion"、"./tokens"，若 plugin/dist 不存在，这些导出就是悬空的 —— 消费方
// import 时报 ERR_MODULE_NOT_FOUND，而插件本身（CSS 已内联进 client.js）却照常工作，
// 故障只在下游暴露，极难定位。所以这里必须让声明与实际文件一致。
for (const name of ['cds-theme.css', 'cds-motion.mjs', 'cds-tokens.json']) {
  copyFileSync(resolve(dist, name), resolve(pkgDist, name));
}

const css = readFileSync(resolve(dist, 'cds-theme.css'), 'utf8');
const tokens = JSON.parse(readFileSync(resolve(dist, 'cds-tokens.json'), 'utf8'));

const PKG_ID = 'dsh-plugin-cds';
const SOURCE = 'dsh-plugin-cds';       // overrideTokens 的图层身份
const CSS_TAG_ID = `${PKG_ID}/theme.css`;

/**
 * 转置令牌覆盖表。
 *
 * cds-tokens.json 里 override 是**按模式分组**的：{ light: { name: value }, dark: { … } }，
 * 而 ctx.theme.overrideTokens 要的是**按名字配对**：{ name: { light, dark } }。
 * 直接传原结构会让它收到 "light" / "dark" 两个键（各是对象不是字符串），
 * 运行时抛 TypeError。这一步转置是插件能否生效的关键。
 * @param {{light: Record<string,string>, dark: Record<string,string>}} override
 * @returns {Record<string, {light: string, dark: string}>}
 */
function transposeOverrides(override) {
  const out = {};
  for (const [name, value] of Object.entries(override.light)) {
    out[name] = { light: value, dark: override.dark[name] };
  }
  return out;
}

/** 校验令牌覆盖表：每条都必须是 { light, dark } 成对。 */
const override = transposeOverrides(tokens.override);
const problems = [];
for (const [name, value] of Object.entries(override)) {
  if (typeof value.light !== 'string' || value.light.trim() === '') problems.push(`亮色空值: ${name}`);
  if (typeof value.dark !== 'string' || value.dark.trim() === '') problems.push(`暗色空值: ${name}`);
  if (/var\(/.test(value.light) || /var\(/.test(value.dark)) problems.push(`未求值（含 var）: ${name}`);
}
if (Object.keys(override).length !== Object.keys(tokens.bridge).length) {
  problems.push(`覆盖条数 ${Object.keys(override).length} ≠ 桥接条数 ${Object.keys(tokens.bridge).length}`);
}
if (problems.length > 0) {
  console.error('✗ 令牌覆盖表不完整:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const TOKENS_JSON = JSON.stringify(override, null, 2);

const banner = `/**
 * ${PKG_ID} — 浏览器半（由 tools/build-plugin.mjs 生成，请勿手改）。
 *
 * 职责两条，都在 ctx.effect 里注册，随 fiber 卸载一起回收：
 *   1. 注入 CDS 样式表（\`<style data-plugin-css>\`）：209 个设计令牌 + 52 个工具类，
 *      暗色作用域已桥接到 body[data-ds-dark-theme]（构建期由 tools/dark-bridge.mjs 完成）。
 *   2. 用 ctx.theme.overrideTokens 把 11 条 --dsw-alias-* 指向 CDS 色阶：
 *      这是运行时图层，不写死颜色，主题切换时由 DSH 自己按 light/dark 取值。
 *
 * 样式表内容来自 dist/cds-theme.css（${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)} KB，构建期内联）。
 */
`;

const client = `${banner}window.__ModuleLoader__.load({
	id: "${PKG_ID}",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** 插件 id，同时是样式标签的 data-plugin 值与令牌图层的 source。 */
		const PLUGIN_ID = "${PKG_ID}";
		/** 样式标签身份：同一 id 只会存在一个 <style>，热重载时按内容刷新。 */
		const CSS_TAG_ID = "${CSS_TAG_ID}";
		/** overrideTokens 的图层身份；一个 source 只对应一层，重复调用即整体替换。 */
		const OVERRIDE_SOURCE = "${SOURCE}";

		/** CDS 样式表（构建期内联，与 dist/cds-theme.css 逐字节相同）。 */
		const CSS = ${JSON.stringify(css)};

		/** --dsw-alias-* ← CDS 令牌值，双模式成对。 */
		const TOKENS = ${TOKENS_JSON};

		/**
		 * 注入或刷新样式标签。
		 * 已存在同 id 的标签就按当前 bundle 内容重写（同页面 disable→enable 后
		 * fiber cleanup 会移除标签，所以这里必须能重建，不能只在模块顶层跑一次）。
		 * @returns {HTMLStyleElement|null} 标签，无 document 时返回 null
		 */
		function ensureCss() {
			if (typeof document === "undefined") return null;
			let tag = document.querySelector(\`style[data-plugin-css="\${CSS_TAG_ID}"]\`);
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = PLUGIN_ID;
				tag.dataset.pluginCss = CSS_TAG_ID;
				(document.head || document.documentElement).appendChild(tag);
			}
			// 内容没变就不碰 DOM：重写会让整张样式表重算。
			if (tag.textContent !== CSS) tag.textContent = CSS;
			return tag;
		}

		/** 移除本插件注入的样式标签（卸载路径）。 */
		function dropCss() {
			if (typeof document === "undefined") return;
			const tag = document.querySelector(\`style[data-plugin-css="\${CSS_TAG_ID}"]\`);
			if (tag !== null) tag.remove();
		}

		/** 必需服务：主题注册表（提供 overrideTokens）。 */
		const inject = ["theme"];

		/**
		 * 挂载主题层。
		 * @param ctx - 客户端根上下文
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const tag = ensureCss();
				const disposeTokens = ctx.theme.overrideTokens(OVERRIDE_SOURCE, TOKENS);
				return () => {
					disposeTokens();
					if (tag !== null) dropCss();
				};
			}, "dsh-plugin-cds: CDS theme layer");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.PLUGIN_ID = PLUGIN_ID;
		exports.CSS_TAG_ID = CSS_TAG_ID;
		exports.TOKENS = TOKENS;
		return module.exports;
	}
});
`;

writeFileSync(resolve(libDir, 'client.js'), client, 'utf8');

const kb = (Buffer.byteLength(client, 'utf8') / 1024).toFixed(1);
console.log('生成 plugin/lib/client.js');
console.log(`  体积            ${kb} KB`);
console.log(`  内联 CSS        ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)} KB`);
console.log(`  令牌覆盖        ${Object.keys(override).length} 条 × light/dark`);
console.log(`  override source ${SOURCE}`);
console.log(`  同步产物        plugin/dist/ × 3（theme.css / motion.mjs / tokens.json）`);

// ── 面板元数据自检 ─────────────────────────────────────────────────────────
// plugin-manager 的 readPluginMeta 靠 locale/<lang>.json 的 meta.title/description
// 决定卡片标题；没有它，列表里只显示裸包名 dsh-plugin-cds —— 中文界面下
// 根本认不出这是什么插件（用户反馈"找不到"就是这个原因）。
const pkgJson = JSON.parse(readFileSync(resolve(plugin, 'package.json'), 'utf8'));
const metaProblems = [];
for (const lang of ['en', 'zh']) {
  const f = resolve(plugin, 'locale', `${lang}.json`);
  if (!existsSync(f)) { metaProblems.push(`缺少 locale/${lang}.json`); continue; }
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const t = j?.meta?.title;
  const d = j?.meta?.description;
  if (typeof t !== 'string' || t.trim() === '') metaProblems.push(`locale/${lang}.json 缺 meta.title`);
  if (typeof d !== 'string' || d.trim() === '') metaProblems.push(`locale/${lang}.json 缺 meta.description`);
}
if (typeof pkgJson.icon !== 'string' || pkgJson.icon.trim() === '') {
  metaProblems.push('package.json 缺 icon（面板卡片会是空占位）');
} else {
  const iconPath = resolve(plugin, pkgJson.icon.replace(/^\.\//, ''));
  if (!existsSync(iconPath)) metaProblems.push(`icon 指向的文件不存在: ${pkgJson.icon}`);
  // iconOf 要求相对路径且必须留在包内
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(pkgJson.icon) || pkgJson.icon.startsWith('/') || pkgJson.icon.startsWith('\\')) {
    metaProblems.push(`icon 必须是包内相对路径: ${pkgJson.icon}`);
  }
}
for (const f of pkgJson.files ?? []) {
  if (!existsSync(resolve(plugin, f))) metaProblems.push(`files 列出的文件不存在: ${f}`);
}
// exports 是白名单：readPluginMeta 通过 loader.resolveSync 解析 `<pkg>/locale/en.json`，
// 未导出该子路径时它静默回退到 package.json 的 name —— 于是面板显示裸包名。
if (pkgJson.exports?.['./locale/*.json'] === undefined) {
  metaProblems.push('exports 缺 "./locale/*.json"（readPluginMeta 解析不到本地化标题，面板会退回裸包名）');
}
if (pkgJson.exports?.['./package.json'] === undefined) {
  metaProblems.push('exports 缺 "./package.json"（readPluginMeta 读不到 name/description/icon）');
}
if (metaProblems.length > 0) {
  console.error('✗ 面板元数据不完整:');
  for (const p of metaProblems) console.error(`  - ${p}`);
  process.exit(1);
}
const zhTitle = JSON.parse(readFileSync(resolve(plugin, 'locale', 'zh.json'), 'utf8')).meta.title;
console.log(`  面板标题        ${zhTitle}（locale/zh.json，回退 ${pkgJson.name}）`);
console.log(`  图标            ${pkgJson.icon} ${(readFileSync(resolve(plugin, pkgJson.icon.replace(/^\.\//, ''))).length)} B`);
console.log('✓ 客户端半已生成');
