/**
 * cds-motion.mjs — CDS 动效物理层（零依赖移植）
 *
 * 来源：open-claude-ui/code-examples/ClaudeMotionPresets.ts
 * 差异：原文件 `import { type Transition, type Variants } from "framer-motion"`，
 *       仅作类型标注，运行时没有任何 framer-motion 依赖。这里去掉类型导入，
 *       改成纯 ESM 模块，因此可以直接在 DSH 客户端插件（浏览器）里 import，
 *       也可以被 Node 直接 import 做数值校验。
 *
 * 保留原文件的全部常量、公式与溯源注释，不擅自改数值。
 */

// ============================================================================
// 1. 经典二阶阻尼谐振子数学求解器 (Damped Harmonic Oscillator)
// ============================================================================

/**
 * @typedef {{ stiffness: number, damping: number, mass: number }} SpringParameters
 *   stiffness = k (N/m)，damping = c (N·s/m)，mass = m (kg)
 */

/**
 * 计算给定时间 t 下的归一化位移 (0 -> 1)。
 * m·x'' + c·x' + k·(x - x_target) = 0，阻尼比 ζ = c / (2·√(m·k))。
 *
 * @param {number} k 刚度
 * @param {number} c 阻尼系数
 * @param {number} m 质量
 * @param {number} t 时间（秒）
 * @returns {number} 归一化位移，欠阻尼时会出现 > 1 的超调
 */
export function calcDampedHarmonicOscillator(k, c, m, t) {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(m * k));

  if (zeta < 1) {
    // 欠阻尼状态 (Underdamped, 存在微冲超调振荡)
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t))
    );
  } else if (Math.abs(zeta - 1) < 1e-4) {
    // 临界阻尼 (Critically damped, 最快无振荡收敛)
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    // 过阻尼状态 (Overdamped, 无超调平滑慢收敛)
    const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }
}

/**
 * 阻尼比 ζ = c / (2√(mk))。
 * @param {SpringParameters} p
 * @returns {number}
 */
export function dampingRatio({ stiffness, damping, mass }) {
  return damping / (2 * Math.sqrt(mass * stiffness));
}

/**
 * 无阻尼角频率 ω0 = √(k/m)（rad/s）。
 * @param {SpringParameters} p
 * @returns {number}
 */
export function naturalFrequency({ stiffness, mass }) {
  return Math.sqrt(stiffness / mass);
}

/**
 * 数值求超调量（峰值 - 1，百分比）。欠阻尼用解析式 exp(-πζ/√(1-ζ²))，
 * 其余用求解器在 0..2s 上按 0.5ms 采样取峰，避免解析式在 ζ≥1 时失效。
 * @param {SpringParameters} p
 * @returns {number} 超调百分比（0 表示零过冲）
 */
export function overshootPercent(p) {
  const zeta = dampingRatio(p);
  if (zeta >= 1) {
    let peak = 0;
    for (let t = 0; t <= 2; t += 0.0005) {
      const v = calcDampedHarmonicOscillator(p.stiffness, p.damping, p.mass, t);
      if (v > peak) peak = v;
    }
    return Math.max(0, (peak - 1) * 100);
  }
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100;
}

/**
 * 2% 稳定时间（秒）：位移最后一次进入 |x-1| ≤ 0.02 之后不再越界的时间点。
 * @param {SpringParameters} p
 * @returns {number}
 */
export function settlingTime(p) {
  const dt = 0.0005;
  let last = 0;
  for (let t = 0; t <= 5; t += dt) {
    const v = calcDampedHarmonicOscillator(p.stiffness, p.damping, p.mass, t);
    if (Math.abs(v - 1) > 0.02) last = t;
  }
  return last + dt;
}

// ============================================================================
// 2. 生产级 Framer Motion 物理预设矩阵 (Spring Presets)
//    形状与 framer-motion 的 Transition 一致，可直接 { ...SPRING_BOUNCY } 展开。
// ============================================================================

/**
 * 预设 1: 麦克风按钮 / 语音状态条 (Mic & Voice Bar)
 * 特征：高频微弹，超调量 +8.8% (ζ = 0.612)。
 * 来源：ion-dist/assets/v1/shared-8-PHXy9B6B.js — {type:"spring",stiffness:600,damping:30}
 */
export const SPRING_BOUNCY = Object.freeze({
  type: 'spring',
  stiffness: 600,
  damping: 30,
  mass: 1.0,
});

/**
 * 预设 2: 手势拖拽回弹 (Drag Release) —— 不是入场动画
 * 特征：沉稳顺滑，超调量 +1.9% (ζ = 0.783)。
 * 来源：ion-dist/assets/v1/c427176b2-DuM09fKk.js — {type:"spring",stiffness:320,damping:28}
 */
export const SPRING_SNAPPY = Object.freeze({
  type: 'spring',
  stiffness: 320,
  damping: 28,
  mass: 1.0,
});

/**
 * 预设 3: **非客户端提取，本项目自建**
 * 特征：明显两周期跳跃感，超调量 +19.5% (ζ = 0.462)。
 * 客户端全量搜索无 stiffness:380 / damping:18，故本预设不是 CDS 观测值，
 * 仅用于补足「零过冲」与「高频微弹」之间的中段强弹性档位。
 * 如需还原客户端 {type:"spring",duration:.32,bounce:.15} 的手感，直接用
 * duration/bounce 形式，不要用本预设近似。
 */
export const SPRING_GENTLE = Object.freeze({
  type: 'spring',
  stiffness: 380,
  damping: 18,
  mass: 1.0,
});

/**
 * 预设 4: 文件查看器面板宽度 (File Viewer Panel Width)
 * 特征：绝对零过冲（过阻尼 ζ = 3.652）。
 * 来源：ion-dist/assets/v1/c8ad300b7-07P9B-v4.js —
 *       {type:"spring",stiffness:1200,damping:80,mass:.1}
 */
export const SPRING_HEAVY_SNAP = Object.freeze({
  type: 'spring',
  stiffness: 1200,
  damping: 80,
  mass: 0.1,
});

/** 四个预设的注册表（按文档顺序），供遍历 / 校验 / 调试面板使用。 */
export const SPRING_PRESETS = Object.freeze({
  SPRING_BOUNCY,
  SPRING_SNAPPY,
  SPRING_GENTLE,
  SPRING_HEAVY_SNAP,
});

// ============================================================================
// 3. 原生 CSS 贝塞尔缓动曲线常量 (CSS Easing Constants)
// ============================================================================

export const CDS_EASING = Object.freeze({
  /** 消息气泡与药丸胶囊微弹入场 */
  OVERSHOOT: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
  /** 阴影、焦点微光、高斯模糊渐变 */
  EASE_OUT_EXPO: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** 抽屉面板滑入标准减速 */
  DECEL: 'cubic-bezier(0.165, 0.84, 0.44, 1)',
  /** 瞬时按压缩放 */
  SHARP_PRESS: 'cubic-bezier(0.32, 0.72, 0, 1)',
});

// ============================================================================
// 4. 标准动画变体 (Reusable Motion Variants)
//    原文件是 framer-motion Variants 形状；这里保留纯数据结构，
//    framer-motion 可直接吃，非 React 消费者也能读 initial/animate/exit 键值。
// ============================================================================

/** 消息上浮进入变体 */
export const motionMessageFadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: SPRING_SNAPPY,
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
};

/** 用户提问气泡弹出变体 */
export const motionUserBubbleEnter = {
  initial: { opacity: 0, scale: 0.94, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 450, damping: 24 },
  },
};

/** 弹出菜单 / Popover 浮层 */
export const motionPopover = {
  initial: { opacity: 0, scale: 0.95, y: 4 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: SPRING_SNAPPY,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 2,
    transition: { duration: 0.12, ease: 'easeOut' },
  },
};

/** 模态对话框居中缩放进入 */
export const motionModalDialog = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 32 },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 6,
    transition: { duration: 0.15, ease: 'easeInOut' },
  },
};

/** 字符模糊消解流式动画 (Grapheme Blur Reveal) */
export const motionGraphemeReveal = {
  initial: { opacity: 0, filter: 'blur(6px)' },
  animate: {
    opacity: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.35, ease: 'easeOut' },
  },
};

// ============================================================================
// 5. 浏览器 / CSS 消费辅助
// ============================================================================

/**
 * 把弹簧预设转成一条 CSS 弹簧近似（linear() 多段采样）。
 * 没有 Web Animations 的 spring easing 时，用它把物理预设喂给纯 CSS 过渡。
 *
 * @param {SpringParameters} preset
 * @param {number} [samples] 采样点数
 * @param {number} [duration] 采样时长（秒），默认取 2% 稳定时间
 * @returns {string} 形如 `linear(0, 0.12, …, 1)` 的 CSS 缓动值
 */
export function springToLinearEasing(preset, samples = 32, duration = undefined) {
  const span = duration ?? settlingTime(preset);
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (span * i) / samples;
    const v = i === samples ? 1 : calcDampedHarmonicOscillator(preset.stiffness, preset.damping, preset.mass, t);
    points.push(Number(v.toFixed(5)));
  }
  return `linear(${points.join(', ')})`;
}

/**
 * 预设的完整物理画像（供校验脚本与调试面板打印）。
 * @param {SpringParameters} preset
 * @returns {{ zeta: number, omega0: number, overshoot: number, settle: number, regime: string }}
 */
export function profile(preset) {
  const zeta = dampingRatio(preset);
  return {
    zeta,
    omega0: naturalFrequency(preset),
    overshoot: overshootPercent(preset),
    settle: settlingTime(preset),
    regime: zeta < 1 ? 'underdamped' : Math.abs(zeta - 1) < 1e-4 ? 'critical' : 'overdamped',
  };
}
