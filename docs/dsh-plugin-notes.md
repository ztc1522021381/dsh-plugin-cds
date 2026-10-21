# 写 DSH 客户端插件的坑（实测记录）

> 适用版本：DeepSeek Harness `0.2.1-alpha.1`，Cordis `~4.0.5-alpha.1`。
> 本文所有结论都来自实际跑通一个主题插件（`dsh-plugin-cds`）的过程，
> 每条都附了验证方法——不是从文档抄的，文档里大多没写。

这些坑的共同特征是**静默失败**：不报错、不警告，只是功能悄悄不生效。
排查成本远高于普通报错，所以逐条记下来。

---

## 1. `overrideTokens` 的参数是「按名字配对」，不是「按模式分组」

`ctx.theme.overrideTokens(source, tokens)` 要求每条值是 `{ light, dark }` 成对：

```js
// ✓ 正确
ctx.theme.overrideTokens('my-plugin', {
  '--dsw-alias-brand-primary': { light: '#c6613f', dark: '#c6613f' },
});

// ✗ 错误：传成按模式分组
ctx.theme.overrideTokens('my-plugin', {
  light: { '--dsw-alias-brand-primary': '#c6613f' },
  dark:  { '--dsw-alias-brand-primary': '#c6613f' },
});
```

后者会让它收到 `light` / `dark` 两个键（值还是对象不是字符串），**抛 `TypeError`**。

这是本文唯一会报错的坑，好查。但如果你从 CSS 变量表直接生成覆盖表，
很容易自然产出「按模式分组」的形状——我就这么踩了一次。

**验证**：把令牌表打印出来，确认每条值都有 `light` 和 `dark` 两个字符串字段。

---

## 2. `exports` 白名单会静默吃掉本地化标题

插件面板的卡片标题来自 `locale/<lang>.json` 的 `meta.title`。文件存在、内容正确，
但标题仍显示裸包名——因为 `readPluginMeta` 通过 `loader.resolveSync` 解析
`<pkg>/locale/en.json`，而 `exports` 是**白名单**：

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json"   // ← 少了这条，标题就退化成包名
  }
}
```

缺这条时抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，被 `optionalResourcePath` **捕获后返回
undefined**——零报错，只是标题变回 `dsh-plugin-cds`。

这个坑我卡了很久：文件明明在，`cat` 出来内容完全正确，就是不生效。

**验证**：

```js
import { readPluginMeta } from '@deepseek-ai/dsh-app-boot';
const meta = readPluginMeta('my-plugin', pathToFileURL(pkgPath).href);
console.log(meta.title); // 期望 { en: '...', zh: '...' }，不是 'my-plugin'
```

直接调真实实现，别自己重写一份——重写只能证明「我抄对了」。

---

## 3. `dsh.client.inject` 是**包名**，不是 Cordis 服务名

同一个 `inject` 概念在两处含义完全不同：

| 位置 | 填什么 | 例子 |
|---|---|---|
| `dsh.client.inject`（manifest） | **npm 包名**（模块图依赖） | `["@deepseek-ai/dsh-client-ui-renderer"]` |
| `export const inject`（client.js） | **Cordis 服务名** | `["theme", "slots", "locale"]` |

写错不会报错，只是加载顺序不对——你的 `apply` 可能在依赖就绪前被调用。

**验证**：对照官方包的 manifest。我核对了 40+ 个官方包，`dsh.client.inject`
全部是包名。

---

## 4. `--dsw-alias-*` 只声明在 `:root`，body 作用域的变量传不进去

DSH 把暗色令牌写成 **body 上的内联样式**（配合 `body[data-ds-dark-theme]` 属性），
而 `:root` 里声明的 `--dsw-alias-*` 在**声明处**就完成了 `var()` 求值。

结果：你在 `body[data-ds-dark-theme]` 里定义的 `--cds-*` 暗色值，
永远传不到 `:root` 的 `--dsw-alias-*`。

**修法**：别名块声明两次——`:root` 一次，`body[data-ds-dark-theme]` 一次。

```css
:root { --dsw-alias-brand-primary: var(--cds-brand); }
body[data-ds-dark-theme] { --dsw-alias-brand-primary: var(--cds-brand); }
```

这个坑的可怕之处：颜色**看起来是对的**，只是暗色下个别层级有偏差，
像是「设计本来如此」。

---

## 5. `data-ds-dark-theme` 设得太晚，首屏闪白

在 `DOMContentLoaded` 里设这个属性已经晚了——该事件**晚于模块脚本执行**，
所以插件读到的还是亮色状态。

**修法**：`<body>` 之后立刻用内联 `<script>` 设，不要等任何事件。

```html
<body>
<script>document.body.dataset.dsDarkTheme = '';</script>
```

---

## 6. pnpm 对 `file:` 目录依赖不感知内容变化

profile 用 `file:./_local-pkgs/my-plugin` 声明本地插件，`nodeLinker: "hoisted"`
会把它**复制**成普通目录。之后：

| 操作 | 结果 |
|---|---|
| `pnpm install` | 只比对 lockfile 的 specifier 字符串 → `Already up to date` |
| 删掉副本再 `pnpm install` | 不重建（lockfile 认为已装过） |
| `pnpm add` | 能重建，但把 specifier 改写成 `file:_local-pkgs\my-plugin`（反斜杠、丢 `./`） |

三条路都不通。

**修法**：既然副本是普通目录，就直接镜像覆盖，绕开 pnpm：

```js
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
```

两处都要写：`_local-pkgs/`（依赖声明源头）和 `node_modules/`（启动时真正 import 的那份）。

---

## 7. 令牌回读要用 `document.body`，不是 `documentElement`

DSH 把令牌写成 body 内联样式。用 `document.documentElement` 读
`getComputedStyle().getPropertyValue('--dsw-alias-bg-base')` 会拿到 `:root` 的值，
**不是你看到的那个**。

```js
// ✗ 读到的是 :root 声明，可能是旧值
getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base');

// ✓
getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base');
```

这个坑最阴：色块明明是暗的，读出来却是亮值。你会怀疑插件没生效，
实际上只是读错了地方。

---

## 8. 自定义属性变成「guaranteed-invalid」时，兜底值也不生效

CSS 里循环引用的处理常被误解：

```css
--cds-radius: var(--cds-radius, 8px);  /* 自引用 */
```

兜底值 `8px` **不会**生效。兜底只在变量「缺失」时启用，而循环属于「无效值」——
整条声明失效，属性变成 guaranteed-invalid，`getPropertyValue()` 返回空串。

**推论**：改名令牌时要专门检测自引用环。我批量给 30 个无前缀令牌加 `--cds-`
前缀时就撞上了，靠定点迭代才查出 `--cds-border-strong → --cds-alpha-3` 这类环。

---

## 9. 插件面板不显示 ≠ 插件没生效

面板列表来自 `plugin-manager` 的 `listBundles()`，它读的是 **profile 的
`package.json`**（`dependencies` + `dsh.profile.bundles`），不是插件市场 registry。
所以本地 `file:` 依赖**是能列出来的**。

如果列表里没有，先查这三处：

1. `dependencies` 里有没有声明
2. `dsh.profile.bundles` 里有没有
3. `node_modules/<pkg>` 是否真实存在

而「插件在不在跑」是另一个问题，看像素最快：

```js
// 侧边栏背景：DSH 默认 #1b1b1c，CDS 覆盖后 #0b0b0b
// 主区域背景：DSH 默认 #151517，CDS 覆盖后 #151515
```

我一度以为插件没装，实际是面板分区（内置 / 实验性 / **已安装**）没滚到底，
加上标题是裸包名认不出来。

---

## 10. 客户端插件不走 HMR，必须完全退出重启

改了 `lib/client.js`，热重载不会重新执行 manifest 解析。`locale/`、`icon.png`、
`exports` 都是**启动时**读取的。

面板里改开关会触发 fiber 重建（`apply` 重新跑），但**改文件不会**。

---

## 附：验证清单

写一个客户端插件，交付前至少跑这 6 项：

| # | 检查 | 方法 |
|---|---|---|
| 1 | manifest 形状 | 对照官方包，`platform` 必须是 `"web"` |
| 2 | `exports["./client"]` 存在 | 缺了会抛 `declares dsh.client but exports no "./client" bundle` |
| 3 | `exports["./locale/*.json"]` 存在 | 见坑 2 |
| 4 | 令牌表每条 `{light, dark}` | 见坑 1 |
| 5 | `ctx.provide("theme")` 确实存在 | `grep 'provide("theme")' dsh-client-ui-theme/lib/client.js` |
| 6 | 卸载路径能清干净 | `ctx.effect` 的 cleanup 要移除 `<style>` 并释放令牌层 |

本文对应的可运行实现见仓库 `tools/verify-*.mjs`，共 12 步自检。
