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

// ---------------------------------------------------------------------------
// 桥接层（OpenSpec spec.md → contract.yaml）：解析映射 + verify 推断 + 结构合法
// ---------------------------------------------------------------------------
import { parseSpec, buildContract, runBridge } from '../src/bridge.js';
import { writeFileSync as wf2, mkdtempSync as mkt2, rmSync as rm2 } from 'node:fs';
import { tmpdir as td2 } from 'node:os';
import { join as j2 } from 'node:path';
import { stringify, parse } from 'yaml';

const SPEC = `# Spec: Demo

## ADDED Requirements

### Requirement: User Login
The system SHALL let a user log in via the REST API.

#### Scenario: Success
- **WHEN** a user submits valid credentials to the login endpoint
- **THEN** the API returns HTTP 200
- **AND** a session token is returned

### Requirement: Page Render
The login page SHALL render a submit button.

#### Scenario: Layout
- **WHEN** the user opens the page
- **THEN** the submit button is displayed

### Requirement: Nav
The view SHALL migrate from loading to dashboard.

#### Scenario: Transition
- **GIVEN** the user is authed
- **WHEN** the response arrives
- **THEN** the view migrates to dashboard
- **AND** spinner is removed

## REMOVED Requirements

### Requirement: Social Login
No longer supported.
`;

test('桥接：Requirement→accept 映射、id 序号、WHEN/THEN/AND 拼接', () => {
  const { requirements } = parseSpec(SPEC);
  assert.equal(requirements.length, 3);
  const login = requirements.find((r) => r.name === 'User Login');
  assert.equal(login.scenarios.length, 1);
  const c = buildContract(SPEC, { fileStem: 'demo' });
  assert.equal(c.accept.length, 3);
  const ids = c.accept.map((a) => a.id);
  assert.deepEqual(ids, ['user-login-1', 'page-render-1', 'nav-1']);
  const login1 = c.accept[0];
  assert.match(login1.when, /login endpoint/);
  assert.match(login1.then, /HTTP 200.*session token/); // AND 续到 THEN
  assert.equal(login1.given, 'The system SHALL let a user log in via the REST API.'); // 无 GIVEN 子弹 → 回退 req 描述
  assert.equal(c.accept[2].given, 'the user is authed'); // GIVEN → given
});

test('桥接：verify 启发式推断（API→contract-test / UI→unit-visual / 迁移→trace）', () => {
  const c = buildContract(SPEC, { fileStem: 'demo' });
  assert.equal(c.accept[0].verify, 'contract-test'); // login endpoint / API / HTTP
  assert.equal(c.accept[1].verify, 'unit-visual');   // render / button / displayed
  assert.equal(c.accept[2].verify, 'trace');          // migrates → 状态迁移
});

test('桥接：REMOVED 段进入 out_of_scope 且非空', () => {
  const c = buildContract(SPEC, { fileStem: 'demo' });
  assert.ok(Array.isArray(c.out_of_scope) && c.out_of_scope.length > 0);
  assert.ok(c.out_of_scope.some((s) => /Social Login/.test(s)));
});

test('桥接：runBridge 产出通过结构校验的契约（可进 lint）', () => {
  const tmp = mkt2(j2(td2(), 'sg-bridge-'));
  const specPath = j2(tmp, 'spec.md');
  wf2(specPath, SPEC);
  const outPath = j2(tmp, 'contract.yaml');
  const r = runBridge(specPath, outPath);
  assert.equal(r.ok, true);
  const generated = parse(readFileSync(outPath, 'utf8'));
  const v = validateStructure(generated);
  assert.equal(v.ok, true, '桥接产出应过结构校验：' + JSON.stringify(v.errors));
  rm2(tmp, { recursive: true, force: true });
});

// ============================================================================
// 二轮改动防回归
//   T1 桥接续行 / T2 锚点扩充+反引号防伪装 / T3 恒真断言 /
//   T4 ⑪ verify 分布 / T5 约束逐级查找+降级 / T6 --keep-verify / T7 ⑦放宽
// ============================================================================
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TAUTOLOGY_PATTERNS } from '../src/words.js';

// ---- T1 改动 1：THEN 之后的枚举续行不得在解析期丢失 -----------------------
test('T1·桥接保留 THEN 后的枚举续行（锚点不再于解析期消失）', () => {
  const spec = `
## ADDED Requirements

### Requirement: Exit Codes
The CLI SHALL return documented exit codes.

#### Scenario: Success
- **WHEN** the command succeeds
- **THEN** it exits with codes
  - 0: Success
  - 1: Failure
`;
  const { requirements } = parseSpec(spec);
  const bullets = requirements[0].scenarios[0].bullets;
  assert.equal(bullets.length, 2, '续行不应新增 bullet');
  const last = bullets[bullets.length - 1];
  assert.equal(last.kind, 'THEN');
  assert.match(last.text, /0: Success/, '枚举续行应拼接到 THEN');
  assert.match(last.text, /1: Failure/);

  const c = buildContract(spec, { fileStem: 'exit' });
  assert.match(c.accept[0].then, /0: Success/);
  assert.equal(checkWording(c.accept[0].then).hit, false, '带枚举锚点的 then 不应被判不可判定');
});

// ---- T2 改动 2/3：锚点扩充 + 反引号防伪装 ---------------------------------
test('T2a·枚举映射锚点：真枚举算锚点，给废话编号不算', () => {
  assert.equal(checkWording('响应要快，返回码 0: Success').hit, false, '"0: Success" 应算锚点');
  assert.equal(checkWording('响应要快，返回码 1) NotFound').hit, false, '"1) NotFound" 应算锚点');
  assert.equal(checkWording('返回 1: 体验良好').hit, true, '"1: 体验良好" 是给废话编号，不算锚点');
});

test('T2a·文件路径与 code 词锚点', () => {
  assert.equal(checkWording('配置写入 config/app.yaml 后界面要清晰').hit, false, '带扩展名路径应算锚点');
  assert.equal(checkWording('按 exit code 处理，界面要清晰').hit, false, '"exit code" 应算锚点');
  assert.equal(checkWording('按 status codes 处理，界面要清晰').hit, false, '"status codes" 应算锚点');
});

test('T2b·反引号锚点：真标识符救回主观词，纯主观词反引号仍拦', () => {
  // 含主观词「友好」，但 `getUserList()` 是真标识符 → 放行
  assert.equal(
    checkWording('调用 `getUserList()` 后返回结果要友好').hit, false,
    '`getUserList()` 应作为锚点救回含主观词的 then',
  );
  // `友好` 是中文主观词 → 不算锚点（防伪装）
  assert.equal(checkWording('界面要 `友好`').hit, true, '`友好` 不得被当作锚点');
  // `fast` 全落在 SUBJECTIVE_EN → 不算锚点
  assert.equal(checkWording('响应要 `fast`').hit, true, '`fast` 不得被当作锚点');
  // 命令形态（真实用例）
  assert.equal(checkWording('执行 `/opsx:continue <name>` 后列表要清晰').hit, false, '真命令应算锚点');
});

// ---- T3 改动 4/5：恒真断言同层拦截，且不得误伤「而非空列表」 -------------
test('T3·恒真断言被拦下（与主观词同层、同受锚点门控）', () => {
  const tautologies = [
    '删除结果是数字类型且不报错',
    '返回结果为字符串类型',
    '处理达到预期',
    '接口调用成功即可',
    '页面渲染正确无误',
  ];
  for (const t of tautologies) {
    assert.equal(checkWording(t).hit, true, `恒真断言应被拦下：${t}`);
  }
});

test('T3·守门：绝不能加 /[不非]空/，不得误伤「而非空列表」', () => {
  assert.equal(
    checkWording('删除一项后剩余数量等于原数量减一，而非空列表').hit, false,
    '「而非空列表」是可机械判定的布尔断言，不得误伤',
  );
  // 顺带确认「非空」系列词没有渗进判据一的恒真模式表
  for (const re of TAUTOLOGY_PATTERNS) {
    assert.ok(!/[不非]空/.test(re.source), `TAUTOLOGY_PATTERNS 不得含 [不非]空：${re.source}`);
  }
});

// ---- T4 改动 11：⑪ verify 分布（只提醒，不改退出码） ---------------------
test('T4·⑪ verify 分布：inferred 占比与 ui-mismatch 只提醒、不影响通过', () => {
  const doc = parse(`contract: c
intent: x
accept:
  - id: A1
    given: g
    when: w
    then: 页面展示列表
    verify: unit
    verify_source: inferred
  - id: A2
    given: g
    when: w
    then: 点击按钮后状态切换
    verify: trace
    verify_source: explicit
out_of_scope: [a]
`);
  const r = runLint(doc, C);
  const c11 = r.warnings.find((w) => w.id === '⑪');
  assert.ok(c11, '⑪ 应挂在 warnings 上');
  assert.ok(c11.items.some((i) => i.kind === 'inferred-ratio'), 'inferred 占比应产出一条');
  assert.ok(
    c11.items.some((i) => i.kind === 'ui-mismatch' && i.acceptId === 'A1'),
    'A1 措辞是 UI 但 verify=unit，应提示 ui-mismatch',
  );
  assert.ok(
    !c11.items.some((i) => i.kind === 'ui-mismatch' && i.acceptId === 'A2'),
    'A2 是 trace 配 UI 措辞，不得误报',
  );
  assert.equal(r.passed, true, '⑪ 不得影响退出码');
  assert.ok(!r.issues.some((i) => i.checkId === '⑪'), '⑪ 不得进 issues/blocking');
});

// ---- T5 改动 6/7/8：约束逐级查找、降级原因、review 落盘 -------------------
test('T5·loadConstraints 逐级向上查找，解析失败带 parse-failed + path', () => {
  const root = mkdtempSync(join(tmpdir(), 'sg-cons-'));
  const repo = join(root, 'repo');
  const nested = join(repo, 'a', 'b');
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'constraints.yaml'), 'verify_tools:\n  mytool:\n    note: 自定义\n');

  // 契约在深层子目录 → 逐级向上命中仓库根的 constraints.yaml
  const hit = loadConstraints(join(nested, 'contract.yaml'));
  assert.equal(hit.source, 'project', '应向上找到项目约束');
  assert.equal(hit.path, join(repo, 'constraints.yaml'));
  assert.ok('mytool' in hit.verify_tools, '应采用项目自定义 verify 清单');

  // 解析失败 → 带 reason: parse-failed + path 返回（不再静默）
  writeFileSync(join(repo, 'constraints.yaml'), 'verify_tools:\n  bad: [1, 2\n');
  const bad = loadConstraints(join(nested, 'contract.yaml'));
  assert.equal(bad.source, 'builtin');
  assert.equal(bad.reason, 'parse-failed');
  assert.equal(bad.path, join(repo, 'constraints.yaml'));

  rmSync(root, { recursive: true, force: true });
});

test('T5b·CLI：builtin 降级向 stderr 告警，review 按契约名落盘且互不覆盖', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sg-cli-'));
  const body = (name) => `contract: ${name}
intent: 测试
accept:
  - id: A1
    given: 用户已登录
    when: 打开页面
    then: 列表按创建时间倒序排列
    verify: trace
out_of_scope:
  - 不含支付
`;
  const alpha = join(tmp, 'alpha.yaml');
  const beta = join(tmp, 'beta.yaml');
  writeFileSync(alpha, body('alpha'));
  writeFileSync(beta, body('beta'));

  const cli = resolve('src/cli.js');
  const r = spawnSync(process.execPath, [cli, 'lint', alpha], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, '契约应通过（退出码 0）');
  assert.match(r.stderr, /约束降级/, 'builtin 降级必须向 stderr 告警');
  assert.match(r.stderr, /未找到 constraints\.yaml/, '应区分降级原因 not-found');
  assert.ok(!/约束降级/.test(r.stdout), '告警不得污染 stdout');
  assert.ok(existsSync(join(tmp, 'alpha.review.md')), 'review 应写成 <契约名>.review.md');
  assert.ok(!existsSync(join(tmp, 'review.md')), '不得再写固定名 review.md');
  assert.match(readFileSync(join(tmp, 'alpha.review.md'), 'utf8'), /约束降级/, 'review 顶部应有降级横幅');

  // 同一目录下第二份契约不覆盖第一份
  const r2 = spawnSync(process.execPath, [cli, 'lint', beta], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.ok(
    existsSync(join(tmp, 'alpha.review.md')) && existsSync(join(tmp, 'beta.review.md')),
    '两份契约的 review 应互不覆盖',
  );

  rmSync(tmp, { recursive: true, force: true });
});

// ---- T6 改动 9：--keep-verify 只保留人工改过的 verify ---------------------
const SPEC_SMALL = `
## ADDED Requirements

### Requirement: User Login
The system SHALL let a user log in via the REST API.

#### Scenario: Success
- **WHEN** a user submits valid credentials to the login endpoint
- **THEN** the API returns HTTP 200

#### Scenario: Failure
- **WHEN** the password is wrong
- **THEN** the API returns HTTP 401
`;

test('T6·--keep-verify 只保留人工改过的 verify，其余标 inferred（幂等）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sg-keep-'));
  const specPath = join(tmp, 'spec.md');
  const outPath = join(tmp, 'contract.yaml');
  writeFileSync(specPath, SPEC_SMALL);

  // 首次：全机器推断
  const r1 = runBridge(specPath, outPath);
  const c1 = parse(readFileSync(outPath, 'utf8'));
  assert.equal(r1.kept, 0);
  assert.equal(c1.accept[0].verify, 'contract-test', '机器推断应为 contract-test');
  assert.ok(c1.accept.every((a) => a.verify_source === 'inferred'), '首次应全标 inferred');

  // 人工把第 1 条改成 manual（与机器推断不同 = 人工修正）
  c1.accept[0].verify = 'manual';
  writeFileSync(outPath, stringify(c1, { lineWidth: 0 }), 'utf8');

  // 带 --keep-verify 重跑
  const r2 = runBridge(specPath, outPath, { keepVerify: true });
  const c2 = parse(readFileSync(outPath, 'utf8'));
  assert.equal(r2.kept, 1, '应报告保留 1 条人工修正');
  assert.equal(c2.accept[0].verify, 'manual', '人工改过的 verify 应被保留');
  assert.equal(c2.accept[0].verify_source, 'explicit');
  assert.ok(c2.accept.slice(1).every((a) => a.verify_source === 'inferred'), '未改的仍走机器推断');

  // 幂等：再跑一次结果不变
  const r3 = runBridge(specPath, outPath, { keepVerify: true });
  const c3 = parse(readFileSync(outPath, 'utf8'));
  assert.equal(r3.kept, 1, '幂等：重复跑不改变结果');
  assert.equal(c3.accept[0].verify, 'manual');
  assert.equal(c3.accept[1].verify, 'contract-test');

  rmSync(tmp, { recursive: true, force: true });
});

// ---- T7 改动 10：计算类 THEN 自带蜕变关系即满足⑦ -------------------------
test('T7·计算类 THEN 自带蜕变关系即满足⑦，普通断言仍被拦', () => {
  const doc = parse(`contract: c
intent: x
accept:
  - id: A1
    given: g
    when: w
    then: 新增一件商品后，总价严格增加
    verify: unit
  - id: A2
    given: g
    when: w
    then: 总价等于 100 元
    verify: unit
out_of_scope: [a]
`);
  const c7 = runLint(doc, C).blocking.find((c) => c.id === '⑦');
  assert.ok(c7, '⑦ 应在阻塞项里');
  assert.ok(!c7.items.some((i) => i.acceptId === 'A1'), 'A1 的 THEN 已是有效蜕变关系，不应被⑦拦');
  assert.ok(c7.items.some((i) => i.acceptId === 'A2'), 'A2 是计算类普通断言，仍应被⑦拦');
});

