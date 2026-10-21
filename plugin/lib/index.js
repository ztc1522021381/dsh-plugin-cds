/**
 * dsh-plugin-cds — 宿主半。
 *
 * 本包的全部工作都在浏览器侧（lib/client.js：注入 CDS 样式表 + 覆盖 --dsw-* 令牌）。
 * 宿主半刻意留空：它只需要在 Loader 里占一行，让 profile bundle 的补丁能挂上，
 * 从而让 client-modules 的 roster 扫描看到 `dsh.client` 声明并把浏览器半注入页面。
 *
 * 不做的事（有意为之）：
 *   · 不注册任何 Cordis 服务 —— 加一个空服务只会污染 ctx 命名空间；
 *   · 不读写配置 —— CDS 是静态设计令牌，没有可调参数；
 *   · 不碰文件系统 / 网络 —— 宿主半在 Node 侧，任何 I/O 都会拖慢冷启动。
 */

/** 无服务依赖：宿主半只占位。 */
export const inject = [];

/** 包名（Loader 行 id 与本名一致，便于日志定位）。 */
export const name = 'dsh-plugin-cds';

/**
 * 空挂载。存在的唯一意义是让这条 bundle 行成为合法条目。
 * @param {unknown} _ctx Cordis 根上下文（不使用）
 */
export function apply(_ctx) {
  // 有意留空：浏览器侧由 lib/client.js 承担。
}

export default { name, inject, apply };
