import { DatabaseManager } from './database';

/**
 * 内存管理器 - 自动清理过期数据，优化内存使用
 * 
 * 功能：
 * 1. 定期清理过期的聊天记录
 * 2. 压缩旧的命令历史
 * 3. 限制内存中的数据量
 * 4. 监控内存使用情况
 */

interface MemoryStats {
  totalMessages: number;
  totalContexts: number;
  estimatedMemoryMB: number;
  lastCleanup: string;
}

interface CleanupConfig {
  maxMessagesPerTab: number;      // 每个标签页最大消息数
  maxContextAge: number;           // 上下文最大保留时间（小时）
  cleanupInterval: number;         // 清理间隔（分钟）
  autoCleanupEnabled: boolean;     // 是否启用自动清理
}

const DEFAULT_CONFIG: CleanupConfig = {
  maxMessagesPerTab: 200,
  maxContextAge: 24, // 24 小时
  cleanupInterval: 30, // 30 分钟
  autoCleanupEnabled: true,
};

export class MemoryManager {
  private db: DatabaseManager;
  private config: CleanupConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanup: Date = new Date();

  constructor(db: DatabaseManager, config?: Partial<CleanupConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoCleanupEnabled) {
      this.startAutoCleanup();
    }
  }

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(
      () => this.runCleanup(),
      this.config.cleanupInterval * 60 * 1000
    );
  }

  /**
   * 执行清理任务
   */
  async runCleanup(): Promise<MemoryStats> {
    console.log('[MemoryManager] 开始清理...');
    const startTime = Date.now();

    // 1. 清理过期的聊天消息
    await this.cleanupOldMessages();

    // 2. 压缩旧的命令历史
    await this.compressOldHistory();

    // 3. 清理过期的上下文
    await this.cleanupExpiredContexts();

    this.lastCleanup = new Date();
    const duration = Date.now() - startTime;
    
    console.log(`[MemoryManager] 清理完成，耗时 ${duration}ms`);

    return this.getStats();
  }

  /**
   * 清理旧消息
   */
  private async cleanupOldMessages(): Promise<void> {
    try {
      // 获取所有标签页
      const messages = (this.db as any).data?.messages || {};
      let totalCleaned = 0;

      for (const tabId of Object.keys(messages)) {
        const tabMessages = messages[tabId];
        if (!Array.isArray(tabMessages)) continue;

        // 如果超过限制，删除旧消息
        if (tabMessages.length > this.config.maxMessagesPerTab) {
          const toRemove = tabMessages.length - this.config.maxMessagesPerTab;
          messages[tabId] = tabMessages.slice(toRemove);
          totalCleaned += toRemove;
        }
      }

      if (totalCleaned > 0) {
        console.log(`[MemoryManager] 清理了 ${totalCleaned} 条旧消息`);
      }
    } catch (error) {
      console.error('[MemoryManager] 清理消息失败:', error);
    }
  }

  /**
   * 压缩旧的命令历史
   */
  private async compressOldHistory(): Promise<void> {
    try {
      const contexts = (this.db as any).data?.contexts || {};
      let totalCompressed = 0;

      for (const tabId of Object.keys(contexts)) {
        const context = contexts[tabId];
        if (!context?.recentCommands) continue;

        // 保留最近的命令，压缩旧的
        if (context.recentCommands.length > 5) {
          const oldCommands = context.recentCommands.slice(0, -5);
          const recentCommands = context.recentCommands.slice(-5);

          // 生成摘要
          const summary = this.summarizeCommands(oldCommands);
          
          // 更新上下文
          context.recentCommands = recentCommands;
          if (!context.taskHistorySummary) {
            context.taskHistorySummary = summary;
          } else {
            context.taskHistorySummary += '\n' + summary;
          }

          totalCompressed += oldCommands.length;
        }
      }

      if (totalCompressed > 0) {
        console.log(`[MemoryManager] 压缩了 ${totalCompressed} 条命令历史`);
      }
    } catch (error) {
      console.error('[MemoryManager] 压缩历史失败:', error);
    }
  }

  /**
   * 清理过期的上下文
   */
  private async cleanupExpiredContexts(): Promise<void> {
    try {
      const contexts = (this.db as any).data?.contexts || {};
      const now = Date.now();
      const maxAge = this.config.maxContextAge * 60 * 60 * 1000;
      let totalCleaned = 0;

      for (const tabId of Object.keys(contexts)) {
        const context = contexts[tabId];
        if (!context?.taskHistory) continue;

        // 清理过期的任务历史
        const originalLength = context.taskHistory.length;
        context.taskHistory = context.taskHistory.filter((step: any) => {
          const stepTime = new Date(step.timestamp).getTime();
          return now - stepTime < maxAge;
        });

        if (context.taskHistory.length < originalLength) {
          totalCleaned += originalLength - context.taskHistory.length;
        }
      }

      if (totalCleaned > 0) {
        console.log(`[MemoryManager] 清理了 ${totalCleaned} 条过期任务历史`);
      }
    } catch (error) {
      console.error('[MemoryManager] 清理上下文失败:', error);
    }
  }

  /**
   * 生成命令摘要
   */
  private summarizeCommands(commands: any[]): string {
    if (commands.length === 0) return '';

    const successCount = commands.filter(c => c.exitCode === 0).length;
    const failCount = commands.length - successCount;

    return `执行了 ${commands.length} 条命令（${successCount} 成功，${failCount} 失败）`;
  }

  /**
   * 获取内存统计
   */
  getStats(): MemoryStats {
    const data = (this.db as any).data || {};
    const messages = data.messages || {};
    const contexts = data.contexts || {};

    let totalMessages = 0;
    for (const tabId of Object.keys(messages)) {
      totalMessages += (messages[tabId] || []).length;
    }

    // 估算内存使用（粗略）
    const estimatedMemoryMB = (
      JSON.stringify(messages).length + 
      JSON.stringify(contexts).length
    ) / (1024 * 1024);

    return {
      totalMessages,
      totalContexts: Object.keys(contexts).length,
      estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100,
      lastCleanup: this.lastCleanup.toISOString(),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.autoCleanupEnabled && !this.cleanupTimer) {
      this.startAutoCleanup();
    } else if (!this.config.autoCleanupEnabled && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 获取配置
   */
  getConfig(): CleanupConfig {
    return { ...this.config };
  }

  /**
   * 手动触发清理
   */
  async forceCleanup(): Promise<MemoryStats> {
    return this.runCleanup();
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
