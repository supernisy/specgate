# specgate

[![CI](https://github.com/supernisy/specgate/actions/workflows/test.yml/badge.svg)](https://github.com/supernisy/specgate/actions/workflows/test.yml)
![Node](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Zero Model](https://img.shields.io/badge/lint-零模型-red)

一个**纯确定性、零模型参与**的 CLI 门禁：把「提需求的人（不读代码）」的需求，
转成一份「人能审、机器能消费」的验收契约（YAML），并判定契约里每条验收条件
**是否可被机械判定**。契约不合格，不许进入实现阶段。

它**不生成代码、不判断需求合理性**——只做一件事：把「这条验收能不能自动验」说清楚。

## 三条不可破的设计立场

1. **lint 纯确定性**：不调任何模型，词表/正则/映射表全部写死在源码或 `constraints.yaml`。
2. **误报比漏报严重**：宁可少拦，勿误报。主观词判定 = 命中主观词 **且** 无可测量锚点。
3. **工具不替人决策**：把判断变成需人签字的条目（breaks.approved、assumed_output）。

## 三个子命令

```bash
# 1. 起草：给一份需求文档，产出空白契约模板 + 填写提示词（不调模型）
specgate draft <requirement.md>
#   产出：contract.draft.yaml  contract.template.yaml  draft.prompt.md

# 2. lint：十项检查，终端摘要 + 输出 review.md
specgate lint <contract.yaml>
#   退出码：0 通过 · 2 不通过 · 1 用法/IO 错误

# 3. plan：产出 impl-task/ 与 test-task/ 两个【物理隔离】的任务包
specgate plan <contract.yaml>
#   隔离自检：从 impl/context.md 提取源码路径，在 test-task 全部文件里搜，
#   命中即失败（退出码 2）。context.md 只在首次生成，已存在则保留，
#   实现方填完真实路径后重跑 plan 才做隔离自检。
```

> 位置参数，不用 flag。所有命令的第二个位置参数就是文件路径。

## 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 通过（含仅提醒项） |
| `2` | 不通过（阻塞项未过，或 plan 隔离自检泄漏） |
| `1` | 用法 / IO 错误（文件不存在、YAML 解析失败等） |

## 十项检查（§6）

| # | 检查 | 分层 | 影响退出码 |
|---|------|------|-----------|
| ① | 结构（必填字段 / id 唯一 / approved 三值 / out_of_scope 非空 / example.kind / states 枚举） | 阻塞 | ✔ |
| ② | verify 合法（取值来自 constraints.yaml，否则 builtin 并标注） | 阻塞 | ✔ |
| ③ | 措辞可判定性（判据一） | 阻塞 | ✔ |
| ④ | breaks 已批准（approved 三值校验） | 阻塞 | ✔ |
| ⑤ | manual 占比 ≤20% | 阻塞 | ✔ |
| ⑥ | invariants 有效（判据二） | 阻塞 | ✔ |
| ⑦ | 计算类条目必须有不变量 | 阻塞 | ✔ |
| ⑧ | 期望值已确认（assumed_output ≠ 你说过的 → 归「决策」非「修改」） | 阻塞 | ✔ |
| ⑨ | 能力边界（when+then 拼接匹配） | 提醒 | ✘ |
| ⑩ | 接口状态覆盖（uses.api 非空才查；已声明 N/6 进常驻摘要） | 提醒 | ✘ |

> 三层划分依据 = **判定确定性程度**，不是重要程度。⑨⑩ 是「人比机器更懂」的部分，只提醒、不阻塞。

## 两个核心判据

- **判据一·措辞可判定性（两级化）**：最终拦下 = `（suspect: true 且无锚点）` **或** `（命中主观词表 且无锚点）`。
  - **第一级 `suspect`**：起草时由 AI 逐条标注（这条 then 测试方写不出断言吗？），lint **只读不判**、不调模型；只能加严不能放宽——`suspect: false` 不放行任何东西，词表层照常跑；未声明则与改动前完全一致（向后兼容）。
  - **第二级词表层**：原有兜底层，不可关闭。
  - 锚点补全优先级高于主观词表：本次补了中文直角引号「」『』、布尔词（重定向到/移除/加入/包含于/位于）、顺序·集合类（倒序/升序/降序/排序/置顶/置底/去重）。带上下文排除避免误报。
- **判据二·蜕变关系有效性（§4.7–4.12）**：must 分段（变动词之后看 tail），切分点**遍历所有**，存在一种切法成立即通过；恒真词（是数字 / 不为空 / 不报错…）放输出侧即废话 → **阻塞**。

## 实测指标（判据一两级化 · 四类样本分开报，详见 `test/measure.mjs` 与 `test/spec.test.mjs`）

| 类 | 样本 | 拦下 / 误报 | 结论 |
|----|------|------------|------|
| A 词表内主观词（suspect 不声明） | 3 | 拦下 3 | PASS |
| B 词表外中文（suspect: true） | 6 | 拦下 6；未声明时放行 6 | PASS |
| C 外语（suspect: true） | 3 | 拦下 3 | PASS |
| D 无数值但可判定（误报测试） | 6 | 误报 0（必须为 0） | PASS |

> 原「漏报 0/16」只用了词表内的词，属自证，已作废；现样本含词表外说法 / 外语 / 可判定无数值三类，缺一类即未验证改动。
> 判据二（蜕变关系）本次未改动：样本 23（有效 11 / 恒真 12），误报 0、漏报 0，PASS。

## 实现约束（§10）

- Node 22+ ESM，仅 1 个运行时依赖（`yaml`）。
- 总代码 ≤1200 行（当前 `src/` 约 1084 行）。
- CLI 用位置参数；提示词/模板放 `templates/`；词表写源码 `src/words.js`。
- `verify` 取值从 `constraints.yaml` 读，找不到用内置默认并标 `builtin`，**源码不硬编码枚举**。

## 验收

```bash
node --test            # 跑 test/spec.test.mjs：§9 全部逐条断言 + 两判据实测
node test/measure.mjs  # 打印两判据误报/漏报率
```

## 目录

```
specgate/
  package.json
  constraints.yaml            # verify 取值源（可改，不必动代码）
  src/
    cli.js                    # 位置参数分发 + 退出码
    contract.js               # 结构校验（检查①）
    constraints.js            # verify_tools 加载（builtin 兜底，标 builtin）
    checks.js                 # 十项检查编排 + 三层划分 + 终端/review.md 渲染
    suggestions.js            # verify→建议映射（§5.2，绝不自动应用）
    draft.js                  # 模板+提示词生成
    plan.js                   # 两任务包 + 隔离自检
    words.js                  # 主观词表 / 变动词 / 关系词 / 恒真词 / 映射表
    criteria/wording.js       # 判据一
    criteria/invariant.js     # 判据二 + 能力边界 + 状态覆盖
  templates/                  # contract.template.yaml / draft.prompt.md / test.prompt.md / verify-tools.md
  test/                       # 样本集 + 故障注入 + 两判据实测
```
