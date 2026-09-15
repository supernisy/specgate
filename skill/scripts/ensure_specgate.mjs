#!/usr/bin/env node
// ============================================================================
// ensure_specgate.mjs —— 确保 specgate CLI 可用，向 stdout 打印一行根目录。
// agent 捕获这一行作为 $SG_HOME。
//   定位优先级：
//     1) $SPEC_GATE_HOME 环境变量（指向含 src/cli.js 的目录）
//     2) 已克隆的缓存目录：~/.workbuddy/specgate（WorkBuddy）/ ~/.codebuddy/specgate（CodeBuddy）
//     3) 自动 git clone https://github.com/supernisy/specgate 到缓存并 npm install yaml
// 缓存落到哪个宿主目录，按本机实际存在的宿主目录决定；两边都没有则落到中立位置 ~/.specgate。
// 进度信息走 stderr；唯一 stdout 是根目录路径。
// ============================================================================
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const HOME = homedir();
const REPO = 'https://github.com/supernisy/specgate';
const PULL = process.argv.includes('--pull');

// 已知宿主目录名（WorkBuddy / CodeBuddy）；没有任何宿主时用中立目录
const HOST_DIRS = ['.workbuddy', '.codebuddy'];
const NEUTRAL_DIR = '.specgate';

// 托管 node 的版本目录候选（各宿主一份；目录名形如 22.22.2-3）
const NODE_VERSIONS_DIRS = HOST_DIRS.map((d) => resolve(HOME, d, 'binaries', 'node', 'versions'));

// 已克隆缓存目录候选：先看宿主目录，再看中立位置
const CACHE_CANDIDATES = [
  ...HOST_DIRS.map((d) => resolve(HOME, d, 'specgate')),
  resolve(HOME, NEUTRAL_DIR),
];

function hasCli(dir) {
  return !!dir && existsSync(resolve(dir, 'src', 'cli.js'));
}

function findExisting() {
  if (process.env.SPEC_GATE_HOME && hasCli(process.env.SPEC_GATE_HOME)) return process.env.SPEC_GATE_HOME;
  for (const c of CACHE_CANDIDATES) if (hasCli(c)) return c;
  return null;
}

// 克隆目标：与「本机真实存在的宿主目录」同源，避免在 CodeBuddy 机器上凭空造出 .workbuddy
function cloneTarget() {
  for (const d of HOST_DIRS) {
    if (existsSync(resolve(HOME, d))) return resolve(HOME, d, 'specgate');
  }
  return resolve(HOME, NEUTRAL_DIR);
}

// 托管 node 的版本目录（按版本号从新到旧）
function managedNodeDirs() {
  const out = [];
  for (const base of NODE_VERSIONS_DIRS) {
    try {
      const names = readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of names) out.push(resolve(base, v));
    } catch {
      // 该宿主没有托管 node，跳过
    }
  }
  return out;
}

// 取 bin 的主版本号；不可用返回 null
function nodeMajor(bin) {
  try {
    const out = execSync(bin === 'node' ? 'node --version' : `"${bin}" --version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    const m = out.match(/v?(\d+)\./);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// 找一个 Node 22+：PATH 里的 node 优先，其次托管目录（版本从新到旧）
function nodeBin() {
  const candidates = ['node'];
  for (const dir of managedNodeDirs()) {
    candidates.push(resolve(dir, process.platform === 'win32' ? 'node.exe' : 'bin/node'));
  }
  for (const c of candidates) {
    const major = nodeMajor(c);
    if (major !== null && major >= 22) return c;
  }
  return null;
}

// 用可用的 node 跑 npm-cli.js install（无独立 npm 时回退）。npm 路径同样不写死版本。
function installDeps(home, node) {
  let npmCli = null;
  for (const dir of managedNodeDirs()) {
    const p = resolve(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(p)) { npmCli = p; break; }
  }
  try {
    if (npmCli && node && node !== 'node') {
      execSync(`"${node}" "${npmCli}" install yaml`, { cwd: home, stdio: ['ignore', 'ignore', 'inherit'] });
    } else {
      execSync('npm install yaml', { cwd: home, stdio: ['ignore', 'ignore', 'inherit'] });
    }
    return true;
  } catch (e) {
    console.error(`[ensure_specgate] 依赖安装失败，请在 ${home} 手动执行 npm install yaml：${e.message}`);
    return false;
  }
}

// 是否为「自管缓存」；$SPEC_GATE_HOME 指向的用户克隆不算，绝不改动它
function isManaged(dir) {
  return CACHE_CANDIDATES.some((c) => resolve(c) === resolve(dir));
}

// 把自管缓存刷新到 origin/HEAD（浅克隆下 fetch + reset 比 pull 可靠）；失败不致命
function pullCache(dir) {
  try {
    execSync(`git -C "${dir}" fetch --depth 1 origin HEAD`, { stdio: ['ignore', 'ignore', 'inherit'] });
    execSync(`git -C "${dir}" reset --hard FETCH_HEAD`, { stdio: ['ignore', 'ignore', 'inherit'] });
    console.error('[ensure_specgate] 缓存已刷新到 origin/HEAD');
    return true;
  } catch (e) {
    console.error(`[ensure_specgate] 刷新缓存失败，继续用现有版本：${e.message}`);
    return false;
  }
}

let home = findExisting();

if (!home) {
  const target = cloneTarget();
  mkdirSync(target, { recursive: true });
  console.error(`[ensure_specgate] 克隆 ${REPO} → ${target}`);
  try {
    execSync(`git clone --depth 1 ${REPO} "${target}"`, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    console.error(`[ensure_specgate] 克隆失败：${e.message}`);
    process.exit(1);
  }
  const node = nodeBin();
  if (node) installDeps(target, node);
  else console.error('[ensure_specgate] 未找到 node，跳过依赖安装，请手动在 ' + target + ' 执行 npm install yaml');
  home = target;
} else if (PULL && isManaged(home)) {
  pullCache(home);
  if (!existsSync(resolve(home, 'node_modules', 'yaml'))) {
    const node = nodeBin();
    if (node) installDeps(home, node);
  }
}

// 唯一 stdout：根目录路径
console.log(home);
