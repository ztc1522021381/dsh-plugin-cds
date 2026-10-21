# dsh-plugin-cds

给 DeepSeek Harness 换上 Anthropic Claude Design System 配色的客户端插件。

**适配 dsh `0.2.1-alpha.1`**（Cordis `~4.0.5-alpha.1`）。

它只改颜色：11 条宿主设计令牌、零网络请求、零 DOM 节点替换。

---

## 安装

```bash
dsh plugin add dsh-plugin-cds
```

或者手动声明进 profile 的 `package.json`：

```json
{
  "dependencies": { "dsh-plugin-cds": "^0.1.0" },
  "dsh": { "profile": { "bundles": ["dsh-plugin-cds"] } }
}
```

然后**完全退出 DSH 再启动**。客户端插件不走 HMR，改配置不会热重载。

在「插件」面板往下滚到**「已安装」**段，能看到标题为 **CDS 主题**、带陶土橙图标的卡片。开关可即时启停。

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

覆盖占比 **11 / 118 = 9.3%**。加上 2 条派生令牌（`button-primary-fill` 跟着品牌色、`menu-icon` 跟着主文字色），实际影响约 13 条。

### 附带的两样东西

**CDS 完整色阶** —— 219 条 CSS 自定义属性，供其它插件配色使用：

```js
import tokens from 'dsh-plugin-cds/tokens';
```

**动效物理常量** —— 4 条弹簧预设 + 4 条贝塞尔曲线：

```js
import { SPRING_SNAPPY, CDS_EASING } from 'dsh-plugin-cds/motion';
```

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

## 已知不足

| 问题 | 说明 |
|---|---|
| 亮色错误色偏浅 | `#ef4444` 对 `#fcfcfb` 只有 **3.67:1**，低于正文要求的 4.5（图标/边框够用）。CDS 原值，未改动。 |
| 字体不生效 | CDS 定义了 `--cds-font-anthropic-*`，但字体文件未随上游发布，实际落到系统字体栈。只有字号/行高/字重生效。 |
| `--cds-gray-750..900` 仅亮色 | 暗色下靠 surface 阶梯兜底，个别 hover 态叠加可能与 CDS 原版有细微偏差。 |
| 全局作用域 | 43 个类名挂在 `:root`，未做 Shadow DOM 隔离。已扫描 DSH 全部 8135 个 JS 文件，5 处撞车全部良性。 |

---

## 写 DSH 插件会踩的坑

仓库里有一份 [10 条静默失败记录](https://github.com/ztc1522021381/dsh-plugin-cds/blob/main/docs/dsh-plugin-notes.md)：不报错、不警告，功能就是悄悄不生效。写客户端插件前值得先看一遍。

---

## 许可

MIT。CDS 令牌值来自 [open-claude-ui](https://github.com/Caho1/open-claude-ui) 的 clean-room 逆向实现（MIT）。
