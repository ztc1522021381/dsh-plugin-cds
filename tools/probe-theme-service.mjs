/**
 * probe-theme-service.mjs — 确认 dsh-client-ui-theme 到底对外提供了什么服务名。
 *
 * 我们的客户端插件写 `const inject = ["theme"]`。如果 theme 服务名不对，
 * Cordis 会一直等待，插件的 apply 永不执行 —— 样式永远不注入，看起来就是
 * 「插件装了但没反应」。
 *
 * 用法: node tools/probe-theme-service.mjs
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

import { readFileSync } from 'node:fs';

const P = `${__AI_ROOT__}/dsh-client-ui-theme/lib/client.js`;
const c = readFileSync(P, 'utf8');

const patterns = [
  /super\(ctx,\s*"([^"]+)"/,
  /ctx\.set\(\s*"([^"]+)"/,
  /ctx\.provide\(\s*"([^"]+)"/,
  /Service\)\s*\{?/,
];

console.log('=== 类继承与 Service 基类 ===');
for (const re of patterns) {
  const m = re.exec(c);
  if (m) console.log(`  ${re.source}  →  ${m[0].slice(0, 90)}`);
}

console.log('\n=== 所有 super(ctx, "...") ===');
for (const m of c.matchAll(/super\(ctx,\s*"([^"]+)"/g)) console.log(`  ${m[1]}`);

console.log('\n=== 所有 ctx.set("...") ===');
for (const m of c.matchAll(/ctx\.set\(\s*"([^"]+)"/g)) console.log(`  ${m[1]}`);

console.log('\n=== 所有 ctx.provide("...") ===');
for (const m of c.matchAll(/ctx\.provide\(\s*"([^"]+)"/g)) console.log(`  ${m[1]}`);

console.log('\n=== 形如 "theme" 的字符串字面量出现次数 ===');
console.log(`  ${(c.match(/"theme"/g) ?? []).length} 次`);

console.log('\n=== 我们的插件注入声明 ===');
const OURS = `${__PROJECT_ROOT__}/plugin/lib/client.js`;
const ours = readFileSync(OURS, 'utf8');
const inj = /const inject = \[([^\]]*)\]/.exec(ours);
console.log(`  inject = [${inj ? inj[1] : '?'}]`);
