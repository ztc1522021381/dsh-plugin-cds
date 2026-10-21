# dsh-plugin-cds

给 DeepSeek Harness 换上 Anthropic Claude Design System（CDS）配色的客户端插件。

**适配 dsh `0.2.1-alpha.1`**（Cordis `~4.0.5-alpha.1`），已在该版本上实测运行。

它只改颜色，不动别的：11 条宿主令牌、0 次网络请求、0 个 DOM 节点替换。

---

## 它做什么

DSH 定义了 118 条 `--dsw-alias-*` / `--dsw-specific-*` 设计令牌。本插件覆盖其中 **11 条**，每条同时给亮色和暗色两套值。

最明显的变化是品牌色：DSH 原本亮色用近黑 `#0f1115`、暗色用近白 `#f9fafb`，CDS 统一改成陶土橙 `#c6613f`。

| 令牌 | 亮色 DSH → CDS | 暗色 DSH → CDS |
|---|---|---|
| `brand-primary` | `#0f1115` → `#c6613f` | `#f9fafb` → `#c6613f` |
| `bg-base` | `#fff` → `#fcfcfb` | `#151517` → `#151515` |
| `bg-layer-1` | `#fff` → `#fff` | `#232324` → `#1a1a19` |
| `bg-layer-2` | `#fff` → `#fff` | `#2c2c2e` → `#20201f` |
| `bg-overlay` | `#e9ecf2` → `#fff` | `#61666b` → `#2c2c2a` |
| `border-l1` | `#0000000a` → `hsla(0,0%,8%,.10)` | `#ffffff0f` → `hsla(0,0%,100%,.09)` |
| `border-l2` | `#0000001a` → `hsla(0,0%,8%,.20)` | `#ffffff1f` → `hsla(0,0%,100%,.18)` |
| `label-primary` | `#0f1115` → `#151515` | `#f9fafb` → `#f5f5f5` |
| `label-secondary` | `#61666b` → `#525252` | `#cfd3d6` → `#a3a3a3` |
| `state-error-primary` | `#ec1313` → `#ef4444` | `#f25a5a` → `#f87171` |
| `sidebar-fill` | `#f9fafb` → `#f9f9f7` | `#1b1b1c` → `#0b0b0b` |

覆盖占比 **11 / 118 = 9.3%**，其余 107 条保持 DSH 原值。加上 2 条派生令牌（`button-primary-fill` 跟着品牌色、`menu-icon` 跟着主文字色），实际影响约 13 条。

### 附带的两样东西

**CDS 完整色阶** —— 219 条 CSS 自定义属性（`--cds-surface-100`、`--cds-gray-750` 等），供其它插件按 CDS 风格配色使用。界面本身不依赖它们。

**动效物理常量** —— 4 条弹簧预设 + 4 条贝塞尔曲线，`import` 自 `dsh-plugin-cds/motion`：

| 预设 | 刚度/阻尼 | 阻尼比 | 超调 | 稳定时间 |
|---|---|---|---|---|
| `SPRING_BOUNCY` | 600/30 | 0.612 | +8.77% | 0.244s |
| `SPRING_SNAPPY` | 320/28 | 0.783 | +1.93% | 0.203s |
| `SPRING_GENTLE` | 380/18 | 0.462 | +19.49% | 0.427s |
| `SPRING_HEAVY_SNAP` | 1200/80, mass 0.1 | 3.652 | 0% | 0.258s |

---

## 它不做什么

- **不碰布局** —— 零 spacing / radius / font 令牌覆盖
- **不碰 DOM** —— 只往 `<head>` 加一个 `<style>`，不替换任何节点
- **不碰主题机制** —— 沿用 DSH 自己的 `ThemeRuntime`，不另建状态
- **不写盘** —— 不修改任何用户设置
- **不发网络请求** —— CSS 内联在 JS 里，不加载外部字体或图片

注入规模：样式表 45.9 KB（单个 `<style>`）、客户端脚本 51.4 KB、219 条属性声明、43 个工具类名、30 组 `@keyframes`、23 条 `@property` 注册。

---

## 安装

```bash
# 1. 构建
node tools/build.mjs
node tools/build-plugin.mjs

# 2. 声明进 profile（幂等，自动备份）
node tools/install-profile.mjs

# 3. 镜像文件到 profile 两处副本
node tools/sync-profile.mjs
```

然后**完全退出 DSH 再启动** —— 客户端插件不走 HMR，改文件不会热重载。

在「插件」面板往下滚到**「已安装」**段，能看到标题为 **CDS 主题**、带陶土橙图标的卡片。开关可即时启停。

---

## 已知不足

| 问题 | 说明 |
|---|---|
| 亮色错误色偏浅 | `#ef4444` 对 `#fcfcfb` 只有 **3.67:1**，低于正文要求的 4.5（图标/边框够用）。CDS 原值，未改动。 |
| 字体不生效 | CDS 定义了 `--cds-font-anthropic-*`，但字体文件未随上游发布，实际落到系统字体栈。只有字号/行高/字重生效。 |
| `--cds-gray-750..900` 仅亮色 | 暗色下靠 surface 阶梯兜底，个别 hover 态叠加可能与 CDS 原版有细微偏差。 |
| 全局作用域 | 43 个类名挂在 `:root`，未做 Shadow DOM 隔离。已扫描 DSH 全部 8135 个 JS 文件，5 处撞车全部良性。 |

---

## 开发

```bash
node tools/verify-all.mjs     # 12 步自检
```

单独步骤：

```bash
node tools/make-icon.mjs         # 生成 icon.png（手写 PNG 编码，无第三方依赖）
node tools/extract-tokens.mjs    # CDS → 已求值 light/dark + 桥接表
node tools/build.mjs             # 命名空间净化 + 暗色桥接 → dist/
node tools/build-plugin.mjs      # 生成 lib/client.js（CSS 内联 + 令牌转置）
node tools/install-profile.mjs   # 声明进 profile（幂等）
node tools/sync-profile.mjs      # 镜像文件到两处副本并核对
node tools/diff-profile.mjs      # 打印 profile 改动 + 逐字节比对
```

排查「插件到底装没装 / 面板为什么不显示」：

```bash
node tools/replay-list-bundles.mjs   # 独立复现面板的 listBundles()
node tools/verify-panel-meta.mjs     # 调真实的 readPluginMeta，看标题/图标/分区
node tools/read-pixels.mjs           # 采样运行中窗口的像素，反推令牌是否生效
```

发布前清理本机路径：

```bash
node tools/scrub-paths.mjs --check
node tools/scrub-paths.mjs
node tools/fix-placeholders.mjs
node tools/ensure-prelude.mjs
```

---

## 写 DSH 插件会踩的坑

见 [docs/dsh-plugin-notes.md](docs/dsh-plugin-notes.md) —— 10 条**静默失败**的坑，每条都附验证方法。这些是本文档最实用的部分：不报错、不警告，功能就是悄悄不生效。

---

## 许可

MIT。CDS 令牌值来自 [open-claude-ui](https://github.com/Caho1/open-claude-ui) 的 clean-room 逆向实现（MIT）。
