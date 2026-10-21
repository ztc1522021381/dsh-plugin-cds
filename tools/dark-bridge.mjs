/**
 * dark-bridge.mjs — 生成 CDS 暗色作用域到 DSH 的桥接。
 *
 * 问题：cds-theme.css 的暗色重载键在 `[data-mode="dark"], .dark` 上（CDS 自己的约定），
 *      而 DSH 的 ThemePresenter 把暗色标记写成 `<body data-ds-dark-theme>`，且只把
 *      overrideTokens 的 dark 值以**内联 body 样式**写进 `--dsw-*`。两者对不上时，
 *      CDS 的暗色色阶永远不生效，只有那 11 条桥接令牌会跟着 DSH 换色。
 *
 * 做法：不改 vendor 原文（保留可追溯的上游副本），在构建期派生：
 *   把含 `.dark` / `[data-mode="dark"]` 的规则**选择器列表**追加对应的
 *   `body[data-ds-dark-theme]` 变体。声明体与注释一字不动。
 * 于是 CDS 的 209 个暗色令牌在 DSH 暗色下整条链生效，CDS 原生用法也不被破坏。
 *
 * 用法: node tools/dark-bridge.mjs vendor/cds-theme.css   （打印改写统计）
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** DSH ThemePresenter 写在 body 上的暗色标记（见 dsh-client-ui-layout）。 */
export const DSH_DARK_ATTRIBUTE = 'data-ds-dark-theme';

/**
 * 把注释内容替换成等长空白（保留换行），得到结构扫描用的「骨架」文本。
 * 这样 `{` `}` 出现在注释里也不会干扰配平，而输出仍用原文切片。
 * @param {string} css 原始 CSS
 * @returns {string} 与原文等长的骨架文本
 */
function maskComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      const chunk = css.slice(i, stop);
      out += chunk.replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

/**
 * 在一条选择器列表末尾追加 DSH 暗色变体。
 * @param {string} selectorList 逗号分隔的选择器列表（可含换行与缩进）
 * @returns {string} 追加后的列表；无需改写时返回空串
 */
function appendDarkVariant(selectorList) {
  const parts = selectorList
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);

  const added = [];
  for (const sel of parts) {
    if (sel === '[data-mode="dark"]' || sel === '.dark') {
      added.push(`body[${DSH_DARK_ATTRIBUTE}]`);
    } else if (sel.startsWith('[data-mode="dark"] ')) {
      added.push(`body[${DSH_DARK_ATTRIBUTE}] ${sel.slice('[data-mode="dark"] '.length)}`);
    } else if (sel.startsWith('.dark ')) {
      added.push(`body[${DSH_DARK_ATTRIBUTE}] ${sel.slice('.dark '.length)}`);
    }
  }
  if (added.length === 0) return '';
  return [...new Set([...parts, ...added])].join(',\n');
}

/**
 * 逐字符扫描骨架文本，把每条规则的前导选择器交给 appendDarkVariant。
 * 不用正则匹配「选择器 {」，因为选择器列表可以跨行（光学字重补偿那几条就是），
 * 单行正则会把跨行规则整条漏掉。
 * @param {string} css 原始 CSS
 * @returns {{ css: string, rewrites: string[] }} 改写结果与命中的选择器
 */
export function bridgeDarkScope(css) {
  const skeleton = maskComments(css);
  const rewrites = [];
  let out = '';
  let preludeStart = 0;
  let depth = 0;
  let i = 0;

  const flushPrelude = (end) => {
    const prelude = css.slice(preludeStart, end);
    const skeletonPrelude = skeleton.slice(preludeStart, end);
    // 选择器判定用骨架（注释已被抹成空格）；原前导里的注释单独摘出来原样保留
    const bare = skeletonPrelude.trim();
    if (bare.length === 0 || bare.startsWith('@')) return prelude;
    if (!/\.dark|data-mode="dark"/.test(bare)) return prelude;
    const bridged = appendDarkVariant(bare);
    if (bridged === '') return prelude;
    const comments = (prelude.match(/\/\*[\s\S]*?\*\//g) ?? []).join('\n');
    rewrites.push(bare.replace(/\s+/g, ' ').slice(0, 120));
    return `${comments.length > 0 ? `${comments}\n` : '\n'}${bridged} `;
  };

  while (i < skeleton.length) {
    const ch = skeleton[i];
    if (ch === '{') {
      out += flushPrelude(i);
      out += '{';
      depth += 1;
      preludeStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      out += css.slice(preludeStart, i);
      out += '}';
      depth = Math.max(0, depth - 1);
      preludeStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === ';' && depth === 0) {
      out += css.slice(preludeStart, i + 1);
      preludeStart = i + 1;
    }
    i += 1;
  }
  out += css.slice(preludeStart);

  return { css: out, rewrites };
}

/** CLI 入口。 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const src = readFileSync(file, 'utf8');
  const { css, rewrites } = bridgeDarkScope(src);
  console.log(`命中规则数: ${rewrites.length}`);
  for (const r of rewrites) console.log(`  · ${r}`);
  console.log(`字节: ${src.length} -> ${css.length} (+${css.length - src.length})`);
}
