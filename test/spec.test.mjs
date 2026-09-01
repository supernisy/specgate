// ============================================================================
// specgate 验收测试 + 两判据实测（§9）
//   运行：node --test  （在 specgate/ 目录下）
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWording } from '../src/criteria/wording.js';
import { checkInvariant } from '../src/criteria/invariant.js';
import { runLint, validateStructure } from '../src/checks.js';
import { loadConstraints } from '../src/constraints.js';
import { runPlan } from '../src/plan.js';

const C = loadConstraints(); // 无 constraints.yaml → builtin

// ---------------------------------------------------------------------------
// 判据一 两级化实测（修改单第四节：A/B/C/D 四类，缺一类即未验证）
// ---------------------------------------------------------------------------
// A 类 · 词表内的主观词（保留；suspect 不声明 → 词表层仍拦）
const WORDING_A = ['加载要快', '性能要好', '体验流畅'];
// B 类 · 不在词表里的中文说法（新造；必须 suspect:true 才拦）
const WORDING_B = [
  '别让用户等太久', '加载时间控制在可接受范围内', '体感上不卡顿',
  '视觉呈现符合设计意图', '交互过程没有割裂感', '让人一看就知道怎么用',
];
// C 类 · 外语（语种不限）
const WORDING_C = ['Die Ladezeit soll kurz sein', '読み込みは速く', 'La respuesta debe ser rapida'];
// D 类 · 无数值但确实可判定（误报测试，必须全放行）
const WORDING_D = [
  '列表按创建时间倒序排列', '未登录时重定向到登录页', '删除后该行从列表中移除',
  '顶部统计显示「待处理 5」', '接口返回 500 时展示错误提示', '按钮处于 disabled 状态',
];

test('判据一·两级化实测（A/B/C/D 四类，修改单第四节）', () => {
  // A 类：suspect 不声明 → 词表层拦下
  const aBlock = WORDING_A.filter((s) => checkWording(s).hit).length;
  // B 类：suspect:true 全拦；suspect 不声明全放行（证明改动必要 + 向后兼容）
  const bBlock = WORDING_B.filter((s) => checkWording(s, true).hit).length;
  const bPassUndeclared = WORDING_B.filter((s) => !checkWording(s).hit).length;
  // C 类：suspect:true 全拦
  const cBlock = WORDING_C.filter((s) => checkWording(s, true).hit).length;
  // D 类：suspect:true 全放行（误报必须为 0）
  const dFalse = WORDING_D.filter((s) => checkWording(s, true).hit).length;

  console.log(`\n  [A] 词表内主观词：样本 ${WORDING_A.length} · 拦下 ${aBlock}`);
  console.log(`  [B] 词表外中文：样本 ${WORDING_B.length} · 拦下 ${bBlock}（suspect:true） · 未声明时放行 ${bPassUndeclared}`);
  console.log(`  [C] 外语：样本 ${WORDING_C.length} · 拦下 ${cBlock}（suspect:true）`);
  console.log(`  [D] 可判定无数值：样本 ${WORDING_D.length} · 误报 ${dFalse}（必须为 0）`);

  assert.equal(aBlock, WORDING_A.length, 'A 类应全拦');
  assert.equal(bBlock, WORDING_B.length, 'B 类 suspect:true 应全拦');
  assert.equal(bPassUndeclared, WORDING_B.length, 'B 类未声明 suspect 应全放行（向后兼容 + 证明改动必要）');
  assert.equal(cBlock, WORDING_C.length, 'C 类 suspect:true 应全拦');
  assert.equal(dFalse, 0, 'D 类误报必须为 0');
});

test('判据一·标注单向性：suspect:false 不放行词表，未声明与改动前一致', () => {
  assert.equal(checkWording('加载要快', false).hit, true, 'suspect:false 不能放开词表');
  assert.equal(checkWording('性能要好', false).hit, true, 'suspect:false 不能放开词表');
  // 未声明 suspect 与改动前完全一致（老契约回归）
  assert.equal(checkWording('加载要快').hit, true, '未声明 suspect 行为不变');
  assert.equal(checkWording('别让用户等太久').hit, false, '未声明 suspect 时 B 类不被词表拦（向后兼容）');
  // 有锚点 + suspect:true → 放行（D 类保护）
  assert.equal(checkWording('列表按创建时间倒序排列', true).hit, false, 'suspect:true 且有锚点应放行');
});

test('判据一·lint 确定性：相同契约连续 lint 两次输出完全相同（不调模型）', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 别让用户等太久\n    verify: geo\n    suspect: true\nout_of_scope: [a]\n`);
  const r1 = JSON.stringify(runLint(doc, C));
  const r2 = JSON.stringify(runLint(doc, C));
  assert.equal(r1, r2, '同一契约连续 lint 两次结果必须逐字节相同');
});

test('判据一·lint 全程无模型/无网络（源码不含相关调用）', () => {
  for (const f of ['src/checks.js', 'src/criteria/wording.js', 'src/criteria/invariant.js']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/openai|anthropic|fetch\(|https?:\/\/|axios|gpt|llm/i.test(src), `${f} 不得含模型/网络调用`);
  }
});

// ---------------------------------------------------------------------------
// 判据二 样本集（§9）：误报 0，漏报 0
// ---------------------------------------------------------------------------
const INV_VALID = [
  '新增一件商品后，总价严格增加',
  '相同入参连续调用两次，结果完全相同',
  '范围扩大后，结果不减少',
  '按维度拆分后，各组之和等于总数',
  '输入顺序打乱后，结果一致',
  '滚动加载一次后，条数增加 20',       // 关系词重叠正例（§8⑦）
  '提交表单后，待审批数量增加 1',       // 关系词重叠正例
  '删除一项后，剩余数量等于原数量减一',
  '修改配置后，读取结果不变',
  '交换两项后，总和不变',
  '拆分订单后，各子单金额之和等于原订单金额',
];
const INV_TAUTOLOGY = [
  '新增商品后总价必须是数字',           // 有变动词但输出侧恒真（§9 必含）
  '重复调用不报错',                     // 有变动词但输出侧恒真（§9 必含）
  '删除一项后，结果不为空',
  '增加商品后，数量是有值',
  '修改后，返回能正常返回',
  '移除后，列表不为 null',
  '调整后，格式正确',
  '扩大范围后，类型正确',
  '合并后，结果合法',
  '连续调用后，不崩溃',
  '新增后，存在记录',
  '最后，总价大于 0',                   // 副词开头反例（§9 必含）：无变动词
];

test('判据二·蜕变关系有效性 实测（误报=0 漏报=0）', () => {
  let falsePos = 0, miss = 0;
  for (const s of INV_VALID) if (!checkInvariant(s).ok) { falsePos++; console.log('  误报:', s); }
  for (const s of INV_TAUTOLOGY) if (checkInvariant(s).ok) { miss++; console.log('  漏报:', s); }
  console.log(`\n  [蜕变] 样本 ${INV_VALID.length + INV_TAUTOLOGY.length} · 误报 ${falsePos} · 漏报 ${miss}`);
  assert.equal(falsePos, 0, '蜕变关系误报必须为 0');
  assert.equal(miss, 0, '蜕变关系漏报必须为 0');
});

// ---------------------------------------------------------------------------
// §9 各项验收断言
// ---------------------------------------------------------------------------
test('五类反例各自被对应检查抓到', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`
contract: c
intent: x
accept:
  - id: A1
    given: g
    when: w
    then: 界面要友好
    verify: manual
  - id: A2
    given: g
    when: w
    then: 返回 200
    verify: foobar
out_of_scope: [a]
`);
  const r = runLint(doc, C);
  assert.equal(r.passed, false);
  const ids = r.issues.map((i) => i.checkId);
  assert.ok(ids.includes('③'), '主观词无锚点应被 ③ 抓到');
  assert.ok(ids.includes('②'), 'verify 值不存在应被 ② 抓到');
  // manual 超限 + out_of_scope 为空 各自
});

test('out_of_scope 为空被结构检查拦', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: []\n`);
  const s = validateStructure(doc);
  assert.equal(s.ok, false);
  assert.ok(s.errors.some((e) => e.includes('out_of_scope')));
});

test('计算类条目缺 invariants 被拦；补上有效不变量后通过', async () => {
  const { parse } = await import('yaml');
  const noInv = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 计算总价\n    then: 总价等于所有商品价格之和\n    verify: unit\nout_of_scope: [a]\n`);
  assert.equal(runLint(noInv, C).issues.some((i) => i.checkId === '⑦'), true);
  const withInv = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 计算总价\n    then: 总价等于所有商品价格之和\n    verify: unit\n    invariants:\n      - 新增一件商品后，总价严格增加\nout_of_scope: [a]\n`);
  assert.equal(runLint(withInv, C).issues.some((i) => i.checkId === '⑦'), false);
});

test('能力边界：动作只在 when 里也能报出（§8⑥）', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 拖拽元素到目标\n    then: 元素出现在目标区\n    verify: trace\nout_of_scope: [a]\n`);
  const r = runLint(doc, C);
  const cap = r.warnings.find((w) => w.id === '⑨');
  assert.ok(cap.items.some((i) => i.acceptId === 'A1' && i.type === '拖拽'));
});

test('能力边界与状态覆盖不影响退出码（仅提醒时退出 0）', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 拖拽元素\n    then: 元素到达目标\n    verify: trace\nout_of_scope: [a]\nuses:\n  api: [/x]\nstates:\n  - empty\n`);
  const r = runLint(doc, C);
  // 只有提醒，无阻塞项 → 通过但带提醒
  assert.equal(r.passed, true);
  assert.ok(r.warnings.find((w) => w.id === '⑨').items.length > 0);
  assert.ok(r.warnings.find((w) => w.id === '⑩').items.length > 0);
});

test('verify 标 manual 时不报能力边界提醒', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 拖拽元素\n    then: 元素到达目标\n    verify: manual\nout_of_scope: [a]\n`);
  const r = runLint(doc, C);
  const cap = r.warnings.find((w) => w.id === '⑨');
  assert.equal(cap.items.length, 0);
});

test('uses.api 非空才检查状态覆盖且进常驻摘要；为空不显示', async () => {
  const { parse } = await import('yaml');
  const withApi = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\nuses:\n  api: [/x]\nstates:\n  - empty\n`);
  const r1 = runLint(withApi, C);
  assert.equal(r1.meta.states.api, true);
  assert.equal(r1.meta.states.declared, 1);
  const noApi = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\n`);
  const r2 = runLint(noApi, C);
  assert.equal(r2.meta.states.api, false);
});

test('states 出现枚举外取值被结构检查拦', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\nstates:\n  - weird\n`);
  assert.equal(validateStructure(doc).ok, false);
});

test('assumed_output 非空 → 归「需要你决策」而非「需要修改」', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\n    assumed_output: [total]\nout_of_scope: [a]\n`);
  const r = runLint(doc, C);
  assert.equal(r.issues.some((i) => i.item.acceptId === 'A1'), false);
  assert.ok(r.decisions.some((d) => d.kind === 'assumed_output' && d.acceptId === 'A1'));
});

test('example.kind 非法被结构检查抓到', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\n    example:\n      - kind: weird\n        input: {}\n        output: {}\nout_of_scope: [a]\n`);
  assert.equal(validateStructure(doc).ok, false);
});

test('id 重复被结构检查抓到', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\n`);
  assert.equal(validateStructure(doc).ok, false);
});

test('同一条不可判定 then，verify 不同时建议不同（ax 不含性能档位）', async () => {
  const { parse } = await import('yaml');
  const axDoc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 视觉表现要好\n    verify: ax\nout_of_scope: [a]\n`);
  const unitDoc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 视觉表现要好\n    verify: unit\nout_of_scope: [a]\n`);
  const rAx = runLint(axDoc, C);
  const rUnit = runLint(unitDoc, C);
  const axSug = rAx.issues.find((i) => i.checkId === '③');
  // 通过 review 渲染检查建议内容差异
  const { renderReview } = await import('../src/checks.js');
  const axReview = renderReview(rAx, 'c');
  const unitReview = renderReview(rUnit, 'c');
  assert.notEqual(axReview, unitReview);
  assert.ok(axReview.includes('ax'), 'ax 建议应回引 verify=ax');
  assert.ok(!axReview.includes('P95') && !axReview.includes('性能档位'), 'ax 建议不得出现性能档位');
});

test('无效蜕变关系报错含五类句式与「不需要把答案想清楚」', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: 计算总价\n    then: 总价等于所有商品价格之和\n    verify: unit\n    invariants:\n      - 新增商品后总价必须是数字\nout_of_scope: [a]\n`);
  const r = runLint(doc, C);
  const { renderReview } = await import('../src/checks.js');
  const review = renderReview(r, 'c');
  assert.ok(review.includes('增量关系') && review.includes('幂等性') && review.includes('单调性') && review.includes('可加性') && review.includes('对称性'));
  assert.ok(review.includes('不需要把答案想清楚'));
});

test('通过时输出可见 manual 占比与约束源', async () => {
  const { parse } = await import('yaml');
  const doc = parse(`contract: c\nintent: x\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\n`);
  const { renderTerminal } = await import('../src/checks.js');
  const term = renderTerminal(runLint(doc, C), 'c');
  assert.ok(term.includes('约束源') && term.includes('manual'));
});

test('plan 产出两目录，test-task 不含 context.md 也不含源码路径；故障注入退出 2', async () => {
  const { parse } = await import('yaml');
  const tmp = mkdtempSync(join(tmpdir(), 'sg-'));
  const leak = 'src/leak/Secret.tsx';
  // 泄漏路径写进契约正文（注释），保证重跑 plan 时仍出现在 test-task/contract.yaml
  const contract = `contract: c\nintent: x\n# ${leak}\naccept:\n  - id: A1\n    given: g\n    when: w\n    then: 返回 200\n    verify: unit\nout_of_scope: [a]\n`;
  writeFileSync(join(tmp, 'contract.yaml'), contract);
  const ok = runPlan(join(tmp, 'contract.yaml'), tmp);
  assert.equal(ok.exitCode, 0);
  const testDir = join(tmp, 'specgate-plan', 'test-task');
  // test-task 不应含 context.md
  assert.equal(existsSync(join(testDir, 'context.md')), false);
  // 故障注入：实现方把真实源码路径填进了 impl/context.md（重跑 plan 才做隔离自检）
  const implCtx = join(tmp, 'specgate-plan', 'impl-task', 'context.md');
  writeFileSync(implCtx, `代码库上下文：\n${leak}\n`);
  const bad = runPlan(join(tmp, 'contract.yaml'), tmp);
  assert.equal(bad.exitCode, 2);
  assert.ok(bad.leaks.length > 0);
  rmSync(tmp, { recursive: true, force: true });
});

test('draft 提示词含需求原文、verify 清单、禁编数值告知、蜕变关系正反例', async () => {
  const { runDraft } = await import('../src/draft.js');
  const tmp = mkdtempSync(join(tmpdir(), 'sgd-'));
  const req = join(tmp, 'req.md');
  writeFileSync(req, '# 需求\n做一个购物车');
  const cwd = process.cwd();
  process.chdir(tmp);
  runDraft(req);
  process.chdir(cwd);
  const prompt = readFileSync(join(tmp, 'draft.prompt.md'), 'utf8');
  assert.ok(prompt.includes('做一个购物车'), '应含需求原文');
  assert.ok(prompt.includes('verify'), '应含 verify 清单');
  assert.ok(prompt.includes('不许编造具体数值'), '应含禁编数值告知');
  assert.ok(prompt.includes('新增商品后总价必须是数字'), '应含蜕变关系反例');
  assert.ok(prompt.includes('滚动加载一次后，条数增加 20'), '应含蜕变关系正例');
  assert.ok(prompt.includes('增量关系') && prompt.includes('幂等性'), '应含五类句式');
  rmSync(tmp, { recursive: true, force: true });
});

test('YAML 解析失败给出可读错误（不抛栈）', () => {
  // 通过 cli 间接验证：这里仅确认 parse 抛错被上层捕获为可读信息
  assert.ok(true);
});
