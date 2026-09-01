// ============================================================================
// 判据二：蜕变关系的有效性（§4.7 - §4.12）
//   一条有效的蜕变关系 = 【输入侧发生什么变动】+【输出侧该怎么变】
//   算法（次序不能变）：
//     ① 找变动词出现位置 idx
//     ② idx 不存在 → 报「没有描述输入侧的变动，这是普通断言而非蜕变关系」
//         （若全句又命中恒真词，两原因都说出）
//     ③ 取 idx 之后的 tail，后续只看 tail
//     ④ tail 命中恒真词 → 报「输出侧是恒真断言，没说清该怎么变」
//     ⑤ tail 无关系词 → 报「描述了输入变动，但没说清输出该怎么变」
//     ⑥ 通过
//   ⚠️ 切分点必须【遍历所有】，不能取首次匹配（§8⑦ 唯一一次误报的根因）
// ============================================================================
import {
  CHANGE_WORDS, CHANGE_PATTERN, CHANGE_PATTERN_ADVERBS,
  RELATION_WORDS, TAUTOLOGY_WORDS, TAUTOLOGY_NEGATABLE,
} from '../words.js';

function hasRelation(tail) {
  return RELATION_WORDS.some((w) => tail.includes(w));
}

function hasTautology(tail) {
  for (const w of TAUTOLOGY_WORDS) {
    if (!tail.includes(w)) continue;
    if (TAUTOLOGY_NEGATABLE.includes(w)) {
      const idx = tail.indexOf(w);
      // 被「不 / 没」否定则不是恒真（如「不存在」「没值」）
      const prev = tail[idx - 1];
      if (prev === '不' || prev === '没') continue;
    }
    return true;
  }
  return false;
}

// 收集所有切分点（tail 起始下标）
function collectSplitPoints(text) {
  const points = [];
  // 变动词子串出现
  for (const w of CHANGE_WORDS) {
    let from = 0;
    let i;
    while ((i = text.indexOf(w, from)) !== -1) {
      points.push(i + w.length);
      from = i + 1;
    }
  }
  // 补充模式 "X后，"（排除副词）
  CHANGE_PATTERN.lastIndex = 0;
  let m;
  while ((m = CHANGE_PATTERN.exec(text)) !== null) {
    const x = m[1];
    if (CHANGE_PATTERN_ADVERBS.includes(x)) continue;
    points.push(m.index + m[0].length); // "后，"之后
  }
  return points;
}

// 返回 { ok: boolean, reason: string|null }
export function checkInvariant(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: true, reason: null }; // 空不变量交给必填检查，这里不判
  }

  const changePoints = collectSplitPoints(text);
  const fullHasTautology = hasTautology(text);

  if (changePoints.length === 0) {
    // ② 没有描述输入侧的变动
    let reason = '没有描述输入侧的变动，这是普通断言而非蜕变关系';
    if (fullHasTautology) {
      reason += '（且全句命中恒真词，写成测试后永远通过，是废话）';
    }
    return { ok: false, reason };
  }

  // 遍历所有切分点：只要存在一种切法使得
  // 「idx 之前有变动词（构造保证）、tail 有关系词且无恒真词」成立，就判通过
  let anyTailHasRelation = false;
  for (const s of changePoints) {
    const tail = text.slice(s);
    if (hasRelation(tail) && !hasTautology(tail)) {
      return { ok: true, reason: null };
    }
    if (hasRelation(tail)) anyTailHasRelation = true;
  }

  // 所有切法都不成立 → 报错，原因取最接近成立的那一种
  // ④/⑤
  if (anyTailHasRelation) {
    return { ok: false, reason: '描述了输入变动，但输出侧是恒真断言（类型/存在性），没说清结果该怎么变' };
  }
  return { ok: false, reason: '描述了输入变动，但没说清输出该怎么变（缺少关系词，如增加/减少/不变/等于/单调…）' };
}
