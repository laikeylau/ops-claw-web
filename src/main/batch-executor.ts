import { ServerManager, ExecuteResult } from './server-manager';

/**
 * 批量执行管理器
 * 
 * 功能：
 * 1. 同时对多台服务器执行命令
 * 2. 支持并行和串行执行
 * 3. 执行进度回调
 * 4. 结果汇总
 */

export interface BatchExecutionRequest {
  serverIds: number[];
  command: string;
  parallel?: boolean;
  timeout?: number;
  stopOnError?: boolean;
}

export interface BatchExecutionResult {
  success: boolean;
  results: Map<number, ExecuteResult>;
  summary: {
    total: number;
    success: number;
    failed: number;
    duration: number;
  };
  errors: Map<number, string>;
}

export interface BatchProgress {
  completed: number;
  total: number;
  currentServerId: number;
  percent: number;
}

export class BatchExecutor {
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
  }

  /**
   * 批量执行命令
   */
  async execute(
    request: BatchExecutionRequest,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const results = new Map<number, ExecuteResult>();
    const errors = new Map<number, string>();
    const { serverIds, command, parallel = true, timeout = 60000, stopOnError = false } = request;

    let completed = 0;
    const total = serverIds.length;

    if (parallel) {
      // 并行执行
      const promises = serverIds.map(async (serverId) => {
        try {
          // 获取连接
          const connectionId = await this.getConnectionForServer(serverId);
          if (!connectionId) {
            throw new Error(`服务器 ${serverId} 未连接`);
          }

          const result = await this.serverManager.execute(connectionId, command, timeout);
          results.set(serverId, result);
          
          if (!result.success) {
            errors.set(serverId, result.error || '执行失败');
          }

          completed++;
          onProgress?.({
            completed,
            total,
            currentServerId: serverId,
            percent: Math.round((completed / total) * 100),
          });

          return { serverId, result };
        } catch (error: any) {
          const failResult: ExecuteResult = {
            success: false,
            error: error.message,
            exitCode: -1,
          };
          results.set(serverId, failResult);
          errors.set(serverId, error.message);
          
          completed++;
          onProgress?.({
            completed,
            total,
            currentServerId: serverId,
            percent: Math.round((completed / total) * 100),
          });

          return { serverId, result: failResult };
        }
      });

      await Promise.all(promises);
    } else {
      // 串行执行
      for (const serverId of serverIds) {
        try {
          const connectionId = await this.getConnectionForServer(serverId);
          if (!connectionId) {
            throw new Error(`服务器 ${serverId} 未连接`);
          }

          const result = await this.serverManager.execute(connectionId, command, timeout);
          results.set(serverId, result);
          
          if (!result.success) {
            errors.set(serverId, result.error || '执行失败');
            if (stopOnError) {
              break;
            }
          }
        } catch (error: any) {
          const failResult: ExecuteResult = {
            success: false,
            error: error.message,
            exitCode: -1,
          };
          results.set(serverId, failResult);
          errors.set(serverId, error.message);
          
          if (stopOnError) {
            break;
          }
        }

        completed++;
        onProgress?.({
          completed,
          total,
          currentServerId: serverId,
          percent: Math.round((completed / total) * 100),
        });
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    const successCount = Array.from(results.values()).filter(r => r.success).length;

    return {
      success: successCount === total,
      results,
      summary: {
        total,
        success: successCount,
        failed: total - successCount,
        duration,
      },
      errors,
    };
  }

  /**
   * 获取服务器对应的连接 ID
   * 这里需要与 ServerManager 配合，获取已建立的连接
   */
  private async getConnectionForServer(serverId: number): Promise<string | null> {
    // TODO: 实现从 ServerManager 获取连接 ID
    // 目前返回 null，需要在集成时实现
    return null;
  }

  /**
   * 生成执行报告
   */
  generateReport(result: BatchExecutionResult): string {
    const { summary, results, errors } = result;
    
    let report = `批量执行报告\n`;
    report += `${'='.repeat(50)}\n\n`;
    report += `总计: ${summary.total} 台服务器\n`;
    report += `成功: ${summary.success} 台\n`;
    report += `失败: ${summary.failed} 台\n`;
    report += `耗时: ${summary.duration.toFixed(2)} 秒\n\n`;

    if (errors.size > 0) {
      report += `失败详情:\n`;
      report += `${'-'.repeat(50)}\n`;
      for (const [serverId, error] of errors) {
        report += `  服务器 ${serverId}: ${error}\n`;
      }
    }

    return report;
  }
}
