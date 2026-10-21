/**
 * verify-motion.mjs — 数值校验：把 cds-motion.mjs 的实算结果与 AGENTS.md 里
 * 声明的 ζ / 超调量对账。任何一项超出容差就以非 0 退出。
 *
 * 用法: node tools/verify-motion.mjs
 */
import {
  SPRING_PRESETS,
  CDS_EASING,
  calcDampedHarmonicOscillator,
  dampingRatio,
  overshootPercent,
  settlingTime,
  springToLinearEasing,
  profile,
} from '../src/cds-motion.mjs';

/** 文档声明值（open-claude-ui/AGENTS.md §2 弹簧预设表）。 */
const DOCUMENTED = [
  { name: 'SPRING_BOUNCY', zeta: 0.612, overshoot: 8.8, regime: 'underdamped' },
  { name: 'SPRING_SNAPPY', zeta: 0.783, overshoot: 1.9, regime: 'underdamped' },
  { name: 'SPRING_GENTLE', zeta: 0.462, overshoot: 19.5, regime: 'underdamped' },
  { name: 'SPRING_HEAVY_SNAP', zeta: 3.652, overshoot: 0, regime: 'overdamped' },
];

const ZETA_TOL = 0.0015;      // ζ 容差（文档三位小数）
const OVERSHOOT_TOL = 0.15;   // 超调量容差（百分点）

let failures = 0;
const rows = [];

for (const doc of DOCUMENTED) {
  const preset = SPRING_PRESETS[doc.name];
  if (preset === undefined) {
    console.error(`✗ 预设缺失: ${doc.name}`);
    failures += 1;
    continue;
  }
  const p = profile(preset);
  const zetaOk = Math.abs(p.zeta - doc.zeta) <= ZETA_TOL;
  const overshootOk = Math.abs(p.overshoot - doc.overshoot) <= OVERSHOOT_TOL;
  const regimeOk = p.regime === doc.regime;
  const ok = zetaOk && overshootOk && regimeOk;
  if (!ok) failures += 1;
  rows.push({
    name: doc.name,
    k: preset.stiffness,
    c: preset.damping,
    m: preset.mass,
    zeta: p.zeta.toFixed(4),
    zetaDoc: doc.zeta,
    over: `${p.overshoot.toFixed(2)}%`,
    overDoc: `${doc.overshoot}%`,
    settle: `${p.settle.toFixed(3)}s`,
    regime: p.regime,
    ok: ok ? '✓' : '✗',
  });
}

console.log('弹簧预设数值对账（实算 vs AGENTS.md 声明）\n');
const header = ['预设', 'k/c/m', 'ζ 实算', 'ζ 文档', '超调实算', '超调文档', '2% 稳定', '阻尼态', ''];
const table = rows.map((r) => [
  r.name,
  `${r.k}/${r.c}/${r.m}`,
  r.zeta,
  r.zetaDoc,
  r.over,
  r.overDoc,
  r.settle,
  r.regime,
  r.ok,
]);
const widths = header.map((h, i) => Math.max(h.length * 2, ...table.map((row) => String(row[i]).length)));
const pad = (s, w) => {
  // 中文字符按 2 列计宽，这里只做粗略对齐，够读即可
  const visual = /[\u4e00-\u9fff]/.test(s) ? s.length * 2 : s.length;
  return s + ' '.repeat(Math.max(0, w - visual));
};
console.log(header.map((h, i) => pad(h, widths[i])).join('  '));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of table) console.log(row.map((c, i) => pad(String(c), widths[i])).join('  '));

// 求解器在三个阻尼区都应收敛到 1，且欠阻尼必须真的出现超调（不是单调爬升）
console.log('\n求解器行为检查:');
const checks = [
  ['欠阻尼 t→∞ 收敛到 1', Math.abs(calcDampedHarmonicOscillator(600, 30, 1, 5) - 1) < 1e-6],
  ['临界阻尼 t→∞ 收敛到 1', Math.abs(calcDampedHarmonicOscillator(400, 40, 1, 5) - 1) < 1e-6],
  ['过阻尼 t→∞ 收敛到 1', Math.abs(calcDampedHarmonicOscillator(1200, 80, 0.1, 5) - 1) < 1e-6],
  ['t=0 位移为 0', calcDampedHarmonicOscillator(600, 30, 1, 0) === 0],
  ['欠阻尼确实超调 >1', Math.max(...Array.from({ length: 4000 }, (_, i) => calcDampedHarmonicOscillator(600, 30, 1, i * 0.0005))) > 1],
  ['过阻尼从不超调', Math.max(...Array.from({ length: 4000 }, (_, i) => calcDampedHarmonicOscillator(1200, 80, 0.1, i * 0.0005))) <= 1 + 1e-9],
  ['SPRING_HEAVY_SNAP 零过冲', overshootPercent(SPRING_PRESETS.SPRING_HEAVY_SNAP) === 0],
  ['ζ 单调性: 刚度↑阻尼不变 → ζ↓', dampingRatio({ stiffness: 600, damping: 30, mass: 1 }) < dampingRatio({ stiffness: 300, damping: 30, mass: 1 })],
  ['超调排序: gentle > bouncy > snappy > heavy_snap', (
    overshootPercent(SPRING_PRESETS.SPRING_GENTLE) > overshootPercent(SPRING_PRESETS.SPRING_BOUNCY)
    && overshootPercent(SPRING_PRESETS.SPRING_BOUNCY) > overshootPercent(SPRING_PRESETS.SPRING_SNAPPY)
    && overshootPercent(SPRING_PRESETS.SPRING_SNAPPY) > overshootPercent(SPRING_PRESETS.SPRING_HEAVY_SNAP)
  )],
  ['settle: 低刚度慢于高刚度（gentle 慢于 heavy_snap）', settlingTime(SPRING_PRESETS.SPRING_GENTLE) > settlingTime(SPRING_PRESETS.SPRING_HEAVY_SNAP)],
];
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failures += 1;
}

console.log('\nCSS 缓动常量:');
for (const [k, v] of Object.entries(CDS_EASING)) console.log(`  ${k.padEnd(14)} ${v}`);

console.log('\nspring → CSS linear() 采样（供无 WAAPI spring 的宿主降级使用）:');
for (const name of ['SPRING_SNAPPY', 'SPRING_HEAVY_SNAP']) {
  const easing = springToLinearEasing(SPRING_PRESETS[name], 12);
  console.log(`  ${name}: ${easing.slice(0, 110)}…`);
}

console.log(`\n结果: ${failures === 0 ? '全部通过' : `${failures} 项不符`}`);
process.exit(failures === 0 ? 0 : 1);
