// ============================================================================
// 桥接层：OpenSpec spec.md  →  specgate contract.yaml
//   （交接文档第三节：把 OpenSpec 产物自动转成 contract.yaml，再 specgate lint）
//   纯确定性解析，零模型参与。verify 用关键词启发式从 constraints.yaml 的
//   9 个合法取值里推断；suspect 不填（确定性桥接无法判断「能否写断言」，
//   交还 draft 阶段的 AI 标注，符合「只加严不放宽」）。
// ============================================================================
import { stringify } from 'yaml';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// 合法 verify 取值（与 constraints.yaml 保持一致；这里只作启发式回退默认值）
const DEFAULT_VERIFY = 'unit';

function kebab(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9一-龥-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 去掉子弹里的 **WHEN** / WHEN: 等前缀，取正文
function stripPrefix(line) {
  // 形如 "- **WHEN** text" / "- WHEN: text" / "- **THEN** text"
  const m = line.match(/^\s*[-*]\s*(?:\*\*)?(WHEN|THEN|AND|WHY|GIVEN)(?:\*\*)?\s*:?\s*(.*)$/i);
  if (m) return { kind: m[1].toUpperCase(), text: m[2].trim() };
  return null;
}

function isRequirementHeading(line) {
  return /^###\s+Requirement\s*:\s*(.+)$/i.test(line);
}
function requirementName(line) {
  const m = line.match(/^###\s+Requirement\s*:\s*(.+)$/i);
  return m ? m[1].trim() : '';
}
function isScenarioHeading(line) {
  return /^####\s+Scenario\s*:\s*(.+)$/i.test(line);
}
function scenarioName(line) {
  const m = line.match(/^####\s+Scenario\s*:\s*(.+)$/i);
  return m ? m[1].trim() : '';
}

// 推断 verify（确定性关键词启发式，不调模型）
function inferVerify(text) {
  const t = String(text || '').toLowerCase();
  // 1. 状态迁移等价性（最高优先：迁移/状态机措辞先判，避免被 response 等带偏）
  if (/(状态迁移|状态机|state machine|state transition|状态等价|迁移|migrat)/i.test(t)) return 'trace';
  // 2. 接口状态矩阵：拦截/改写响应，造空/null/4xx/5xx/慢响应
  if (/(4xx|5xx|状态码|慢响应|空响应|null\s*响应|拦截响应|改写响应)/i.test(t) && /(接口|api|endpoint|response|请求)/i.test(t))
    return 'state-matrix';
  // 3. 接口契约测试（注意：裸 request 易误伤「requests a reset」这类非 API 表述，故不含）
  if (/(接口|api|endpoint|http|response|rest|graphql|openapi|\burl\b|契约)/i.test(t)) return 'contract-test';
  // 4. 类型系统
  if (/(类型系统|编译期|ts\s*类型|schema\s*校验|type-safe|类型安全)/i.test(t)) return 'type';
  // 5. 视觉/几何/语义指纹
  if (/(像素|几何|具体数值|1px|坐标|尺寸)/i.test(t)) return 'geo';
  if (/(角色|语义|骨架|指纹)/i.test(t)) return 'ax';
  if (/(渲染|render|ui|界面|按钮|点击|显示|layout|样式|css|视觉|视觉呈现)/i.test(t)) return 'unit-visual';
  // 6. 默认（性能/吞吐等无专用 verify，落到 unit，人工在 lint 反馈后改）
  return DEFAULT_VERIFY;
}

export function parseSpec(md) {
  const lines = md.split(/\r?\n/);
  // 跟踪章节：ADDED / MODIFIED / REMOVED
  let section = 'ADDED';
  const sectionOf = (line) => {
    const m = line.match(/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements/i);
    return m ? m[1].toUpperCase() : null;
  };

  const requirements = []; // {name, desc, scenarios:[{title, bullets:[{kind,text}]}]}
  const removed = [];
  let cur = null;
  let curScenario = null;

  const pushScenario = () => {
    if (cur && curScenario) cur.scenarios.push(curScenario);
    curScenario = null;
  };
  const pushReq = () => {
    pushScenario();
    if (cur) {
      if (section === 'REMOVED') removed.push(cur.name);
      else requirements.push(cur);
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const s = sectionOf(line);
    if (s) { pushReq(); section = s; continue; }
    if (isRequirementHeading(line)) {
      pushReq();
      cur = { name: requirementName(line), desc: '', scenarios: [] };
      curScenario = null;
      continue;
    }
    if (isScenarioHeading(line)) {
      pushScenario();
      curScenario = { title: scenarioName(line), bullets: [] };
      continue;
    }
    const b = stripPrefix(line);
    if (b) {
      if (curScenario) curScenario.bullets.push(b);
      else if (cur) cur.desc = cur.desc ? cur.desc + '\n' + b.text : b.text;
      continue;
    }
    // 普通段落：归入当前 requirement 描述（在场景之前）
    if (cur && !curScenario && line.trim() && !/^#/.test(line)) {
      cur.desc = cur.desc ? cur.desc + '\n' + line.trim() : line.trim();
    }
  }
  pushReq();

  return { requirements, removed };
}

export function buildContract(md, opts = {}) {
  const { requirements, removed } = parseSpec(md);
  const fileStem = opts.fileStem || 'openspec-bridge';
  const contractId = kebab(fileStem) || 'openspec-bridge';

  const accept = [];
  const intents = [];
  for (const req of requirements) {
    const base = kebab(req.name) || 'req';
    const scenarios = req.scenarios.length ? req.scenarios : [{ title: '', bullets: [] }];
    scenarios.forEach((sc, i) => {
      let given = '';
      const whens = [];
      const thens = [];
      let last = null;
      for (const b of sc.bullets) {
        if (b.kind === 'GIVEN') { given = given ? given + '；' + b.text : b.text; last = 'GIVEN'; }
        else if (b.kind === 'WHEN') { whens.push(b.text); last = 'WHEN'; }
        else if (b.kind === 'THEN') { thens.push(b.text); last = 'THEN'; }
        else if (b.kind === 'AND') {
          if (last === 'WHEN') whens.push(b.text);
          else if (last === 'THEN') thens.push(b.text);
          else if (last === 'GIVEN') given = given ? given + '；' + b.text : b.text;
        }
        // WHY 丢弃（需求理由，不进契约正文）
      }
      const when = whens.join('；') || '（由需求描述推导）';
      const then = thens.join('；') || req.desc || '（待补充期望）';
      const id = `${base}-${i + 1}`;
      const verifyText = [req.desc, given, when, then].join(' ');
      accept.push({
        id,
        given: given || req.desc || '',
        when,
        then,
        verify: inferVerify(verifyText),
      });
    });
    if (req.desc) intents.push(`【${req.name}】\n${req.desc}`);
  }

  const out_of_scope = removed.length
    ? removed.map((n) => `不再支持（REMOVED）：${n}`)
    : ['（本契约由 OpenSpec spec.md 桥接生成，验收范围以 spec 为准）'];

  const contract = {
    contract: contractId,
    intent: intents.join('\n\n') || '（由 OpenSpec spec.md 桥接生成）',
    accept,
    out_of_scope,
  };
  return contract;
}

export function runBridge(specPath, outPath) {
  const md = readFileSync(specPath, 'utf8');
  const stem = basename(specPath).replace(/\.md$/i, '');
  const contract = buildContract(md, { fileStem: stem });
  const yaml = stringify(contract, { lineWidth: 0 });
  if (outPath) {
    writeFileSync(resolve(outPath), yaml, 'utf8');
    return { ok: true, yaml, outPath: resolve(outPath), count: contract.accept.length };
  }
  return { ok: true, yaml, count: contract.accept.length };
}
