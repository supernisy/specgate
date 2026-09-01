#!/usr/bin/env node
// ============================================================================
// specgate CLI
//   位置参数（不用 flag，见 §10⑤）：specgate <cmd> <file>
//   退出码：0 通过 · 2 不通过 · 1 用法错误或文件/解析错误
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { loadConstraints } from './constraints.js';
import { runLint, renderTerminal, renderReview, validateStructure } from './checks.js';
import { runDraft } from './draft.js';
import { runPlan } from './plan.js';

function usage() {
  console.error('用法：specgate <draft|lint|plan> <file>');
  console.error('  draft <requirement.md>  需求 → 空白契约模板 + 填写提示词（不调模型）');
  console.error('  lint  <contract.yaml>   十项检查，终端摘要 + 输出 review.md');
  console.error('  plan  <contract.yaml>    → impl-task / test-task 两个任务包');
  process.exit(1);
}

function main() {
  const [, , cmd, file] = process.argv;
  if (!cmd || !file || !['draft', 'lint', 'plan'].includes(cmd)) usage();
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

    // ---- lint ----
    let doc;
    try {
      doc = parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`✗ YAML 解析失败：${e.message}`);
      process.exit(1);
    }

    const constraints = loadConstraints(filePath);
    const result = runLint(doc, constraints);

    if (result.early) {
      const msg = [
        `契约 ${doc && doc.contract ? doc.contract : '?'} · 结构不合法（退出码 2）`,
        '',
        ...result.structure.errors.map((e) => `  ✗ ${e}`),
      ].join('\n');
      console.log(msg);
      writeFileSync(resolve(process.cwd(), 'review.md'), `# specgate review\n\n结构不合法：\n\n${result.structure.errors.map((e) => `- ${e}`).join('\n')}\n`, 'utf8');
      process.exit(2);
    }

    const contractId = doc.contract;
    const term = renderTerminal(result, contractId);
    console.log(term);

    const reviewPath = resolve(process.cwd(), 'review.md');
    writeFileSync(reviewPath, renderReview(result, contractId), 'utf8');
    console.log(`\n→ 详细修改建议已写入 ${reviewPath}`);
    process.exit(result.passed ? 0 : 2);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

// 防止未使用告警
void validateStructure;
main();
