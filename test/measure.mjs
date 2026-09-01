// 两判据实测指标（修改单第四节：判据一按 A/B/C/D 四类分开报）
import { checkWording } from '../src/criteria/wording.js';
import { checkInvariant } from '../src/criteria/invariant.js';

// A 类 · 词表内的主观词（suspect 不声明 → 词表层仍拦）
const A = ['加载要快', '性能要好', '体验流畅'];
// B 类 · 不在词表里的中文说法（suspect:true 才拦）
const B = ['别让用户等太久', '加载时间控制在可接受范围内', '体感上不卡顿',
  '视觉呈现符合设计意图', '交互过程没有割裂感', '让人一看就知道怎么用'];
// C 类 · 外语
const C = ['Die Ladezeit soll kurz sein', '読み込みは速く', 'La respuesta debe ser rapida'];
// D 类 · 无数值但确实可判定（误报测试）
const D = ['列表按创建时间倒序排列', '未登录时重定向到登录页', '删除后该行从列表中移除',
  '顶部统计显示「待处理 5」', '接口返回 500 时展示错误提示', '按钮处于 disabled 状态'];

const aBlock = A.filter((s) => checkWording(s).hit).length;
const bBlock = B.filter((s) => checkWording(s, true).hit).length;
const bPassUndeclared = B.filter((s) => !checkWording(s).hit).length;
const cBlock = C.filter((s) => checkWording(s, true).hit).length;
const dFalse = D.filter((s) => checkWording(s, true).hit).length;

const regFalse = checkWording('加载要快', false).hit;          // 期望 true
const regUndeclared = checkWording('加载要快').hit;            // 期望 true
const regAnchorSuspect = checkWording('列表按创建时间倒序排列', true).hit; // 期望 false

// 判据二（本次未改动）
const INV_VALID = [
  '新增一件商品后，总价严格增加','相同入参连续调用两次，结果完全相同','范围扩大后，结果不减少',
  '按维度拆分后，各组之和等于总数','输入顺序打乱后，结果一致','滚动加载一次后，条数增加 20',
  '提交表单后，待审批数量增加 1','删除一项后，剩余数量等于原数量减一','修改配置后，读取结果不变',
  '交换两项后，总和不变','拆分订单后，各子单金额之和等于原订单金额',
];
const INV_TAUTOLOGY = [
  '新增商品后总价必须是数字','重复调用不报错','删除一项后，结果不为空','增加商品后，数量是有值',
  '修改后，返回能正常返回','移除后，列表不为 null','调整后，格式正确','扩大范围后，类型正确',
  '合并后，结果合法','连续调用后，不崩溃','新增后，存在记录','最后，总价大于 0',
];
let ip = 0, im = 0;
for (const s of INV_VALID) if (!checkInvariant(s).ok) ip++;
for (const s of INV_TAUTOLOGY) if (checkInvariant(s).ok) im++;

console.log('=== specgate 判据一·两级化实测（修改单第四节）===');
console.log(`[A] 词表内主观词：样本 ${A.length} · 拦下 ${aBlock}            ${aBlock === A.length ? 'PASS' : 'FAIL'}`);
console.log(`[B] 词表外中文：  样本 ${B.length} · 拦下 ${bBlock}（suspect:true）· 未声明时放行 ${bPassUndeclared}  ${bBlock === B.length && bPassUndeclared === B.length ? 'PASS' : 'FAIL'}`);
console.log(`[C] 外语：        样本 ${C.length} · 拦下 ${cBlock}（suspect:true）            ${cBlock === C.length ? 'PASS' : 'FAIL'}`);
console.log(`[D] 可判定无数值：样本 ${D.length} · 误报 ${dFalse}（必须为 0）            ${dFalse === 0 ? 'PASS' : 'FAIL'}`);
console.log('--- 回归（标注单向性 / 向后兼容 / 有锚点保护）---');
console.log(`suspect:false 仍拦词表（加载要快）： ${regFalse ? 'PASS' : 'FAIL'}`);
console.log(`suspect 未声明与改动前一致（加载要快仍拦）： ${regUndeclared ? 'PASS' : 'FAIL'}`);
console.log(`有锚点 + suspect:true 放行（D 类保护）： ${regAnchorSuspect ? 'FAIL' : 'PASS'}`);

console.log('\n=== specgate 判据二·蜕变关系有效性（本次未改动）===');
console.log(`样本 ${INV_VALID.length + INV_TAUTOLOGY.length}（有效 ${INV_VALID.length} / 恒真 ${INV_TAUTOLOGY.length}）`);
console.log(`  误报 = ${ip}（阈值 0）  ${ip === 0 ? 'PASS' : 'FAIL'}`);
console.log(`  漏报 = ${im}（阈值 0）  ${im === 0 ? 'PASS' : 'FAIL'}`);
