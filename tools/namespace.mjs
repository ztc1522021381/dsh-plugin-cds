/**
 * namespace.mjs — CDS 令牌命名空间净化。
 *
 * 问题：CDS 有 30 个**不带前缀**的自定义属性（--radius / --brand / --chat-* / --font-* /
 * --sheet-card-* 等）。装进 DSH 后这些名字落在 :root 上，是全应用共享的命名空间：
 *   · `--radius` 在 dsh-experimental-inspector 的 lighthouse chunk 里被引用 8 次；
 *   · `--brand` / `--radius-md` 之类是任何第三方插件都可能用到的通用词。
 * 一旦 DSH 自己的样式或别的插件恰好也用同名变量，两边会互相污染，而且症状是
 * 「颜色/圆角莫名其妙变了」，排查成本极高。
 *
 * 做法：把不带前缀的名字统一改成 `--cds-<原名>`（幂等；已经是 --cds- 的跳过）。
 *   · 只在构建期作用于 dist 产物，vendor 原文不动；
 *   · 同步改写 @property 注册、var() 引用与声明处；
 *   · 若目标名已被占用且**值相同**，则把该令牌整体合并掉（不再重复声明）。
 *
 * 用法: node tools/namespace.mjs <file.css>  （打印统计）
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 重命名后的目标名。 */
export function cdsName(name) {
  return name.startsWith('--cds-') ? name : `--cds-${name.slice(2)}`;
}

/**
 * 收集一段 CSS 里所有自定义属性「定义点」与「引用点」的无前缀名字。
 * @param {string} css 已去注释的 CSS
 * @returns {{ declared: Set<string>, allDeclared: Set<string>, referenced: Set<string> }}
 *   declared 只含无前缀名；allDeclared 含全部（判定重命名目标是否已被占用要用它）
 */
function collectNames(css) {
  const declared = new Set();
  const allDeclared = new Set();
  const referenced = new Set();
  for (const m of css.matchAll(/(^|[{;\s])(--[a-z0-9-]+)\s*:/gi)) {
    allDeclared.add(m[2]);
    if (!m[2].startsWith('--cds-')) declared.add(m[2]);
  }
  for (const m of css.matchAll(/@property\s+(--[a-z0-9-]+)/g)) {
    allDeclared.add(m[1]);
    if (!m[1].startsWith('--cds-')) declared.add(m[1]);
  }
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!m[1].startsWith('--cds-')) referenced.add(m[1]);
  }
  return { declared, allDeclared, referenced };
}

/**
 * 读出一段 CSS 里某令牌的定义值（用于判定合并是否安全）。
 * @param {string} css 已去注释的 CSS
 * @param {string} name 令牌名
 * @returns {string|undefined} 定义值
 */
function valueOf(css, name) {
  const re = new RegExp(`(?:^|[{;\\s])${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;}]+)`, 'i');
  const m = css.match(re);
  return m ? m[1].trim() : undefined;
}

/**
 * 读出全部令牌定义（名 → 值）。用逐条声明匹配而不是「名 + 冒号」正查，
 * 因为声明可能跨行、值里含 calc() 嵌套括号与 CRLF。
 * @param {string} css 已去注释的 CSS
 * @returns {Map<string, string>} 名 → 值（同名多次定义取最后一次，与 CSS 层叠一致）
 */
function declarationMap(css) {
  const map = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/**
 * 若一条声明值整体就是 `var(<name>…)`（可带兜底值），返回它引用的那个变量名；否则 undefined。
 * 用于识别「别名声明」：`--cds-radius: var(--cds-radius, 8px)` 这种，改名后必然自引用。
 * @param {string} value 声明值
 * @returns {string|undefined} 被引用的变量名
 */
function aliasTargetOf(value) {
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[\s\S]*)?\)$/i.exec(value.trim());
  return m ? m[1] : undefined;
}

/**
 * 取出 `var(--x, 兜底)` 里的兜底值（没有兜底时返回 undefined）。
 * @param {string} value 声明值
 * @returns {string|undefined} 兜底值
 */
function fallbackOf(value) {
  const m = /^var\(\s*--[a-z0-9-]+\s*,\s*([\s\S]+)\)$/i.exec(value.trim());
  return m ? m[1].trim() : undefined;
}

/**
 * 净化命名空间。
 * @param {string} css 原始 CSS（可含注释）
 * @returns {{ css: string, renamed: string[], merged: string[] }}
 */
export function namespaceCdsTokens(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const { declared, allDeclared, referenced } = collectNames(bare);
  const all = new Set([...declared, ...referenced]);
  const values = declarationMap(bare);

  const merged = [];
  const plan = new Map();
  /** 需要在改名**之前**从源码里删掉的别名声明（原文，含分号）。 */
  const dropBefore = [];
  /** 需要在改名**之前**重写值的声明：名 → 新值（用于消解自引用环）。 */
  const rewriteValue = new Map();
  for (const name of all) {
    const target = cdsName(name);
    const a = values.get(name);
    // 情形零：值本身就是 `var(<目标名>, 兜底)`。vendor 里 `--radius: var(--cds-radius, 8px)`
    // 而 `--cds-radius` 并不存在 ⇒ 它一直解析成兜底值 8px。改名后会成为
    // `--cds-radius: var(--cds-radius, 8px)`：自引用环使整条声明失效，兜底也不生效
    // （兜底只在变量缺失时启用，循环是「无效值」）。直接落成兜底值，语义与改名前一致。
    if (a !== undefined && aliasTargetOf(a) === target) {
      const fb = fallbackOf(a);
      if (fb !== undefined) {
        merged.push(`${name} → ${target}（自引用 ${a} 落成兜底值 ${fb}）`);
        rewriteValue.set(name, fb);
        plan.set(name, target);
        continue;
      }
    }
    if (allDeclared.has(target)) {
      const b = values.get(target);
      // 情形一：目标名与原名同值 → 直接合并（改名后两条声明同值，CSS 层叠无副作用）
      if (a !== undefined && b !== undefined && a === b) {
        merged.push(`${name} → ${target}（同值合并）`);
        plan.set(name, target);
        continue;
      }
      // 情形二：目标名本身就是 `var(<原名>)` / `var(<原名>, 兜底)` 的别名。
      // 改名会得到 `--cds-x: var(--cds-x, …)` 的自引用环（CSS 视为无效，值整条丢失）。
      // 正确做法：先删掉那条别名声明，让原名接管目标名。
      if (a !== undefined && b !== undefined && aliasTargetOf(b) === name) {
        merged.push(`${name} → ${target}（接管别名 ${b}，删除自引用声明）`);
        plan.set(name, target);
        dropBefore.push({ name: target, value: b });
        continue;
      }
      // 情形三：名字被占且值不同 → 保留原名，不改名（避免语义被劫持）
      merged.push(`${name} 保持原名（${target} 已被占用且值不同）`);
      plan.set(name, name);
      continue;
    }
    plan.set(name, target);
  }

  // 先删别名声明：用「名 + 值」精确定位，避免误删同名的另一条声明
  let pre = css;
  for (const { name, value } of dropBefore) {
    const re = new RegExp(`[ \\t]*${name.replace(/[-]/g, '\\-')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;[ \\t]*\\r?\\n?`, 'g');
    pre = pre.replace(re, '');
  }

  // 再把自引用别名落成兜底值（同样用「名 + 原值」精确定位）
  for (const [name, fb] of rewriteValue) {
    const a = values.get(name);
    if (a === undefined) continue;
    const re = new RegExp(`(${name.replace(/[-]/g, '\\-')}\\s*:\\s*)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*;)`, 'g');
    pre = pre.replace(re, `$1${fb}$2`);
  }

  // 一次性替换：单遍回调避免链式替换把 --cds-x 又当成 --x 再改一次。
  const renamed = [];
  const final = pre.replace(/(--[a-z0-9-]+)/gi, (whole) => {
    if (whole.startsWith('--cds-')) return whole;
    const target = plan.get(whole);
    if (target === undefined || target === whole) return whole;
    renamed.push(whole);
    return target;
  });

  return { css: final, renamed: [...new Set(renamed)].sort(), merged };
}

/** CLI 入口。 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const src = readFileSync(file, 'utf8');
  const { css, renamed, merged } = namespaceCdsTokens(src);
  console.log(`改名前缀的令牌: ${renamed.length}`);
  console.log(renamed.join(', '));
  console.log(`\n同值合并: ${merged.length}`);
  for (const m of merged) console.log(`  · ${m}`);
  console.log(`\n字节: ${src.length} -> ${css.length}`);
}
