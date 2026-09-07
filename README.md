# specgate

[![CI](https://github.com/supernisy/specgate/actions/workflows/test.yml/badge.svg)](https://github.com/supernisy/specgate/actions/workflows/test.yml)
![Node](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Zero Model](https://img.shields.io/badge/lint-零模型-red)

一个**纯确定性、零模型参与**的 CLI 门禁：把「提需求的人（不读代码）」的需求，
转成一份「人能审、机器能消费」的验收契约（YAML），并判定契约里每条验收条件
**是否可被机械判定**。契约不合格，不许进入实现阶段。

它**不生成代码、不判断需求合理性**——只做一件事：把「这条验收能不能自动验」说清楚。

## 🚀 快速开始（推荐用 Skill，不用记命令）

**你只要做一件事：把需求丢给 specgate。**

- 在对话里输入 **`/specgate`**，或直接说「把需求做成验收契约 / 给需求做门禁 / 审一下验收条件 / 这条能不能被测试验证」
- Skill 会**自动跑完整流程**并把产物生成好，再告诉你怎么用——你不用记任何命令、不用手填 YAML

```
你：  /specgate
你：  （贴一段需求原文，或给个需求文件路径）
specgate → draft 起草 → 填契约(让 AI 按提示逐条转写) → lint 迭代到通过 → plan 切任务包
specgate： 产出 contract.yaml + review.md + specgate-plan/，并告诉你「实现方看 impl-task、测试方看 test-task」
```

**Skill 自动替你跑的四步：**

1. **起草 `draft`** —— 给需求文档，产出空白契约模板 + 填写提示词（不调模型）
2. **填写契约** —— AI 逐条把需求转成可验验收条目，落在 `contract.yaml`（每条含 `suspect` 标注）
3. **门禁 `lint`** —— 十项检查判定每条能否被机械判定；不通就给 `review.md` 改写建议，迭代到通过（退出码 0）
4. **切任务包 `plan`** —— 产出 `impl-task/`（实现方）与 `test-task/`（测试方）两个物理隔离的任务包

> ⚠️ Skill 是**你主动触发**的：不自动运行。它只编排流程，**不改** specgate 工具本身的算法（判据/词表/不变量）。
> 想直接敲命令行也完全可以——见下方「三个子命令」，那是 Skill 自动化的同一套命令。

**第一次用 Skill 会自动装好工具**：Skill 自带 `skill/scripts/ensure_specgate.mjs`，按需从 `github.com/supernisy/specgate` 克隆并装好唯一依赖（`yaml`，Node 22+），你无需提前准备。

---

## 三条不可破的设计立场

1. **lint 纯确定性**：不调任何模型，词表/正则/映射表全部写死在源码或 `constraints.yaml`。
2. **误报比漏报严重**：宁可少拦，勿误报。主观词判定 = 命中主观词 **且** 无可测量锚点。
3. **工具不替人决策**：把判断变成需人签字的条目（breaks.approved、assumed_output）。

## 三个子命令（手动用法；Skill 自动编排的就是这三步）

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

## 30 秒最小 demo · 看门禁怎么拦

把一份 invariants 写得全是「输出不为空」「退出码应当是整数」的契约喂给 specgate:

```bash
node src/cli.js lint <契约文件>     # → 退出码 2,review.md 列出每处修改建议
node src/cli.js lint <合规契约>     # → 退出码 0,review.md 写着「全部通过」
```

![specgate FAIL review](docs/specgate-fail-review.png)
*`review.md` 实际长这样 —— 每条拦截都给出五类可套用句式(增量关系 / 幂等性 / 单调性 / 可加性 / 对称性)。*

最关键的两条拦下理由(可从上图直接看到):

- **⑥ invariants 有效(判据二)**:`「采集结果始终是数字类型」` —— 这是**恒真废话**,写成测试永远通过,等于没测。specgate 要求 invariants 必须描述**输入变了结果怎么变**(蜕变关系)。
- **措辞可判定性(判据一)**:主观词 + 无锚点必拦;有锚点放行。两级化(`suspect` 标注 + 词表兜底)互不重叠。

> 字面一致 ≠ 判定一致。`invariant.js` 用的是固定词表(`src/words.js`)做字符串匹配 —— 词表外的动词(如"收窄/放宽")会被漏判,要写到词表里才会被拦。详见 §10「实现约束」。

演示素材见 [verify-suite/acceptance/contract-bad.yaml](https://github.com/supernisy/verify-suite/blob/main/acceptance/contract-bad.yaml)(故意写坏的契约,跑 lint 出上图)。

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
    constraints.js            # verify_tools 加载（builtin 兜底，标 builtin）
    checks.js                 # 结构校验（检查①）+ 十项检查编排 + 三层划分 + 终端/review.md 渲染
    suggestions.js            # verify→建议映射（§5.2，绝不自动应用）
    draft.js                  # 模板+提示词生成
    plan.js                   # 两任务包 + 隔离自检
    words.js                  # 主观词表 / 变动词 / 关系词 / 恒真词 / 映射表
    criteria/wording.js       # 判据一
    criteria/invariant.js     # 判据二 + 能力边界 + 状态覆盖
  templates/                  # contract.template.yaml / draft.prompt.md / test.prompt.md / verify-tools.md
  test/                       # 样本集 + 故障注入 + 两判据实测
  skill/                      # specgate Skill（/specgate 触发）
    SKILL.md                  # 流程编排定义（用户主动触发）
    scripts/ensure_specgate.mjs # 自举：定位/克隆工具根目录并装依赖
```

## Skill（可选 · 推荐）：用 `/specgate` 一步跑完

本仓库自带一个 **specgate Skill**，把上面「起草 → 填写 → 门禁 → 切包」四步编排成一次对话即可完成的流程。

**启用方式**（任选其一）：

- 把 `skill/` 目录放进 WorkBuddy 的 skills 目录（用户级 `~/.workbuddy/skills/` 或项目级 `.workbuddy/skills/`），重启后输入 `/specgate` 即可触发；
- 或直接从市场/对话里加载本仓库的 `skill/SKILL.md`。

**触发后它会**：自动确保工具可用（首跑 `ensure_specgate.mjs` 会克隆本仓库并 `npm install yaml`）→ 跑 `draft` → 引导你填契约（AI 按 `draft.prompt.md` 提示逐条转写并标 `suspect`）→ 跑 `lint` 迭代到通过 → 跑 `plan` 切出两个任务包 → 告诉你产物路径和「实现方/测试方分别看哪」。

> Skill 只编排、不改工具算法；它随时可被关掉改用命令行（见「三个子命令」）。要不要触发，由你决定。
