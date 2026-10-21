/**
 * verify-all.mjs — 一次跑完全部自检，任一失败即非零退出。
 *
 * 顺序按依赖排：先构建产物（CSS/令牌/插件），再逐个验证契约，
 * 最后核对 profile 是否真的装上了。任何一步失败都会让后续步骤失去意义，
 * 所以这里串行执行、遇错即停。
 *
 * 用法: node tools/verify-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  ['令牌提取（CDS → 已求值 light/dark + 桥接表）', 'tools/extract-tokens.mjs'],
  ['暗色作用域桥接（[data-mode=dark] → body[data-ds-dark-theme]）', 'tools/verify-dark-bridge.mjs'],
  ['动效物理常量核对（4 条弹簧 + 阻尼比/超调/稳定时间）', 'tools/verify-motion.mjs'],
  ['主题层构建（命名空间净化 + 暗色桥接 + 自检）', 'tools/build.mjs'],
  ['插件客户端半生成（CSS 内联 + 令牌转置）', 'tools/build-plugin.mjs'],
  ['profile 声明（dependencies + bundles，幂等）', 'tools/install-profile.mjs'],
  ['同步到 profile（两处副本 + 逐字节核对）', 'tools/sync-profile.mjs'],
  ['插件客户端契约（__ModuleLoader__ / effect / overrideTokens / 卸载）', 'tools/verify-client.mjs'],
  ['插件 manifest（dsh.client / exports / 补丁形态）', 'tools/verify-manifest.mjs'],
  ['profile 装载（bundles / 依赖 / 模块图排序）', 'tools/verify-boot.mjs'],
  ['影响审计回归（覆盖范围 / 对比度 / 类名撞车 / 扫描盲区）', 'tools/verify-audit.mjs'],
  ['插件面板元数据（本地化标题 / 图标 / exports 白名单）', 'tools/verify-panel-meta.mjs'],
];

const results = [];
for (const [label, script] of STEPS) {
  process.stdout.write(`\n${'─'.repeat(72)}\n▸ ${label}\n${'─'.repeat(72)}\n`);
  const r = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  const ok = r.status === 0;
  results.push([label, ok, r.status]);
  if (!ok) {
    console.error(`\n✗ 中止：${label} 未通过（exit ${r.status}）`);
    break;
  }
}

console.log(`\n${'═'.repeat(72)}`);
console.log('汇总');
console.log('═'.repeat(72));
for (const [label, ok, code] of results) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  (exit ${code})`}`);
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${failed === 0 ? `全部 ${results.length} 步通过` : `${failed} 步失败`}`);
process.exit(failed === 0 ? 0 : 1);
