// ============================================================================
// §5 修改建议必须由 verify 驱动（绝不自动应用）
//   维度一：verify 决定【语言形态】（§5.1）
//   维度二：then 的关键词决定【是否还缺失败分支】（叠加）
// ============================================================================
import {
  SUGGEST_MAP, BRANCH_KEYWORDS, BRANCH_COMPLETION,
} from './words.js';

export const NOT_APPLIED_NOTE = '⚠️ 以上为候选改写方向，数值/标准是示例，需你确认；工具不会自动应用。';

// 返回 string[]：建议的逐行内容（不含「不自动应用」注记，由调用方统一加）
export function buildSuggestion(verify, thenText) {
  const lines = [];

  if (verify === 'manual') {
    lines.push('改写方向（你标的 verify 是 `manual`，先质疑是否真的需要人工验收）：');
    lines.push('· 若是视觉问题 → 改用 ax / geo，写成 px 级差异');
    lines.push('· 若是行为问题 → 改用 trace，写成状态迁移');
    lines.push('· 确实只能人工则写成清单：「检查项 → 通过标准」逐条列出');
  } else if (SUGGEST_MAP[verify]) {
    lines.push(`改写方向（你标的 verify 是 \`${verify}\`，它只能验这类说法）：`);
    for (const s of SUGGEST_MAP[verify]) lines.push(`· ${s}`);
  } else {
    lines.push(`改写方向（你标的 verify 是 \`${verify}\`）：补充可机械判定的期望值（数值+单位 / 具体文案 / 状态码 / 错误码 / 布尔断言）。`);
  }

  // 维度二：缺失败分支补全（叠加）
  if (BRANCH_KEYWORDS.some((k) => (thenText || '').includes(k))) {
    lines.push('补充分支（你的 then 提到失败/错误相关措辞）：');
    for (const b of BRANCH_COMPLETION) {
      lines.push(`· ${b.trigger} → ${b.suggestion}`);
    }
  }

  return lines;
}
