import fs from 'fs';
import path from 'path';

/**
 * 命令学习器 - 记住用户常用的命令模式
 * 
 * 功能：
 * 1. 记录用户执行的命令频率
 * 2. 根据用户输入推荐历史命令
 * 3. 学习用户的命令习惯
 */

interface CommandPattern {
  prompt: string;           // 用户输入的自然语言
  command: string;          // 实际执行的命令
  count: number;            // 执行次数
  lastUsed: string;         // 最后使用时间
  successRate: number;      // 成功率
}

interface CommandLearningData {
  patterns: CommandPattern[];
  userCommands: Record<string, number>;  // 命令 -> 频率
  promptCommandMap: Record<string, string[]>;  // 用户输入 -> 常用命令
}

const MAX_PATTERNS = 500;
const MAX_USER_COMMANDS = 1000;
const SIMILARITY_THRESHOLD = 0.6;

export class CommandLearner {
  private dataPath: string;
  private data: CommandLearningData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir?: string) {
    const baseDir = dataDir || (typeof process !== 'undefined' && process.env.APPDATA) 
      ? path.join(process.env.APPDATA, 'ops-claw')
      : path.join(process.cwd(), 'data');
    
    this.dataPath = path.join(baseDir, 'command-learn.json');
    this.data = this.loadData();
  }

  private loadData(): CommandLearningData {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // 加载失败使用默认数据
    }
    return { patterns: [], userCommands: {}, promptCommandMap: {} };
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch {
        // 保存失败不影响主流程
      }
    }, 1000);
  }

  /**
   * 记录用户执行的命令
   */
  recordExecution(prompt: string, command: string, success: boolean): void {
    // 1. 更新命令频率
    this.data.userCommands[command] = (this.data.userCommands[command] || 0) + 1;
    
    // 限制大小
    const commands = Object.entries(this.data.userCommands);
    if (commands.length > MAX_USER_COMMANDS) {
      // 移除最少使用的命令
      commands.sort((a, b) => a[1] - b[1]);
      const toRemove = commands.slice(0, commands.length - MAX_USER_COMMANDS);
      for (const [cmd] of toRemove) {
        delete this.data.userCommands[cmd];
      }
    }

    // 2. 更新 prompt -> command 映射
    const normalizedPrompt = this.normalizePrompt(prompt);
    if (!this.data.promptCommandMap[normalizedPrompt]) {
      this.data.promptCommandMap[normalizedPrompt] = [];
    }
    
    const existingIndex = this.data.promptCommandMap[normalizedPrompt].indexOf(command);
    if (existingIndex > -1) {
      // 已存在，移到前面（最近使用）
      this.data.promptCommandMap[normalizedPrompt].splice(existingIndex, 1);
    }
    this.data.promptCommandMap[normalizedPrompt].unshift(command);
    
    // 限制每个 prompt 的命令数量
    if (this.data.promptCommandMap[normalizedPrompt].length > 5) {
      this.data.promptCommandMap[normalizedPrompt] = this.data.promptCommandMap[normalizedPrompt].slice(0, 5);
    }

    // 3. 更新模式
    const existingPattern = this.data.patterns.find(
      p => p.prompt === normalizedPrompt && p.command === command
    );

    if (existingPattern) {
      existingPattern.count++;
      existingPattern.lastUsed = new Date().toISOString();
      existingPattern.successRate = (
        existingPattern.successRate * (existingPattern.count - 1) + (success ? 1 : 0)
      ) / existingPattern.count;
    } else {
      this.data.patterns.push({
        prompt: normalizedPrompt,
        command,
        count: 1,
        lastUsed: new Date().toISOString(),
        successRate: success ? 1 : 0,
      });
    }

    // 限制模式数量
    if (this.data.patterns.length > MAX_PATTERNS) {
      this.data.patterns.sort((a, b) => b.count - a.count);
      this.data.patterns = this.data.patterns.slice(0, MAX_PATTERNS);
    }

    this.scheduleSave();
  }

  /**
   * 根据用户输入推荐命令
   */
  recommendCommands(prompt: string): Array<{ command: string; confidence: number; reason: string }> {
    const normalizedPrompt = this.normalizePrompt(prompt);
    const recommendations: Array<{ command: string; confidence: number; reason: string }> = [];

    // 1. 精确匹配
    const exactMatches = this.data.promptCommandMap[normalizedPrompt];
    if (exactMatches && exactMatches.length > 0) {
      for (const cmd of exactMatches.slice(0, 3)) {
        const pattern = this.data.patterns.find(
          p => p.prompt === normalizedPrompt && p.command === cmd
        );
        recommendations.push({
          command: cmd,
          confidence: 0.9 + (pattern?.count || 0) * 0.01,
          reason: '历史执行记录',
        });
      }
    }

    // 2. 模糊匹配
    if (recommendations.length < 3) {
      const similarPatterns = this.findSimilarPatterns(normalizedPrompt);
      for (const pattern of similarPatterns) {
        if (!recommendations.some(r => r.command === pattern.command)) {
          const similarity = this.calculateSimilarity(normalizedPrompt, pattern.prompt);
          recommendations.push({
            command: pattern.command,
            confidence: similarity * 0.8,
            reason: `类似任务: "${pattern.prompt}"`,
          });
        }
      }
    }

    // 3. 高频命令推荐
    if (recommendations.length < 3) {
      const topCommands = Object.entries(this.data.userCommands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      for (const [cmd, count] of topCommands) {
        if (!recommendations.some(r => r.command === cmd)) {
          recommendations.push({
            command: cmd,
            confidence: 0.3 + Math.min(count / 100, 0.3),
            reason: '常用命令',
          });
        }
      }
    }

    return recommendations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * 获取用户的高频命令
   */
  getFrequentCommands(limit: number = 10): Array<{ command: string; count: number }> {
    return Object.entries(this.data.userCommands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([command, count]) => ({ command, count }));
  }

  /**
   * 获取用户最近使用的命令
   */
  getRecentCommands(limit: number = 10): Array<{ command: string; lastUsed: string }> {
    return this.data.patterns
      .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
      .slice(0, limit)
      .map(p => ({ command: p.command, lastUsed: p.lastUsed }));
  }

  /**
   * 清除学习数据
   */
  clearData(): void {
    this.data = { patterns: [], userCommands: {}, promptCommandMap: {} };
    this.scheduleSave();
  }

  // ===== 私有方法 =====

  private normalizePrompt(prompt: string): string {
    return prompt
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[？！。，、；：""''（）【】《》]/g, '');
  }

  private findSimilarPatterns(prompt: string): CommandPattern[] {
    const threshold = SIMILARITY_THRESHOLD;
    return this.data.patterns
      .filter(p => {
        const similarity = this.calculateSimilarity(prompt, p.prompt);
        return similarity >= threshold;
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // 简单的字符级相似度计算
    const aChars = new Set(a);
    const bChars = new Set(b);
    const intersection = new Set([...aChars].filter(x => bChars.has(x)));
    const union = new Set([...aChars, ...bChars]);
    
    return intersection.size / union.size;
  }
}
