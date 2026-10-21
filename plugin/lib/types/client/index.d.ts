/** dsh-plugin-cds — 浏览器半类型声明。 */
/** 插件 id，同时是 <style> 的 data-plugin 值与令牌图层 source。 */
export declare const PLUGIN_ID: string;
/** 样式标签身份（data-plugin-css）。 */
export declare const CSS_TAG_ID: string;
/** --dsw-alias-* ← CDS 令牌值，双模式成对。 */
export declare const TOKENS: Record<string, { light: string; dark: string }>;
/** 必需服务：主题注册表。 */
export declare const inject: readonly string[];
/**
 * 挂载 CDS 主题层：注入样式表 + 覆盖 --dsw-* 令牌。
 * @param ctx 客户端根上下文
 */
export declare function apply(ctx: unknown): void;
