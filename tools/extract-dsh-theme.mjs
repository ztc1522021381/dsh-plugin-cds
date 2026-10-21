/**
 * extract-dsh-theme.mjs — 从 DSH 内置主题里抠出 body{} 与 body[data-ds-dark-theme]{} 两块，
 * 生成 preview/dsh-theme-extract.css，供 compare.html 做「默认配色」基准。
 *
 * 为什么要单独抽出来：对比图要能证明「差异来自插件而不是我手写的色值」。
 * 所以左栏必须加载 DSH **真实的**默认令牌，而不是我在 HTML 里抄一遍。
 *
 * 用法: node tools/extract-dsh-theme.mjs
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

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = `${__AI_ROOT__}/dsh-client-ui-theme/lib/client.js`;
const OUT = 'preview/dsh-theme-extract.css';

const css = readFileSync(SRC, 'utf8');

/** 从 start 位置的花括号开始，配对到对应的收尾花括号。 */
function blockAt(start) {
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('花括号不配平');
}

const lightStart = css.indexOf('body{--dsw-alias-bg-base');
const darkStart = css.indexOf('body[data-ds-dark-theme]{--dsw-alias-bg-base');
if (lightStart === -1 || darkStart === -1) throw new Error('未找到主题块');

const light = blockAt(lightStart);
const dark = blockAt(darkStart);

// static 色板不能只取「第一个 :root{}」—— 实测那个块只有 667 字节，缺绝大部分色阶，
// 结果 var(--dsw-static-neutral-bluish-00) 解析失败，自定义属性变成 guaranteed-invalid，
// getPropertyValue() 返回空串，页面看上去「DSH 默认本来就没颜色」。
// 正确做法：把全文件里所有 --dsw-static-* 声明收集起来，统一放进一个 :root 块。
const staticDecls = new Map();
for (const m of css.matchAll(/(--dsw-static-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
  if (!staticDecls.has(m[1])) staticDecls.set(m[1], m[2].trim());
}
const rootBlock = `:root {\n${[...staticDecls].map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

const out = `/* 由 tools/extract-dsh-theme.mjs 生成 —— DSH 内置主题的默认令牌，未做任何改动。
   来源: @deepseek-ai/dsh-client-ui-theme/lib/client.js
   用途: preview/compare.html 的「插件未生效」基准栏。
   注意: 这不是插件的产物，是 DSH 自己的默认值。 */

${rootBlock}

${light}

${dark}
`;

writeFileSync(OUT, out, 'utf8');
console.log(`✓ ${OUT}  ${(out.length / 1024).toFixed(1)} KB`);
console.log(`  :root static 色板  ${staticDecls.size} 条 / ${rootBlock.length} 字节`);
console.log(`  亮色 body{}         ${light.length} 字节`);
console.log(`  暗色 body[...]{}    ${dark.length} 字节`);
