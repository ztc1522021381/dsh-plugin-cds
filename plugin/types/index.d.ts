/** dsh-plugin-cds — 宿主半类型声明。 */
export declare const name: string;
/** 宿主半无服务依赖。 */
export declare const inject: readonly string[];
/**
 * 空挂载：本包全部工作在浏览器侧（lib/client.js）。
 * @param ctx Cordis 根上下文（不使用）
 */
export declare function apply(ctx: unknown): void;
declare const _default: { name: string; inject: readonly string[]; apply: typeof apply };
export default _default;
