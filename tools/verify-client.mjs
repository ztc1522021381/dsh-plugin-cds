/**
 * verify-client.mjs — 在 Node 里模拟浏览器环境，真实执行 plugin/lib/client.js。
 *
 * 校验点（任何一条不过都说明插件在 GUI 里会静默失效）：
 *   1. 脚本只调 window.__ModuleLoader__.load({ id, factory })，不立即执行工厂体；
 *   2. 物化后 exports 上有 apply / inject；
 *   3. inject 含 "theme"（否则 ctx.theme 不存在，overrideTokens 直接抛）；
 *   4. apply 会注入 <style>，其 textContent 与 dist/cds-theme.css 逐字节相同；
 *   5. overrideTokens 收到 11 条 { light, dark } 成对值，且 source 正确；
 *   6. 卸载回调会移除 <style> 并调用令牌图层的 disposer；
 *   7. 重复 apply（disable→enable）能重建样式，不残留空标签。
 *
 * 用法: node tools/verify-client.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(resolve(root, 'plugin/lib/client.js'), 'utf8');
const distCss = readFileSync(resolve(root, 'dist/cds-theme.css'), 'utf8');

// ── 极简 DOM 替身：只实现插件用到的那几个接口 ──────────────────────────
class FakeStyle {
  constructor() {
    this.tagName = 'STYLE';
    this.dataset = {};
    this.textContent = '';
    this.removed = false;
  }
  remove() {
    this.removed = true;
    const i = globalThis.document.head.children.indexOf(this);
    if (i >= 0) globalThis.document.head.children.splice(i, 1);
  }
}

const documentStub = {
  head: {
    children: [],
    appendChild(node) {
      this.children.push(node);
      return node;
    },
  },
  documentElement: { appendChild() {} },
  createElement(tag) {
    if (tag !== 'style') throw new Error(`未预期的 createElement: ${tag}`);
    return new FakeStyle();
  },
  querySelector(selector) {
    const m = /^style\[data-plugin-css="(.*)"\]$/.exec(selector);
    if (!m) return null;
    return this.head.children.find((c) => c.dataset.pluginCss === m[1]) ?? null;
  },
};

globalThis.document = documentStub;

// ── ModuleLoader 替身 ───────────────────────────────────────────────────
let registered = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      registered = { id, factory };
    },
  },
};

// ── 执行 bundle ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-new-func
new Function('window', 'document', clientSrc)(globalThis.window, documentStub);

const checks = [];
const check = (label, pass, extra = '') => checks.push([label, pass, extra]);

check('脚本注册了 factory 而未立即执行', registered !== null && typeof registered.factory === 'function');
check('注册 id 为 dsh-plugin-cds', registered?.id === 'dsh-plugin-cds', String(registered?.id));
check('工厂体未提前执行（此时无 <style>）', documentStub.head.children.length === 0);

// ── 物化 ────────────────────────────────────────────────────────────────
const exportsObj = registered.factory((spec) => {
  throw new Error(`客户端半不应 require 任何模块，实际 require 了: ${spec}`);
});

check('exports.apply 存在', typeof exportsObj.apply === 'function');
check('exports.inject 存在', Array.isArray(exportsObj.inject));
check('inject 含 theme', exportsObj.inject?.includes('theme'), JSON.stringify(exportsObj.inject));

// ── 假 ctx ──────────────────────────────────────────────────────────────
const effects = [];
let overrideCall = null;
let disposedTokens = false;
const ctx = {
  effect(fn, label) {
    const cleanup = fn();
    effects.push({ label, cleanup });
    return () => cleanup?.();
  },
  theme: {
    overrideTokens(source, tokens) {
      overrideCall = { source, tokens };
      return () => {
        disposedTokens = true;
      };
    },
  },
};

exportsObj.apply(ctx);

check('注册了一个 effect', effects.length === 1, String(effects.length));
check('effect 带标签', typeof effects[0]?.label === 'string' && effects[0].label.length > 0, effects[0]?.label);
check('注入了 <style>', documentStub.head.children.length === 1, String(documentStub.head.children.length));

const tag = documentStub.head.children[0];
check('style 标签带 data-plugin', tag?.dataset?.plugin === 'dsh-plugin-cds', String(tag?.dataset?.plugin));
check('style 标签带 data-plugin-css', tag?.dataset?.pluginCss === 'dsh-plugin-cds/theme.css', String(tag?.dataset?.pluginCss));
check('style 内容与 dist/cds-theme.css 逐字节相同', tag?.textContent === distCss, `实得 ${tag?.textContent?.length} B / 期望 ${distCss.length} B`);

check('调用了 overrideTokens', overrideCall !== null);
check('override source 正确', overrideCall?.source === 'dsh-plugin-cds', String(overrideCall?.source));

const pairs = overrideCall?.tokens ?? {};
const names = Object.keys(pairs);
check('令牌覆盖 11 条', names.length === 11, String(names.length));
const badPair = names.filter((n) => typeof pairs[n]?.light !== 'string' || typeof pairs[n]?.dark !== 'string');
check('每条都是 { light, dark } 成对字符串', badPair.length === 0, badPair.join(','));
const notDsw = names.filter((n) => !n.startsWith('--dsw-'));
check('全部是 --dsw-* 宿主令牌', notDsw.length === 0, notDsw.join(','));
check('无 var() 残留（overrideTokens 只收字面值）', !JSON.stringify(pairs).includes('var('));

// ── 卸载 ────────────────────────────────────────────────────────────────
effects[0].cleanup();
check('卸载移除了 <style>', documentStub.head.children.length === 0, String(documentStub.head.children.length));
check('卸载调用了令牌 disposer', disposedTokens === true);

// ── 重新 apply（disable → enable）──────────────────────────────────────
exportsObj.apply(ctx);
check('重新 apply 重建了 <style>', documentStub.head.children.length === 1, String(documentStub.head.children.length));
check('重建后内容仍正确', documentStub.head.children[0]?.textContent === distCss);

// ── 输出 ────────────────────────────────────────────────────────────────
let failures = 0;
for (const [label, pass, extra] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${pass || !extra ? '' : `  ← ${extra}`}`);
  if (!pass) failures += 1;
}
console.log(`\n结果: ${failures === 0 ? '全部通过' : `${failures} 项不符`}`);
process.exit(failures === 0 ? 0 : 1);
