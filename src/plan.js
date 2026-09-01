// ============================================================================
// specgate plan <contract.yaml>
//   产出 impl-task/（给实现方）与 test-task/（给测试方）两个【物理隔离】的任务包。
//   ⚠️ 隔离必须靠目录物理隔离，不能靠「叮嘱它别看」。
//   隔离自检：从 context.md 提取源码文件路径，在 test-task 所有文件里搜，
//   命中即失败，退出码 2（§7.2）。
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { loadConstraints } from './constraints.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(__dirname, '..', 'templates');

// 带扩展名的源码文件路径（排除接口路径，如 POST /login）
const SRC_PATH_RE = /[^\s"'()[\]{}<>]+(?:\.tsx?|\.jsx?|\.vue|\.java|\.py|\.go|\.rb|\.rs|\.cpp|\.c)\b/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function extractSourcePaths(text) {
  const set = new Set();
  let m;
  while ((m = SRC_PATH_RE.exec(text)) !== null) set.add(m[0]);
  return [...set];
}

export function runPlan(contractPath, outBase = process.cwd()) {
  if (!existsSync(contractPath)) throw new Error(`契约文件不存在：${contractPath}`);
  const raw = readFileSync(contractPath, 'utf8');
  const doc = parse(raw);
  if (!doc || !doc.contract) throw new Error('契约缺少 contract 字段，无法打包');

  const base = resolve(outBase, 'specgate-plan');
  const impl = resolve(base, 'impl-task');
  const test = resolve(base, 'test-task');
  mkdirSync(impl, { recursive: true });
  mkdirSync(test, { recursive: true });

  // impl-task/contract.yaml + context.md（代码库上下文，由实现方填写）
  writeFileSync(resolve(impl, 'contract.yaml'), raw, 'utf8');
  const contextMd = [
    '# 代码库上下文（给实现方）',
    '',
    '在此填写本功能相关的代码库上下文：组件库、目录约定、已有模块。',
    '⚠️ 下面这些路径示例用尖括号包裹，仅作说明，不会被隔离自检误判为泄漏：',
    '   - 组件：<src/components/Button.tsx>',
    '   - 模块：<src/features/cart/CartService.java>',
    '填写真实路径后，它们会被隔离自检提取，并确认未出现在 test-task/ 中。',
    '',
  ].join('\n');
  // 只在首次生成 context.md；已存在则保留（实现方填完真实路径后重跑 plan 才做隔离自检）
  const ctxPath = resolve(impl, 'context.md');
  if (!existsSync(ctxPath)) writeFileSync(ctxPath, contextMd, 'utf8');

  // test-task/contract.yaml（同一份，一字不差）+ verify-tools.md + prompt.md
  writeFileSync(resolve(test, 'contract.yaml'), raw, 'utf8');
  writeFileSync(resolve(test, 'verify-tools.md'), readFileSync(resolve(TPL, 'verify-tools.md'), 'utf8'), 'utf8');
  writeFileSync(resolve(test, 'prompt.md'), readFileSync(resolve(TPL, 'test.prompt.md'), 'utf8'), 'utf8');

  // ---- 隔离自检（§7.2） ----
  const ctxText = readFileSync(resolve(impl, 'context.md'), 'utf8');
  const paths = extractSourcePaths(ctxText);
  const leaks = [];
  if (paths.length) {
    const testFiles = walk(test);
    for (const f of testFiles) {
      const content = readFileSync(f, 'utf8');
      for (const p of paths) {
        if (content.includes(p)) {
          leaks.push({ file: relative(base, f), path: p });
        }
      }
    }
  }

  if (leaks.length) {
    const msg = [
      `✗ 隔离自检失败：test-task 内出现了实现方源码路径（退出码 2）`,
      ...leaks.map((l) => `   ${l.file} 含泄漏路径 ${l.path}`),
    ].join('\n');
    return { exitCode: 2, message: msg, dir: base, leaks };
  }

  const msg = [
    `✓ 已产出两个任务包（物理隔离）：`,
    `   impl-task/  → ${impl}  （含 contract.yaml + context.md）`,
    `   test-task/  → ${test}  （含 contract.yaml + verify-tools.md + prompt.md）`,
    `✓ 隔离自检通过：test-task 内不含任何实现方源码路径。`,
  ].join('\n');
  return { exitCode: 0, message: msg, dir: base, leaks: [] };
}

// 防止未使用告警
void loadConstraints;
