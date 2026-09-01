// ============================================================================
// 十项检查（§6）：八项阻塞 + 两项只提醒
//   ① 结构合法 ② verify 合法 ③ 措辞可判定 ④ breaks 已批准
//   ⑤ manual 占比 ⑥ invariants 有效 ⑦ 计算类有不变量 ⑧ 期望值已确认
//   ⑨ 能力边界（提醒） ⑩ 接口状态覆盖（提醒）
//   三层划分依据 = 判定确定性程度，不是重要程度。
// ============================================================================
import { checkWording } from './criteria/wording.js';
import { checkInvariant } from './criteria/invariant.js';
import { buildSuggestion, NOT_APPLIED_NOTE } from './suggestions.js';
import {
  CAPABILITY_TABLE, CAPABILITY_AUTOMATED, STATE_ENUM, STATE_REASON,
  COMPUTE_REGEX, INVARIANT_PATTERNS, INVARIANT_REASSURE,
} from './words.js';

// ---------- ① 结构合法（不合法直接返回，不再执行后续） ----------------------
export function validateStructure(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['契约不是合法的对象'] };
  if (!doc.contract) errors.push('缺少必填字段 contract');
  if (!doc.intent) errors.push('缺少必填字段 intent');
  if (!Array.isArray(doc.accept) || doc.accept.length === 0) {
    errors.push('accept 必须至少 1 条');
  } else {
    const ids = [];
    doc.accept.forEach((a, i) => {
      const tag = a && a.id ? a.id : `#${i}`;
      if (!a || typeof a !== 'object') { errors.push(`accept[${i}] 不是对象`); return; }
      if (!a.id) errors.push(`accept[${i}] 缺少 id`);
      else if (ids.includes(a.id)) errors.push(`accept id 重复：${a.id}`);
      else ids.push(a.id);
      if (a.given == null) errors.push(`${tag} 缺少 given`);
      if (a.when == null) errors.push(`${tag} 缺少 when`);
      if (a.then == null) errors.push(`${tag} 缺少 then`);
      if (a.verify == null) errors.push(`${tag} 缺少 verify`);
      if (a.suspect != null && typeof a.suspect !== 'boolean') {
        errors.push(`${tag} suspect 必须是 true/false（或省略）`);
      }
      if (a.example != null) {
        if (!Array.isArray(a.example)) errors.push(`${tag} example 必须是数组`);
        else a.example.forEach((e, j) => {
          if (!e || typeof e !== 'object') { errors.push(`${tag} example[${j}] 不是对象`); return; }
          if (e.kind !== 'positive' && e.kind !== 'negative')
            errors.push(`${tag} example[${j}].kind 必须是 positive/negative`);
          if (e.input == null) errors.push(`${tag} example[${j}] 缺少 input`);
          if (e.output == null) errors.push(`${tag} example[${j}] 缺少 output`);
        });
      }
    });
  }
  if (doc.breaks != null) {
    if (!Array.isArray(doc.breaks)) errors.push('breaks 必须是数组');
    else doc.breaks.forEach((b, j) => {
      if (!b || typeof b !== 'object') { errors.push(`breaks[${j}] 不是对象`); return; }
      if (b.what == null) errors.push(`breaks[${j}] 缺少 what`);
      if (b.why == null) errors.push(`breaks[${j}] 缺少 why`);
      const ap = b.approved;
      if (!(ap === true || ap === false || ap === null))
        errors.push(`breaks[${j}].approved 必须是 true/false/null 之一（缺字段=结构错误）`);
    });
  }
  if (!Array.isArray(doc.out_of_scope) || doc.out_of_scope.length === 0)
    errors.push('out_of_scope 必填且不许为空');
  if (doc.states != null) {
    if (!Array.isArray(doc.states)) errors.push('states 必须是数组');
    else doc.states.forEach((s, j) => {
      if (!STATE_ENUM.includes(s)) errors.push(`states[${j}] 取值「${s}」不在六个枚举内`);
    });
  }
  return { ok: errors.length === 0, errors };
}

// ---------- ② verify 合法 ---------------------------------------------------
function checkVerifyValidity(doc, keys) {
  const bad = [];
  for (const a of doc.accept) {
    if (!keys.includes(a.verify)) {
      bad.push({ acceptId: a.id, verify: a.verify, available: keys });
    }
  }
  return { pass: bad.length === 0, items: bad };
}

// ---------- ③ 措辞可判定（两级化：suspect 透传，lint 只读不判） ------------
function checkWordingAll(doc) {
  const bad = [];
  for (const a of doc.accept) {
    const r = checkWording(a.then, a.suspect); // a.suspect: true/false/undefined
    if (r.hit) bad.push({ acceptId: a.id, then: a.then, reason: r.reason, verify: a.verify, suspect: a.suspect });
  }
  return { pass: bad.length === 0, items: bad };
}

// ---------- ④ breaks 已批准（→ 决策，非修改） ------------------------------
function checkBreaksApproved(doc) {
  const pending = [];
  (doc.breaks || []).forEach((b, i) => {
    if (b.approved === null) pending.push({ index: i, what: b.what, why: b.why });
  });
  return { pass: pending.length === 0, items: pending };
}

// ---------- ⑤ manual 占比 --------------------------------------------------
function checkManualRatio(doc, limit) {
  const total = doc.accept.length;
  const manualIds = doc.accept.filter((a) => a.verify === 'manual').map((a) => a.id);
  const ratio = total === 0 ? 0 : manualIds.length / total;
  return {
    pass: ratio <= limit + 1e-9,
    ratio, limit, count: manualIds.length, total, ids: manualIds,
    items: ratio > limit + 1e-9 ? [{ count: manualIds.length, total, ratio, limit, ids: manualIds }] : [],
  };
}

// ---------- ⑥ invariants 有效 ----------------------------------------------
function checkInvariantsValid(doc) {
  const bad = [];
  for (const a of doc.accept) {
    const invs = a.invariants || [];
    invs.forEach((inv, j) => {
      const r = checkInvariant(inv);
      if (!r.ok) bad.push({ acceptId: a.id, index: j, text: inv, reason: r.reason });
    });
  }
  return { pass: bad.length === 0, items: bad };
}

// ---------- ⑦ 计算类有不变量 ----------------------------------------------
function checkComputeHasInvariant(doc) {
  const bad = [];
  for (const a of doc.accept) {
    const hasInv = Array.isArray(a.invariants) && a.invariants.length > 0;
    if (COMPUTE_REGEX.test(a.then || '') && !hasInv) {
      bad.push({ acceptId: a.id, then: a.then });
    }
  }
  return { pass: bad.length === 0, items: bad };
}

// ---------- ⑧ 期望值已确认（→ 决策，非修改） ------------------------------
function checkAssumedOutput(doc) {
  const pending = [];
  for (const a of doc.accept) {
    if (Array.isArray(a.assumed_output) && a.assumed_output.length > 0) {
      pending.push({ acceptId: a.id, fields: a.assumed_output });
    }
  }
  return { pass: pending.length === 0, items: pending };
}

// ---------- ⑨ 能力边界（提醒，匹配 when+then） ----------------------------
function checkCapability(doc) {
  const items = [];
  for (const a of doc.accept) {
    if (!CAPABILITY_AUTOMATED.includes(a.verify)) continue; // manual 不提醒
    if (a.verify === 'manual') continue;
    const text = `${a.when || ''}${a.then || ''}`;
    for (const cat of CAPABILITY_TABLE) {
      if (cat.keywords.some((k) => text.includes(k))) {
        items.push({ acceptId: a.id, type: cat.type, why: cat.why, verify: a.verify });
        break; // 一条只报最先命中的一类，避免刷屏
      }
    }
  }
  return { pass: true, items }; // 提醒，不影响 pass
}

// ---------- ⑩ 接口状态覆盖（提醒，uses.api 非空才查） ----------------------
function checkStateCoverage(doc) {
  const api = (doc.uses && Array.isArray(doc.uses.api) && doc.uses.api.length > 0) || false;
  const declared = Array.isArray(doc.states) ? doc.states : [];
  const missing = STATE_ENUM.filter((s) => !declared.includes(s))
    .map((s) => ({ state: s, reason: STATE_REASON[s] }));
  return { pass: true, api, declared: declared.length, total: STATE_ENUM.length, missing, items: api ? missing : [] };
}

// ============================================================================
// 编排
// ============================================================================
export function runLint(doc, constraints) {
  const keys = Object.keys(constraints.verify_tools || {});
  const limit = constraints.manual_max_ratio ?? 0.2;

  const structure = validateStructure(doc);
  if (!structure.ok) {
    return { structure, early: true, passed: false };
  }

  const c2 = checkVerifyValidity(doc, keys);
  const c3 = checkWordingAll(doc);
  const c4 = checkBreaksApproved(doc);
  const c5 = checkManualRatio(doc, limit);
  const c6 = checkInvariantsValid(doc);
  const c7 = checkComputeHasInvariant(doc);
  const c8 = checkAssumedOutput(doc);
  const c9 = checkCapability(doc);
  const c10 = checkStateCoverage(doc);

  // 阻塞项：②③⑤⑥⑦（①④⑧归为决策/结构，结构已前置）
  const blocking = [
    { id: '②', name: 'verify 合法', ...c2 },
    { id: '③', name: '措辞可判定', ...c3 },
    { id: '⑤', name: 'manual 占比', ...c5 },
    { id: '⑥', name: 'invariants 有效', ...c6 },
    { id: '⑦', name: '计算类有不变量', ...c7 },
  ];
  const warnings = [
    { id: '⑨', name: '能力边界', ...c9 },
    { id: '⑩', name: '接口状态覆盖', ...c10 },
  ];

  const issues = []; // 需要修改
  for (const c of blocking) {
    for (const it of c.items) issues.push({ checkId: c.id, checkName: c.name, item: it });
  }
  const decisions = []; // 需要你决策
  for (const it of c4.items) decisions.push({ kind: 'breaks', ...it });
  for (const it of c8.items) decisions.push({ kind: 'assumed_output', ...it });

  const passed = issues.length === 0; // 只有提醒不影响退出码

  return {
    structure: { ok: true, errors: [] },
    early: false,
    passed,
    blocking, warnings, issues, decisions,
    meta: {
      source: constraints.source,
      manual: c5,
      states: c10,
      acceptCount: doc.accept.length,
    },
  };
}

// ============================================================================
// 渲染：终端摘要（§6.2）
// ============================================================================
export function renderTerminal(result, contractId) {
  const L = [];
  const m = result.meta;
  L.push(`契约 ${contractId} · ${m.acceptCount} 条验收条件`);
  L.push('');
  L.push(`  约束源     ${m.source === 'builtin'
    ? 'builtin（未找到 constraints.yaml，verify 清单用内置默认）'
    : `project（${m.source === 'project' ? '项目 constraints.yaml' : m.source}）`}`);
  const mr = m.manual;
  const pct = mr.total ? Math.round((mr.count / mr.total) * 100) : 0;
  L.push(`  manual     ${mr.count}/${mr.total} = ${pct}%（上限 ${Math.round(mr.limit * 100)}%）${mr.ids.length ? `  [${mr.ids.join(' ')}]` : ''}`);
  if (m.states.api) {
    L.push(`  接口状态   已声明 ${m.states.declared}/${m.states.total} 种`);
  }
  L.push('');
  L.push('  机械检查   ' + result.blocking.map((c) => `${c.pass ? '✓' : '✗'} ${c.id}${c.name}`).join('   '));
  L.push('');

  if (result.issues.length) {
    L.push(`  ✗ ${result.issues.length} 处需要修改`);
    for (const iss of result.issues) {
      const it = iss.item;
      if (iss.checkId === '②') {
        L.push(`      ${it.acceptId}.verify  取值「${it.verify}」不在清单内 → 可用：${it.available.join(' / ')}（来源：${m.source}）`);
      } else if (iss.checkId === '③') {
        L.push(`      ${it.acceptId}.then  「${truncate(it.then)}」不可判定         → 见 review.md 建议`);
      } else if (iss.checkId === '⑤') {
        L.push(`      manual 占比 ${pct}% 超过上限 ${Math.round(mr.limit * 100)}%`);
      } else if (iss.checkId === '⑥') {
        L.push(`      ${it.acceptId}.invariants[${it.index}]  恒真废话：「${truncate(it.text)}」 → 见 review.md`);
      } else if (iss.checkId === '⑦') {
        L.push(`      ${it.acceptId}.then  计算类条目缺 invariants → 见 review.md`);
      }
    }
    L.push('');
  }

  if (result.decisions.length) {
    L.push(`  需要你决策 ${result.decisions.length} 处`);
    for (const d of result.decisions) {
      if (d.kind === 'breaks') {
        L.push(`      [约定突破] #${d.index}  ${truncate(d.what, 30)}`);
        L.push(`          理由：${truncate(d.why, 40)}`);
        L.push(`          → 把 breaks[${d.index}].approved 改成 true 或 false`);
      } else {
        L.push(`      [期望值待确认] ${d.acceptId}  字段：${(d.fields || []).join('、')}`);
        L.push(`          ⚠️ 这几个期望值是推测的，不是你说过的`);
        L.push(`          → 确认无误后从 assumed_output 里删掉这几个字段`);
      }
    }
    L.push('');
  }

  for (const w of result.warnings) {
    if (!w.items.length) continue;
    L.push(`  ⚠ ${w.name}（提醒，不影响退出码）`);
    for (const it of w.items) {
      if (w.id === '⑨') L.push(`      ${it.acceptId}  ${it.type}：${it.why}`);
      if (w.id === '⑩') L.push(`      状态「${it.state}」未声明：${it.reason}`);
    }
    L.push('');
  }

  L.push(result.passed ? '通过（退出码 0）' : '不通过（退出码 2）');
  return L.join('\n');
}

// ============================================================================
// 渲染：review.md（§6.3）
// ============================================================================
export function renderReview(result, contractId) {
  const L = [];
  L.push(`# specgate review · ${contractId}`);
  L.push('');
  L.push(`> 约束源：${result.meta.source === 'builtin' ? '内置默认（未找到 constraints.yaml）' : '项目 constraints.yaml'}`);
  L.push('');

  if (!result.passed) {
    L.push(`## 需要修改（${result.issues.length} 处）`);
    L.push('');
    for (const iss of result.issues) {
      const it = iss.item;
      L.push(`### [${iss.checkId} ${iss.checkName}] ${it.acceptId ?? ''}`);
      if (iss.checkId === '②') {
        L.push(`- 当前原文：verify = \`${it.verify}\``);
        L.push(`- 问题：取值不在 verify 清单内。可用值（来源 ${result.meta.source}）：${it.available.join(' / ')}`);
      } else if (iss.checkId === '③') {
        L.push(`- 当前原文（then）：${it.then}`);
        L.push(`- 命中：${it.reason}`);
        for (const line of buildSuggestion(it.verify, it.then)) L.push(`- ${line}`);
        L.push(`- ${NOT_APPLIED_NOTE}`);
      } else if (iss.checkId === '⑤') {
        L.push(`- 当前：manual ${it.count}/${it.total} = ${Math.round(it.ratio * 100)}%，上限 ${Math.round(it.limit * 100)}%`);
        L.push(`- 涉及条目：${it.ids.join(' ')}`);
        L.push(`- 把部分 manual 改成可机械判定的手段（ax/geo/trace/unit…），或压缩只能人工验收的条目数量。`);
      } else if (iss.checkId === '⑥') {
        L.push(`- 当前原文（invariants[${it.index}]）：${it.text}`);
        L.push(`- 问题：${it.reason}`);
        L.push('- 可套用的五类句式（选最贴近的照抄）：');
        for (const p of INVARIANT_PATTERNS) L.push(`  · ${p.type}：${p.form}`);
        L.push(`- ${INVARIANT_REASSURE}`);
      } else if (iss.checkId === '⑦') {
        L.push(`- 当前原文（then）：${it.then}`);
        L.push('- 问题：then 含计算/聚合语义（总数/总价/求和/平均/计数/排序/分页/占比…），但 invariants 为空。');
        L.push('- 修正：补一条有效蜕变关系（输入变了结果该怎么变），不要写恒真断言。');
        for (const p of INVARIANT_PATTERNS) L.push(`  · ${p.type}：${p.form}`);
        L.push(`- ${INVARIANT_REASSURE}`);
      }
      L.push('');
    }
  }

  if (result.decisions.length) {
    L.push(`## 需要你决策（${result.decisions.length} 处）`);
    L.push('');
    for (const d of result.decisions) {
      if (d.kind === 'breaks') {
        L.push(`### [约定突破] breaks[${d.index}]`);
        L.push(`- 打破了什么：${d.what}`);
        L.push(`- 为什么必须打破：${d.why}`);
        L.push(`- 操作：把 \`breaks[${d.index}].approved\` 改成 \`true\` 或 \`false\`（当前为 null = 待审批）`);
      } else {
        L.push(`### [期望值待确认] ${d.acceptId}.assumed_output`);
        L.push(`- 推测的字段：${(d.fields || []).join('、')}`);
        L.push(`- ⚠️ 这几个期望值是推测的，不是你说过的。`);
        L.push(`- 操作：确认无误后从 \`assumed_output\` 里删掉这几个字段；若确实是你定的，移入 then 的期望值。`);
      }
      L.push('');
    }
  }

  for (const w of result.warnings) {
    if (!w.items.length) continue;
    L.push(`## 提醒（${w.name}，不影响退出码）`);
    L.push('');
    for (const it of w.items) {
      if (w.id === '⑨') L.push(`- ${it.acceptId} 命中「${it.type}」：${it.why}`);
      if (w.id === '⑩') L.push(`- 状态「${it.state}」未声明：${it.reason}`);
    }
    L.push('');
  }

  if (result.passed && !result.decisions.length && !result.warnings.some((w) => w.items.length)) {
    L.push('全部通过，无可修改项、无待决策项。');
  }
  return L.join('\n');
}

function truncate(s, n = 24) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
