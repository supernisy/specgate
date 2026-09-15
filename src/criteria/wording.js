// ============================================================================
// 判据一：措辞可判定性（§4.1 - §4.6）—— 两级化（修改单）
//   最终拦下 = （suspect === true 且 无锚点） 或 （命中主观词/复合表述/恒真断言 且 无锚点）
//     · 第一级 suspect：起草时由 AI 标注，lint 只读不判；只能加严，不能放宽
//     · 第二级词表：原有兜底层，不可关闭（哪怕 suspect: false 也照常跑）
//        三类信号：主观词（中/英）、复合表述、恒真断言（TAUTOLOGY_PATTERNS）
//   ⚠️ 绝不能只用词表。误报率一高门禁就会被绕过。词表只是怀疑信号。
//   ⚠️ 锚点表优先级高于一切词表：有锚点即放行（锚点漏一种 = 误报，后果最重）。
// ============================================================================
import {
  SUBJECTIVE_ZH, SUBJECTIVE_EN, COMPOSITE_PATTERNS, CONTEXT_EXCLUSION,
  TAUTOLOGY_PATTERNS,
} from '../words.js';

// 先在待检文本里挖掉中性技术词（§4.4），避免大量误报
function stripContextExclusion(text) {
  let t = text;
  for (const phrase of CONTEXT_EXCLUSION) {
    t = t.split(phrase).join('');
  }
  return t;
}

// 可测量锚点（§4.5）：只要存在其一就放行
// ⚠️ 锚点表优先级高于主观词表——锚点漏一种 = 误报（把对的拦了），后果最重。
function hasAnchor(text) {
  // 数值 + 单位：200ms / 3 次 / 20 条 / 1px / 80%
  if (/\d+\s*(?:ms|px|%|°|次|条|个|秒|分|时|天|年|月|元|MB|GB|KB|mm|cm)/.test(text)) return true;
  // 具体文案：中英文引号 / 中文直角引号包裹，长度 ≥ 2（修改单·补「」『』）
  if (/[“"'"「『][^”"'"」』]{2,}[”"'"」』]/.test(text)) return true;
  // HTTP 状态码：三位数，首位 1~5
  if (/\b[1-5]\d{2}\b/.test(text)) return true;
  // 具体状态名：词边界匹配
  if (/\b(?:loading|disabled|selected|empty)\b/.test(text)) return true;
  // 错误码格式：字母+数字 或 全大写下划线
  if (/[A-Za-z]+\d+/.test(text)) return true;          // E1001
  if (/[A-Z][A-Z0-9]*_[A-Z0-9]+/.test(text)) return true; // ERR_TIMEOUT
  // 布尔断言：可直接翻译成断言的动词（修改单·补 重定向到/移除/加入/包含于/位于）
  if (/(不出现|等于|包含|包含于|跳转到|重定向到|退出码|移除|加入|位于)/.test(text)) return true;
  // 顺序 / 集合类断言（修改单·新增一类锚点）
  if (/(倒序|升序|降序|排序|置顶|置底|去重)/.test(text)) return true;

  // 枚举映射-ASCII：0: Success / 1) NotFound（改动 2）
  if (/(^|[\s(（:：])\d+\s*[:：)]\s*[A-Za-z][A-Za-z0-9_]*/.test(text)) return true;

  // 枚举映射-中文：取冒号后的名字，名字本身命中主观词则不算锚点（挡「1: 体验良好」）
  for (const seg of text.match(/\d+\s*[:：)]\s*[\u4e00-\u9fa5]+/g) || []) {
    const name = seg.replace(/^\d+\s*[:：)]\s*/, '');
    if (!SUBJECTIVE_ZH.some((w) => name.includes(w))) return true;
  }

  // 带扩展名的文件路径（改动 2）
  if (/[\w./-]+\.(md|tsx?|jsx?|ya?ml|json|py|go|sh|css|html)\b/.test(text)) return true;

  // 英文 code 词：exit code / status code / error codes（改动 2）
  if (/\b(exit|status|error)\s*codes?\b/i.test(text)) return true;

  // 反引号锚点（改动 3·T2b）：真标识符/命令放行；`友好` `fast` 这类伪装不放行
  for (const frag of text.match(/`[^`]+`/g) || []) {
    const inner = frag.slice(1, -1);
    if (!/[A-Za-z]/.test(inner)) continue;        // 不含英文字母 → 不是锚点
    if (/[\u4e00-\u9fa5]/.test(inner)) continue;  // 含中文 → 走引号锚点（防 `友好`）
    const words = inner.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (words.length && words.every((w) => SUBJECTIVE_EN.includes(w))) continue; // 防 `fast`
    return true;                                   // 真标识符 / 命令，如 `getUserList()`
  }

  return false;
}

// 返回 { hit: boolean, reason: string|null }
//   suspect: true | false | undefined（任何非 true 值都不触发可加严层）
export function checkWording(rawThen, suspect) {
  if (typeof rawThen !== 'string' || rawThen.trim() === '') {
    // 空 then 不是「主观词」问题，交给结构/其它检查；这里视为无可判定性信号
    return { hit: false, reason: null };
  }

  const text = stripContextExclusion(rawThen);

  const hits = [];

  // 中文子串匹配
  for (const w of SUBJECTIVE_ZH) {
    if (text.includes(w)) hits.push(`主观词「${w}」`);
  }
  // 英文带词边界
  const lower = text.toLowerCase();
  for (const w of SUBJECTIVE_EN) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) hits.push(`主观词「${w}」`);
  }
  // 复合表述模式
  for (const re of COMPOSITE_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`复合表述「${m[0]}」`);
  }
  // 恒真断言（改动 5·T3）：与主观词同层，沿用下方同一个 anchor 门控，不新增独立门控
  for (const re of TAUTOLOGY_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`恒真断言「${m[0]}」`);
  }

  const anchor = hasAnchor(text);
  const wordBlock = hits.length > 0 && !anchor;     // 原有词表层（兜底层，不可关闭）
  const suspectBlock = suspect === true && !anchor; // 新增可加严层（仅 suspect:true 触发）

  // 两级合并：命中任一级且无锚点 → 拦下
  if (suspectBlock && wordBlock) {
    return { hit: true, reason: `suspect: true 且无锚点（同时命中${hits.join('、')}），无法被机械判定` };
  }
  if (suspectBlock) {
    return { hit: true, reason: 'suspect: true 且无锚点，测试方无法据此写出断言，无法被机械判定' };
  }
  if (wordBlock) {
    // 有可测量锚点 → 必须放行（如「视觉度量差异不超过 1px」）
    return {
      hit: true,
      reason: `命中${hits.join('、')}，但 then 中没有任何可测量锚点（数值+单位 / 具体文案 / HTTP 状态码 / 状态名 / 错误码 / 布尔断言 / 顺序·集合类 / 枚举映射 / 文件路径 / 标识符与命令），无法被机械判定`,
    };
  }
  return { hit: false, reason: null };
}
