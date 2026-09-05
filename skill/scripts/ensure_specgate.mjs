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
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const HOME = homedir();
const CACHE = resolve(HOME, '.workbuddy', 'specgate');
const REPO = 'https://github.com/supernisy/specgate';

function hasCli(dir) {
  return !!dir && existsSync(resolve(dir, 'src', 'cli.js'));
}

function findExisting() {
  if (process.env.SPEC_GATE_HOME && hasCli(process.env.SPEC_GATE_HOME)) return process.env.SPEC_GATE_HOME;
  if (hasCli(CACHE)) return CACHE;
  return null;
}

// 在环境里找一个能用的 node（bare 'node' 或已知的 managed 路径）
function nodeBin() {
  const candidates = [
    'node',
    resolve(HOME, '.workbuddy', 'binaries', 'node', 'versions', '22.22.2-2', 'node.exe'),
    'C:\\Users\\super\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node.exe',
  ];
  for (const c of candidates) {
    try {
      execSync(c === 'node' ? 'node --version' : `"${c}" --version`, { stdio: 'ignore' });
      return c;
    } catch { /* try next */ }
  }
  return null;
}

// 用可用的 node 跑 npm-cli.js install（无独立 npm 时回退）
function installDeps(home, node) {
  const npmCli = resolve(
    HOME, '.workbuddy', 'binaries', 'node', 'versions', '22.22.2-2',
    'node_modules', 'npm', 'bin', 'npm-cli.js',
  );
  try {
    if (existsSync(npmCli) && node && node !== 'node') {
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
