import fs from 'fs';
import path from 'path';

/**
 * 审计日志管理器
 * 
 * 功能：
 * 1. 记录所有 AI 生成和执行的命令
 * 2. 记录用户操作
 * 3. 敏感信息脱敏
 * 4. 日志查询和导出
 */

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: 'ai_generate' | 'ai_analyze' | 'command_execute' | 'user_action' | 'security' | 'system';
  userId?: string;
  serverId?: number;
  connectionId?: string;
  action: string;
  details: Record<string, any>;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  result?: 'success' | 'failure' | 'blocked';
}

export interface AuditQuery {
  startTime?: string;
  endTime?: string;
  type?: AuditEntry['type'];
  serverId?: number;
  risk?: AuditEntry['risk'];
  result?: AuditEntry['result'];
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEntries: number;
  byType: Record<string, number>;
  byRisk: Record<string, number>;
  byResult: Record<string, number>;
  topCommands: Array<{ command: string; count: number }>;
}

// 敏感信息模式
const SENSITIVE_PATTERNS = [
  { pattern: /password\s*[=:]\s*['"]?([^\s'"]+)/gi, replacement: 'password=***' },
  { pattern: /-p\s+([^\s]+)/g, replacement: '-p ***' },
  { pattern: /--password[= ]([^\s]+)/g, replacement: '--password=***' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-***' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]+/g, replacement: 'Bearer ***' },
  { pattern: /Authorization:\s*[^\n]+/gi, replacement: 'Authorization: ***' },
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '***.***.***.***' },
];

export class AuditLogger {
  private logDir: string;
  private currentLogFile: string;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly BUFFER_SIZE = 50;
  private readonly FLUSH_INTERVAL = 5000; // 5 秒

  constructor(dataDir?: string) {
    const baseDir = dataDir || (typeof process !== 'undefined' && process.env.APPDATA) 
      ? path.join(process.env.APPDATA, 'ops-claw')
      : path.join(process.cwd(), 'data');
    
    this.logDir = path.join(baseDir, 'audit-logs');
    this.currentLogFile = this.getLogFilePath();
    
    // 确保目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // 启动定时刷新
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `audit-${date}.jsonl`);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 脱敏敏感信息
   */
  private sanitize(value: any): any {
    if (typeof value === 'string') {
      let sanitized = value;
      for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, replacement);
      }
      return sanitized;
    }
    
    if (Array.isArray(value)) {
      return value.map(item => this.sanitize(item));
    }
    
    if (typeof value === 'object' && value !== null) {
      const sanitized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitize(val);
      }
      return sanitized;
    }
    
    return value;
  }

  /**
   * 记录审计条目
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const auditEntry: AuditEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      details: this.sanitize(entry.details),
    };

    this.buffer.push(auditEntry);

    // 缓冲区满时立即刷新
    if (this.buffer.length >= this.BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * 记录 AI 生成命令
   */
  logAIGenerate(serverId: number, prompt: string, command: string): void {
    this.log({
      type: 'ai_generate',
      serverId,
      action: 'AI 生成命令',
      details: { prompt, command },
      risk: 'low',
      result: 'success',
    });
  }

  /**
   * 记录 AI 分析
   */
  logAIAnalyze(serverId: number, command: string, analysis: string): void {
    this.log({
      type: 'ai_analyze',
      serverId,
      action: 'AI 分析结果',
      details: { command, analysis },
      risk: 'low',
      result: 'success',
    });
  }

  /**
   * 记录命令执行
   */
  logCommandExecute(
    serverId: number, 
    command: string, 
    exitCode: number, 
    source: 'user' | 'ai' | 'agent'
  ): void {
    const risk = this.assessCommandRisk(command);
    
    this.log({
      type: 'command_execute',
      serverId,
      action: `执行命令 (${source})`,
      details: { command, exitCode, source },
      risk,
      result: exitCode === 0 ? 'success' : 'failure',
    });
  }

  /**
   * 记录用户操作
   */
  logUserAction(action: string, details: Record<string, any>): void {
    this.log({
      type: 'user_action',
      action,
      details,
      risk: 'low',
    });
  }

  /**
   * 记录安全事件
   */
  logSecurityEvent(
    action: string, 
    details: Record<string, any>, 
    risk: AuditEntry['risk'] = 'medium'
  ): void {
    this.log({
      type: 'security',
      action,
      details,
      risk,
      result: 'blocked',
    });
  }

  /**
   * 评估命令风险
   */
  private assessCommandRisk(command: string): AuditEntry['risk'] {
    const highRiskPatterns = [
      /\brm\s+-rf\b/,
      /\bmkfs\b/,
      /\bdd\b.*of=\/dev/,
      /\bchmod\s+777\b/,
      /\bkill\s+-9\s+-1\b/,
    ];

    const mediumRiskPatterns = [
      /\brm\b/,
      /\bkill\b/,
      /\bshutdown\b/,
      /\breboot\b/,
      /\bchmod\b/,
      /\bchown\b/,
    ];

    if (highRiskPatterns.some(p => p.test(command))) {
      return 'critical';
    }
    if (mediumRiskPatterns.some(p => p.test(command))) {
      return 'high';
    }
    return 'low';
  }

  /**
   * 刷新缓冲区到文件
   */
  private flush(): void {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    // 检查是否需要切换日志文件
    const newLogFile = this.getLogFilePath();
    if (newLogFile !== this.currentLogFile) {
      this.currentLogFile = newLogFile;
    }

    // 追加写入
    const lines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    fs.appendFileSync(this.currentLogFile, lines, 'utf-8');
  }

  /**
   * 查询审计日志
   */
  query(query: AuditQuery): AuditEntry[] {
    const results: AuditEntry[] = [];
    const { startTime, endTime, type, serverId, risk, result, keyword, limit = 100, offset = 0 } = query;

    // 读取日志文件
    const logFiles = fs.readdirSync(this.logDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    let count = 0;
    let skipped = 0;

    for (const file of logFiles) {
      const filePath = path.join(this.logDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      for (const line of lines.reverse()) {
        try {
          const entry: AuditEntry = JSON.parse(line);

          // 应用过滤条件
          if (startTime && entry.timestamp < startTime) continue;
          if (endTime && entry.timestamp > endTime) continue;
          if (type && entry.type !== type) continue;
          if (serverId && entry.serverId !== serverId) continue;
          if (risk && entry.risk !== risk) continue;
          if (result && entry.result !== result) continue;
          if (keyword) {
            const searchStr = JSON.stringify(entry).toLowerCase();
            if (!searchStr.includes(keyword.toLowerCase())) continue;
          }

          // 跳过偏移量
          if (skipped < offset) {
            skipped++;
            continue;
          }

          results.push(entry);
          count++;

          if (count >= limit) {
            return results;
          }
        } catch {
          // 解析失败跳过
        }
      }
    }

    return results;
  }

  /**
   * 获取统计信息
   */
  getStats(days: number = 7): AuditStats {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    const entries = this.query({
      startTime: startTime.toISOString(),
      limit: 10000,
    });

    const stats: AuditStats = {
      totalEntries: entries.length,
      byType: {},
      byRisk: {},
      byResult: {},
      topCommands: [],
    };

    const commandCounts: Record<string, number> = {};

    for (const entry of entries) {
      // 按类型统计
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;

      // 按风险统计
      if (entry.risk) {
        stats.byRisk[entry.risk] = (stats.byRisk[entry.risk] || 0) + 1;
      }

      // 按结果统计
      if (entry.result) {
        stats.byResult[entry.result] = (stats.byResult[entry.result] || 0) + 1;
      }

      // 统计命令频率
      if (entry.type === 'command_execute' && entry.details.command) {
        const cmd = entry.details.command.split(' ')[0];
        commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
      }
    }

    // 获取 Top 10 命令
    stats.topCommands = Object.entries(commandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([command, count]) => ({ command, count }));

    return stats;
  }

  /**
   * 导出日志
   */
  export(format: 'json' | 'csv' = 'json', days: number = 30): string {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    const entries = this.query({
      startTime: startTime.toISOString(),
      limit: 100000,
    });

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV 格式
    const headers = ['id', 'timestamp', 'type', 'serverId', 'action', 'risk', 'result'];
    const rows = entries.map(entry => 
      headers.map(h => {
        const value = entry[h as keyof AuditEntry];
        return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * 清理旧日志
   */
  cleanup(daysToKeep: number = 90): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const files = fs.readdirSync(this.logDir).filter(f => f.endsWith('.jsonl'));
    let deletedCount = 0;

    for (const file of files) {
      const dateMatch = file.match(/audit-(\d{4}-\d{2}-\d{2})\.jsonl/);
      if (dateMatch && dateMatch[1] < cutoffStr) {
        fs.unlinkSync(path.join(this.logDir, file));
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}
