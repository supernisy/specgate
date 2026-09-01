// ============================================================================
// 判据一：措辞可判定性（§4.1 - §4.6）—— 两级化（修改单）
//   最终拦下 = （suspect === true 且 无锚点） 或 （命中主观词 且 无锚点）
//     · 第一级 suspect：起草时由 AI 标注，lint 只读不判；只能加严，不能放宽
//     · 第二级词表：原有兜底层，不可关闭（哪怕 suspect: false 也照常跑）
//   ⚠️ 绝不能只用词表。误报率一高门禁就会被绕过。词表只是怀疑信号。
// ============================================================================
import {
  SUBJECTIVE_ZH, SUBJECTIVE_EN, COMPOSITE_PATTERNS, CONTEXT_EXCLUSION,
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
      reason: `命中${hits.join('、')}，但 then 中没有任何可测量锚点（数值+单位 / 具体文案 / HTTP 状态码 / 状态名 / 错误码 / 布尔断言 / 顺序·集合类），无法被机械判定`,
    };
  }
  return { hit: false, reason: null };
}
