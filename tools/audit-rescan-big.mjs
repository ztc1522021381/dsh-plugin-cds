/**
 * audit-rescan-big.mjs — 补扫上一轮因体积被跳过的 5 个 app-shell 大文件。
 *
 * 这些文件里有 settings-account 的客户端 bundle（5.3 MB，真实界面代码），
 * 还有 pdf/excel 预览器（各自内嵌了整个库）。用流式分块读，避免一次载入。
 *
 * 用法: node tools/audit-rescan-big.mjs
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

import { readFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';

const FILES = [
  `${__AI_ROOT__}/dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js`,
  `${__AI_ROOT__}/dsh-client-ui-sidebar-documentpreview/lib/client.excel.js`,
  `${__AI_ROOT__}/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`,
];

const cdsCss = readFileSync('dist/cds-theme.css', 'utf8');
const cdsClasses = [...new Set([...cdsCss.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{:]/gi)].map((m) => m[1]))];

/** 分块读取整个文件，返回拼接后的文本（仅用于这几个文件，总约 19MB）。 */
function slurp(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.allocUnsafe(size);
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return buf.toString('utf8', 0, off);
  } finally {
    closeSync(fd);
  }
}

console.log(`补扫 ${FILES.length} 个文件，CDS 类名 ${cdsClasses.length} 个\n`);

let anyHit = false;
for (const file of FILES) {
  const txt = slurp(file);
  const hits = [];
  for (const c of cdsClasses) {
    const re = new RegExp(`(?:^|[\\s"'\`])${c}(?:[\\s"'\`]|$)|(?:^|[\\s,>])${c}\\s*\\{`);
    if (re.test(txt)) hits.push(c);
  }
  console.log(`${file.split(/[\\/]/).slice(-1)[0]}  (${(txt.length / 1e6).toFixed(1)} MB)`);
  if (hits.length === 0) {
    console.log('  无同名类\n');
  } else {
    anyHit = true;
    console.log(`  命中 ${hits.length} 个: ${hits.join(', ')}`);
    for (const c of hits) {
      // 找一处上下文
      const m = new RegExp(`(?:^|[\\s"'\`])${c}(?:[\\s"'\`]|$)`).exec(txt);
      if (m !== null) {
        console.log(`    .${c} 上下文: …${txt.slice(Math.max(0, m.index - 80), m.index + c.length + 80).replace(/\s+/g, ' ')}…`);
      }
    }
    console.log('');
  }
}

console.log(anyHit ? '⚠ 存在命中，需逐个确认是否真实撞车。' : '✓ 三个大文件里都没有 CDS 类名 —— 上一轮的盲区不影响结论。');
