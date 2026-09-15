#!/usr/bin/env node
// ============================================================================
// specgate CLI
//   位置参数（不用 flag，见 §10⑤）：specgate <cmd> <file>
//   退出码：0 通过 · 2 不通过 · 1 用法错误或文件/解析错误
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { parse } from 'yaml';
import { loadConstraints } from './constraints.js';
import { runLint, renderTerminal, renderReview, validateStructure } from './checks.js';
import { runDraft } from './draft.js';
import { runPlan } from './plan.js';
import { runBridge } from './bridge.js';

function usage() {
  console.error('用法：specgate <draft|lint|plan|bridge> <file> [out]');
  console.error('  draft <requirement.md>     需求 → 空白契约模板 + 填写提示词（不调模型）');
  console.error('  lint  <contract.yaml>      十一项检查，终端摘要 + 输出 <契约名>.review.md');
  console.error('  plan  <contract.yaml>      → impl-task / test-task 两个任务包');
  console.error('  bridge <spec.md> [out.yaml] [--keep-verify]');
  console.error('                             OpenSpec spec.md → contract.yaml（确定性桥接，不调模型）');
  console.error('                             --keep-verify：保留上一版契约里人工改过的 verify（只认人改过的）');
  process.exit(1);
}

// 写 review 文件：失败只向 stderr 告警，绝不改退出码（CI 靠退出码判闸）
function writeReview(reviewPath, content) {
  try {
    writeFileSync(reviewPath, content, 'utf8');
    console.log(`\n→ 详细修改建议已写入 ${reviewPath}`);
    return true;
  } catch (e) {
    console.error(`⚠️  review 写入失败（不影响退出码）：${reviewPath} —— ${e.message}`);
    return false;
  }
}

// 约束降级告警（改动 7·T5b）：走 stderr，不污染 stdout；返回写进 review 顶部用的横幅
function buildDegradeBanner(constraints) {
  if (constraints.source !== 'builtin') return '';
  const isParse = constraints.reason === 'parse-failed';
  const lines = isParse
    ? [
        '⚠️  约束降级：constraints.yaml 解析失败，本次回退「内置默认」verify 清单',
        `    文件：${constraints.path}`,
        '    本次通过 ≠ 项目约束下通过。修好该文件后请重跑 lint。',
      ]
    : [
        '⚠️  约束降级：逐级向上未找到 constraints.yaml，本次回退「内置默认」verify 清单',
        '    本次通过 ≠ 项目约束下通过。建议在仓库根放一份 constraints.yaml。',
      ];
  const bar = '─'.repeat(66);
  process.stderr.write(`\n${bar}\n${lines.join('\n')}\n${bar}\n\n`);
  return [
    '> ⚠️ **约束降级**：' + (isParse
      ? `\`constraints.yaml\` 解析失败（${constraints.path}），本次用**内置默认** verify 清单。`
      : '未找到 `constraints.yaml`，本次用**内置默认** verify 清单。'),
    '> ',
    '> **本次通过 ≠ 项目约束下通过**。修好约束源后请重跑 `lint`。',
    '',
  ].join('\n');
}

function main() {
  const [, , cmd, file] = process.argv;
  if (!cmd || !file || !['draft', 'lint', 'plan', 'bridge'].includes(cmd)) usage();
  const filePath = resolve(process.cwd(), file);
  if (!existsSync(filePath)) {
    console.error(`文件不存在：${filePath}`);
    process.exit(1);
  }

  try {
    if (cmd === 'draft') {
      const r = runDraft(filePath);
      console.log(`✓ 已生成：`);
      for (const f of r.files) console.log(`   ${f}`);
      console.log(`verify 清单来源：${r.source}（${r.verifyCount} 种）`);
      process.exit(0);
    }

    if (cmd === 'plan') {
      const outBase = process.argv[4]; // 可选：输出根目录（位置参数，不用 flag）
      const r = runPlan(filePath, outBase);
      console.log(r.message);
      process.exit(r.exitCode);
    }

    if (cmd === 'bridge') {
      const keepVerify = process.argv.includes('--keep-verify');
      // 可选：输出契约路径（位置参数，不用 flag；跳过 --xxx 形式的选项）
      const outArg = process.argv.slice(4).find((a) => !a.startsWith('--'));
      const r = runBridge(filePath, outArg, { keepVerify });
      if (outArg) {
        const keptNote = keepVerify ? `，保留人工 verify 修正 ${r.kept} 条` : '';
        console.log(`✓ 已生成契约：${r.outPath}（${r.count} 条验收${keptNote}）`);
      } else {
        process.stdout.write(r.yaml);
      }
      process.exit(0);
    }

    // ---- lint ----
    let doc;
    try {
      doc = parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`✗ YAML 解析失败：${e.message}`);
      process.exit(1);
    }

    const constraints = loadConstraints(filePath);
    const degradeBanner = buildDegradeBanner(constraints); // 降级告警走 stderr，不污染 stdout
    const result = runLint(doc, constraints);

    // review 按契约名落盘（改动 8·T7）：同一 change 下多份 capability 契约不再互相覆盖
    const reviewPath = resolve(
      dirname(filePath),
      basename(filePath).replace(/\.ya?ml$/i, '') + '.review.md',
    );

    if (result.early) {
      const msg = [
        `契约 ${doc && doc.contract ? doc.contract : '?'} · 结构不合法（退出码 2）`,
        '',
        ...result.structure.errors.map((e) => `  ✗ ${e}`),
      ].join('\n');
      console.log(msg);
      writeReview(
        reviewPath,
        `${degradeBanner}# specgate review\n\n结构不合法：\n\n${result.structure.errors.map((e) => `- ${e}`).join('\n')}\n`,
      );
      process.exit(2);
    }

    const contractId = doc.contract;
    const term = renderTerminal(result, contractId);
    console.log(term);

    writeReview(reviewPath, degradeBanner + renderReview(result, contractId));
    process.exit(result.passed ? 0 : 2);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

// 防止未使用告警
void validateStructure;
main();
