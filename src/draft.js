// ============================================================================
// specgate draft <requirement.md>
//   产出：空白契约模板（contract.draft.yaml）+ 填写提示词（draft.prompt.md）
//   ⭐ 不调模型：提示词交给使用者当前会话里的 AI 去填。
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConstraints } from './constraints.js';
import { STATE_ENUM } from './words.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(__dirname, '..', 'templates');

export function runDraft(requirementPath) {
  if (!existsSync(requirementPath)) {
    throw new Error(`需求文件不存在：${requirementPath}`);
  }
  const requirement = readFileSync(requirementPath, 'utf8').trim();
  const constraints = loadConstraints(requirementPath);
  const keys = Object.keys(constraints.verify_tools || {});

  const template = readFileSync(resolve(TPL, 'contract.template.yaml'), 'utf8');
  const promptTpl = readFileSync(resolve(TPL, 'draft.prompt.md'), 'utf8');

  const verifyList = keys.map((k) => {
    const v = constraints.verify_tools[k];
    const note = v && v.note ? v.note : '';
    return `- \`${k}\`${note ? ` —— ${note}` : ''}`;
  }).join('\n');

  const verifySource = constraints.source === 'builtin'
    ? 'builtin 内置默认（未找到 constraints.yaml，verify 清单可能与项目实际能力不符）'
    : 'project constraints.yaml';

  const prompt = promptTpl
    .replace('{{REQUIREMENT}}', requirement)
    .replace('{{TEMPLATE}}', template)
    .replace('{{VERIFY_SOURCE}}', verifySource)
    .replace('{{VERIFY_LIST}}', verifyList);

  const outTemplate = resolve(process.cwd(), 'contract.draft.yaml');
  const outPrompt = resolve(process.cwd(), 'draft.prompt.md');
  writeFileSync(outTemplate, template, 'utf8');
  writeFileSync(outPrompt, prompt, 'utf8');

  return {
    files: [outTemplate, outPrompt],
    verifyCount: keys.length,
    source: constraints.source,
  };
}

// 防止未使用告警
void STATE_ENUM;
