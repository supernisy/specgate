#!/usr/bin/env node
// ============================================================================
// ensure_specgate.mjs —— 确保 specgate CLI 可用，向 stdout 打印一行根目录。
// agent 捕获这一行作为 $SG_HOME。
//   定位优先级：
//     1) $SPEC_GATE_HOME 环境变量（指向含 src/cli.js 的目录）
//     2) ~/.workbuddy/specgate（已克隆）
//     3) 自动 git clone https://github.com/supernisy/specgate 到缓存并 npm install yaml
// 进度信息走 stderr；唯一 stdout 是根目录路径。
// ============================================================================
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const HOME = homedir();
const CACHE = resolve(HOME, '.workbuddy', 'specgate');
const REPO = 'https://github.com/supernisy/specgate';
const NODE_VERSIONS_DIR = resolve(HOME, '.workbuddy', 'binaries', 'node', 'versions');

function hasCli(dir) {
  return !!dir && existsSync(resolve(dir, 'src', 'cli.js'));
}

function findExisting() {
  if (process.env.SPEC_GATE_HOME && hasCli(process.env.SPEC_GATE_HOME)) return process.env.SPEC_GATE_HOME;
  if (hasCli(CACHE)) return CACHE;
  return null;
}

// 托管 node 的版本目录（按版本号从新到旧；目录名形如 22.22.2-3）
function managedNodeDirs() {
  try {
    return readdirSync(NODE_VERSIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => resolve(NODE_VERSIONS_DIR, v));
  } catch {
    return [];
  }
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

let home = findExisting();

if (!home) {
  mkdirSync(CACHE, { recursive: true });
  console.error(`[ensure_specgate] 克隆 ${REPO} → ${CACHE}`);
  try {
    execSync(`git clone --depth 1 ${REPO} "${CACHE}"`, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    console.error(`[ensure_specgate] 克隆失败：${e.message}`);
    process.exit(1);
  }
  const node = nodeBin();
  if (node) installDeps(CACHE, node);
  else console.error('[ensure_specgate] 未找到 node，跳过依赖安装，请手动在 ' + CACHE + ' 执行 npm install yaml');
  home = CACHE;
}

// 唯一 stdout：根目录路径
console.log(home);
