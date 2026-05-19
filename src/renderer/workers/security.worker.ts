/**
 * 安全分析 Web Worker
 * 
 * 将重计算的安全分析移到 Worker，避免阻塞 UI
 */

// 危险命令模式
const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+(-[rf]+\s+)*\//i, level: 'critical', reason: '删除根目录' },
  { pattern: /\bmkfs\b/i, level: 'critical', reason: '格式化文件系统' },
  { pattern: /\bdd\b.*of=\/dev/i, level: 'critical', reason: '直接写入设备' },
  { pattern: /\b:(){ :\|:& };:/i, level: 'critical', reason: 'Fork 炸弹' },
  { pattern: /\bchmod\s+777\b/i, level: 'high', reason: '危险权限设置' },
  { pattern: /\bkill\s+-9\s+-1\b/i, level: 'high', reason: '终止所有进程' },
  { pattern: /\brm\s+-rf\b/i, level: 'high', reason: '递归强制删除' },
  { pattern: />\s*\/dev\/sd[a-z]/i, level: 'high', reason: '写入磁盘设备' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash)/i, level: 'high', reason: '远程脚本执行' },
  { pattern: /\bwget\b.*\|\s*(sh|bash)/i, level: 'high', reason: '远程脚本执行' },
  { pattern: /\bshutdown\b/i, level: 'medium', reason: '关机' },
  { pattern: /\breboot\b/i, level: 'medium', reason: '重启' },
  { pattern: /\binit\s+[06]\b/i, level: 'medium', reason: '关机/重启' },
  { pattern: /\bkillall\b/i, level: 'medium', reason: '终止所有同名进程' },
  { pattern: /\bpkill\b/i, level: 'medium', reason: '按模式终止进程' },
];

// 安全命令白名单
const SAFE_COMMANDS = [
  /^ls/, /^ll/, /^la/, /^pwd/, /^whoami/, /^hostname/, /^date/, /^uptime/,
  /^cat/, /^head/, /^tail/, /^less/, /^more/, /^grep/, /^find/, /^wc/,
  /^echo/, /^printf/, /^true$/, /^false$/, /^id$/, /^uname/,
  /^ps/, /^top/, /^htop/, /^free/, /^df/, /^du/, /^mount/,
  /^docker\s+ps/, /^docker\s+images/, /^docker\s+version/, /^docker\s+info/,
  /^git\s+status/, /^git\s+log/, /^git\s+diff/, /^git\s+branch/,
  /^netstat/, /^ss/, /^ip\s+addr/, /^ifconfig/,
  /^ping\s+-c/, /^traceroute/, /^dig/, /^nslookup/,
  /^curl\s+/, /^wget\s+/, /^ssh\s+/, /^scp\s+/,
];

interface AnalysisResult {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation: boolean;
  blocked: boolean;
  reason: string;
  warnings: string[];
  matchedPattern?: string;
}

// 分析命令安全性
function analyzeCommand(command: string): AnalysisResult {
  const trimmed = command.trim();

  // 检查安全命令
  for (const pattern of SAFE_COMMANDS) {
    if (pattern.test(trimmed)) {
      return {
        level: 'safe',
        requiresConfirmation: false,
        blocked: false,
        reason: '安全命令',
        warnings: [],
      };
    }
  }

  // 检查危险模式
  for (const { pattern, level, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      const requiresConfirmation = level === 'medium' || level === 'high';
      const blocked = level === 'critical';

      return {
        level: level as AnalysisResult['level'],
        requiresConfirmation,
        blocked,
        reason,
        warnings: [reason],
        matchedPattern: pattern.source,
      };
    }
  }

  // 未知命令
  return {
    level: 'low',
    requiresConfirmation: false,
    blocked: false,
    reason: '未识别的命令',
    warnings: [],
  };
}

// 批量分析命令
function analyzeBatch(commands: string[]): AnalysisResult[] {
  return commands.map(analyzeCommand);
}

// Worker 消息处理
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'analyze': {
      const result = analyzeCommand(payload.command);
      self.postMessage({ type: 'result', id: payload.id, result });
      break;
    }

    case 'analyzeBatch': {
      const results = analyzeBatch(payload.commands);
      self.postMessage({ type: 'batchResult', id: payload.id, results });
      break;
    }

    default:
      self.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
  }
};

export {};
