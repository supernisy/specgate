// ============================================================================
// 约束源：verify_tools 从项目根目录 constraints.yaml 读（§3.3）
//   ⚠️ 不许在源码里硬编码 verify 枚举 —— 找不到 constraints.yaml 才用内置默认，
//      且必须在输出里标注「用的是内置默认」（builtin）。
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

// 内置默认（与 §3.2 九种 verify 取值一一对应；manual 默认上限 20%）
const BUILTIN = {
  source: 'builtin',
  verify_tools: {
    type: { note: '类型系统能保证' },
    unit: { runner: 'vitest', note: '单元测试' },
    'contract-test': { note: '接口契约测试（基准来自接口定义，不是模型猜的）' },
    geo: { note: '视觉数值卡尺（同结构精确比对具体几何/样式计算值）' },
    ax: { note: '语义指纹比对（跨组件库，用角色+文案做锚点、坐标差值做度量）' },
    'unit-visual': { note: '交互单元 + 文本骨架比对（页面缺少语义角色标注时用）' },
    trace: { note: '交互状态迁移等价性' },
    'state-matrix': { note: '接口状态矩阵（拦截并改写响应，造出空/null/4xx/5xx/慢响应）' },
    manual: { max_ratio: 0.2, note: '人工验收 —— 有占比上限' },
  },
  // 默认 manual 占比上限（可被 constraints.yaml 覆盖）
  manual_max_ratio: 0.2,
};

// 在契约文件所在目录与 cwd 寻找 constraints.yaml
export function loadConstraints(inputPath) {
  const candidates = [];
  if (inputPath) {
    candidates.push(resolve(dirname(inputPath), 'constraints.yaml'));
  }
  candidates.push(resolve(process.cwd(), 'constraints.yaml'));

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const doc = parse(readFileSync(p, 'utf8')) || {};
        const tools = doc.verify_tools || {};
        const maxRatio = (doc.manual && typeof doc.manual === 'object' && doc.manual.max_ratio != null)
          ? doc.manual.max_ratio
          : (tools.manual && tools.manual.max_ratio != null ? tools.manual.max_ratio : BUILTIN.manual_max_ratio);
        return {
          source: 'project',
          verify_tools: tools,
          manual_max_ratio: maxRatio,
          path: p,
        };
      } catch {
        // 解析失败则回退内置默认
        break;
      }
    }
  }
  return BUILTIN;
}

export function verifyKeys(constraints) {
  return Object.keys(constraints.verify_tools || {});
}
