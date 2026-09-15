# specgate 实现笔记 / 交付说明（§12）

## 交付清单

- [x] 可运行 CLI（draft / lint / plan / bridge 四子命令，位置参数，退出码 0/2/1）
- [x] README.md（用法、十一项检查表、两判据、退出码、实测指标）
- [x] 两判据实测数据（`test/measure.mjs` + `test/spec.test.mjs`）
- [x] §9 验收逐条通过（全量 node:test 37/37 全绿，含二轮防回归用例）
- [x] 实现中新发现的问题（见下）

## 两判据实测（自造样本集，非文档自带）

| 判据 | 样本 | 误报 | 漏报 |
|------|------|------|------|
| 措辞可判定性 | 29（放行 14 / 必报 15） | 0 / 0.0%（≤10% 通过） | 0（通过） |
| 蜕变关系有效性 | 23（有效 11 / 恒真 12） | 0（通过） | 0（通过） |

样本刻意覆盖易误报写法：带锚点的「差异/快照/慢查询/清晰度/正常流程/稳定性测试/灰度稳定」、
英文词边界（breakfast 不命中 fast）、副词开头反例（「最后，总价大于 0」无变动词）。
全部达标，未触发误报。

## §9 验收逐条

19 项断言全部通过：两判据实测、五类反例各自被对应检查抓到、结构检查（out_of_scope 空 /
states 枚举外 / example.kind 非法 / id 重复）、计算类缺 invariants 阻塞、能力边界（动作只在 when 也报）、
能力边界与状态覆盖仅提醒不影响退出码、manual 不报能力边界、uses.api 非空才查状态覆盖且进常驻摘要、
assumed_output 归「决策」、无效蜕变关系报错含五类句式、manual 占比与约束源可见、plan 隔离自检故障注入退出 2、
draft 提示词四要素齐全、YAML 解析失败可读错误。

## 实现中新发现 / 需留意的问题

1. **context.md 必须「首次生成、已存在则保留」**才能支撑隔离自检（§7.2）。
   首次实现曾每次用模板覆盖 context.md，导致人填的真实路径被冲掉、自检永远通过。
   已改为：仅当 `impl-task/context.md` 不存在时才写模板；重跑 `plan` 读已填内容做自检。

2. **能力边界匹配拼接文本 when+then**（§4.12）而非仅 then——
   否则「拖拽」动作写在 when 里时检查⑨抓不到。已按拼接文本匹配。

3. **状态覆盖仅在 uses.api 非空时检查**，且「已声明 N/6」进常驻摘要（§4.13）。
   空 uses.api 时不显示该提醒，避免噪声。

4. **建议表头重复**：外层曾额外加「改写方向（按你标的 verify）：」，与 `buildSuggestion`
   自带上下文表头重复；已去掉外层表头，仅由 suggestions.js 输出。

5. **verify 取值绝不硬编码**：结构检查②读取 `constraints.yaml` 的 `verify_tools`，
   找不到回退内置默认并在终端与 review.md 标注「builtin」。源码不写死枚举。

6. **三层划分 = 判定确定性程度**（不是重要程度）：⑨能力边界 ⑩状态覆盖 ⑪verify 分布 是「人比机器更懂」，
   只提醒、不影响退出码；其余 8 项阻塞。

## 与文档的偏差 / 取舍

- 文档 §10 要求总代码 ≤1200 行；当前 `src/` 约 1084 行，留有余量。
- 文档未规定 `constraints.yaml` 的必含字段顺序，`manual.max_ratio` 同时支持顶层与
  `verify_tools.manual.max_ratio` 两处取值，取后者优先。
- 词表（主观词 / 变动词 / 关系词 / 恒真词 / 复合模式 / 上下文排除 / verify→建议映射）
  全部原样落在 `src/words.js`，未做任何删减或改写。

## 修改单：措辞判据两级化（suspect 字段）

> 只改判据一 + 锚点表 + 新增可选字段 `suspect`，其余（三命令 / 契约其它字段 / 任务包 / 不变量判据）不动。

### 改了什么
- **判据一两级化**（`src/criteria/wording.js`）：
  `最终拦下 = (suspect===true 且无锚点) 或 (命中主观词表 且无锚点)`。
  - 第一级 `suspect`：起草时 AI 标注，lint 只读不判、不调模型；单向权力（只能加严）。
  - 第二级词表层：原有兜底层，不可关闭。
  - 移除了原 `checkWording` 里「hits.length===0 提前返回」的早退（否则 suspect 层永不触发）。
- **锚点表补三类缺口**（`hasAnchor`）：中文直角引号「」『』；布尔词 重定向到/移除/加入/包含于/位于；
  顺序·集合类 倒序/升序/降序/排序/置顶/置底/去重。
- **契约格式新增可选字段 `suspect`**：`templates/contract.template.yaml` 加注释；
  `validateStructure` 加类型校验（非 boolean 且非 null → 结构错误）；`draft.prompt.md` 加填写要求。
- **lint 透传 `a.suspect`**（`checks.js` checkWordingAll）。

### 实测（四类分开报，详见 test/measure.mjs）
- A 词表内主观词 3 → 拦 3；B 词表外中文 6 → 拦 6（未声明放行 6）；C 外语 3 → 拦 3；D 可判定无数值 6 → 误报 0。
- 回归：suspect:false 仍拦词表；未声明与改动前一致；有锚点+suspect:true 放行。
- 判定二（蜕变关系）未改动：样本 23，误报 0、漏报 0。
- 全量 `node --test`：37/37 通过（含二轮新增 11 条）。原「漏报 0/16」已作废（只用了词表内词，自证）。

### 实现中新发现的问题（修改单第六节③）
1. **原验收样本集只用了词表内的词**（A 类），无法验证两级化是否真兜住词表外说法——这正是修改单指出的自证漏洞，已用 B/C/D 三类补齐。
2. **`checkWording` 原有早退会吞掉 suspect 层**：原逻辑在「无主观词命中」时直接返回不拦，若保留则 `suspect:true` 永远不生效。已移除早退，改为两级合并判定。
3. **非布尔 `suspect` 的安全性**：若 AI 写出 `suspect: 是` 之类非布尔值，`suspect !== true` → 不触发加严层 → 退化回词表层（只会更松不会更严，单向保证不破）。在此之上额外加了结构校验拒绝非布尔 `suspect`，让新字段有类型约束；老契约（无 suspect）不受影响。
4. **D 类「按钮处于 disabled 状态」依赖既有状态名锚点 `disabled`**（修改前已在 `hasAnchor` 中），本次锚点补全只新增了直角引号 / 布尔词 / 顺序·集合类三类，未动状态名锚点。
5. 除上述外，实现中**未再发现本单未提及的问题**（锚点补全与 suspect 两级化均为单内明确要求，无意外副作用）。

---

## 二轮改动（11 组）：定位收敛为「一个内核 + 两个互斥前门」

### 定位与边界（文档层）

- **一个 lint 检查内核 + 两个互斥前门**：没在用 OpenSpec 走 `draft`；已有 OpenSpec 只走 `bridge`，
  `spec.md` 是唯一需求事实源，**禁止 draft 另建契约需求源**（两个需求源必然漂移，门禁把的是哪份说不清）。
- specgate **只登记并校验 `verify` 的名称**，**不执行验证工具**，也**不替代**实现完成后的 `/opsx:verify`。

### 代码改动

| # | 文件 | 改了什么 | 为什么 |
|---|------|---------|--------|
| 1 | `src/bridge.js` | `parseSpec` 保留场景续行：THEN/WHEN 后缩进的枚举子列表拼接到上一个 bullet | 丢弃会让锚点（`0: Success`）在**解析期**就消失，lint 把本可判定的 then 误报成不可判定 |
| 2 | `src/criteria/wording.js` | `hasAnchor` 补 4 类锚点：枚举映射-ASCII、枚举映射-中文（名字命中主观词则不算）、带扩展名文件路径、英文 code 词 | 锚点漏一种 = 误伤一种；误报比漏报严重 |
| 3 | `src/criteria/wording.js` | 反引号锚点，带三重防伪装：不含字母跳过、含中文跳过（防 `` `友好` ``）、分词全落 SUBJECTIVE_EN 跳过（防 `` `fast` ``） | 只放行真标识符 / 命令，不让反引号成为绕过词表的通道 |
| 4 | `src/words.js` | 新增 `TAUTOLOGY_PATTERNS`（**只新增，旧表一字未动**） | 给判据一补上「恒真断言」这一层信号 |
| 5 | `src/criteria/wording.js` | 恒真断言接入 `hits`，**沿用同一个 anchor 门控**，不新增独立门控 | 与主观词同层；有锚点照样放行，不凭空加严 |
| 6 | `src/constraints.js` | 逐级向上找 `constraints.yaml`，以含 `.git` 的目录为停止边界（≤12 级），末尾兜底 cwd；两条降级路径带 `reason`（`parse-failed` + `path` / `not-found`）返回 | 原先只找「契约同目录 + cwd」两级，深目录的契约找不到项目约束；且降级是静默的 |
| 7 | `src/cli.js` | lint 时若 `source === 'builtin'`，向 **stderr** 打醒目告警块（区分两种原因），并生成 `degradeBanner` 写进 review 顶部 | 降级必须可见：「本次通过 ≠ 项目约束下通过」 |
| 8 | `src/cli.js` | review 改为 `dirname/basename + '.review.md'`；封装 `writeReview`，写失败只告警、**保留原退出码**；结构早退分支同样处理 | 原先固定写 cwd 的 `review.md`，同一 change 下多份 capability 契约互相覆盖；写盘失败还会淹没 CI 依赖的退出码 |
| 9 | `src/bridge.js` + `src/cli.js` | `--keep-verify`：读旧契约按 `id` 建映射，**旧值 ≠ 本次机器推断值**才保留并标 `verify_source='explicit'`（kept++），其余补 `'inferred'` | 只保留「人真改过的」，未改的仍走机器推断，保证幂等 |
| 10 | `src/checks.js` | 检查⑦放宽：除显式 `invariants` 外，`checkInvariant(a.then).ok` 也视为满足 | OpenSpec 路线以 `spec.md` 为唯一事实源，不该逼用户把不变量复制进派生契约 |
| 11 | `src/checks.js` | 新增检查⑪「verify 分布」，只产 `warnings`（inferred 占比 + ui-mismatch），**绝不进 blocking/issues、不改退出码** | 把「手段选得合不合适」这类人比机器更懂的判断，降级为提醒而非阻塞 |

### 三条立场自检

- **零模型零网络**：本次改动全是词表 / 正则 / 字符串处理，未引入任何模型或网络调用（首轮用例 4 持续守卫）。
- **误报比漏报严重**：所有新信号（恒真断言、四类新锚点）都受同一句 `anchor` 门控，新增锚点只会减少误报。
  `TAUTOLOGY_PATTERNS` 里**刻意不含 `/[不非]空/`** ——「…而非空列表」是可机械判定的布尔断言，
  误伤它比漏判更糟，并加了一条守门用例盯死。
- **不动旧词表**：`SUBJECTIVE_ZH` / `SUBJECTIVE_EN` / `COMPOSITE_PATTERNS` / `TAUTOLOGY_WORDS` 等
  一个字未改，只新增了 `TAUTOLOGY_PATTERNS`。

### 二轮实测

- 全量 `node --test`：**37/37 通过**（首轮 26 + 新增 11）。
- 新增用例：T1 桥接续行；T2a 枚举 / 路径 / code 锚点；T2b 反引号防伪装三态；
  T3 恒真断言 + 「而非空列表」守门；T4 ⑪ 只提醒且 `r.passed === true`、trace 配 UI 措辞不误报；
  T5 逐级查找 + `parse-failed` 带 path；T5b CLI stderr 告警 + review 改名且互不覆盖；
  T6 `--keep-verify` 保留 / 标注 / 幂等；T7 ⑦ 放宽边界（自带蜕变关系放行、普通断言仍拦）。
- 首轮 26 条用例**全部保持通过**，未删改任何旧断言。
