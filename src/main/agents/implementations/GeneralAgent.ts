import { Agent, AgentConfig, SubTask, AgentExecutionResult } from '../Agent';
import { ToolUseContext } from '../../types/tool-context';
import { ToolExecutor } from '../../tools/ToolExecutor';

const GENERAL_AGENT_CONFIG: AgentConfig = {
  name: 'general',
  displayName: '通用运维助手',
  description: '处理一般运维任务，支持大部分工具',
  priority: 'built-in',
  
  allowedTools: [
    'ssh:execute',
    'ssh:shell:execute',
    'ssh:connect',
    'ssh:disconnect',
    'file:read',
    'file:list',
    'process:list',
    'ai:generate',
    'ai:analyze',
  ],
  
  executionMode: 'adaptive',
  maxConcurrency: 3,
  canDecompose: true,
  maxDepth: 5,
  
  systemPrompt: `你是一个专业的服务器运维助手。帮助用户完成各种运维任务。`,
};

export class GeneralAgent implements Agent {
  config = GENERAL_AGENT_CONFIG;
  private toolExecutor: ToolExecutor;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  shouldHandle(prompt: string, context: ToolUseContext): boolean {
    // 通用 Agent 总是可以处理
    return true;
  }

  async execute(
    subTasks: SubTask[],
    context: ToolUseContext,
    onProgress?: (subTasks: SubTask[]) => void,
    requestConfirmation?: (task: SubTask) => Promise<boolean>
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const results: SubTask[] = [...subTasks];
    const errors: string[] = [];
    
    // 工具函数：更新并在回调中推送状态
    const updateTaskStatus = (index: number, changes: Partial<SubTask>) => {
      Object.assign(results[index], changes);
      onProgress?.([...results]);
    };

    // 智能执行策略：根据任务依赖关系决定串行或并行
    const independentTasks: number[] = [];
    const dependentTasks: Map<string, number[]> = new Map();

    // 分析任务依赖关系
    for (let i = 0; i < results.length; i++) {
      const task = results[i];
      if (task.dependencies && task.dependencies.length > 0) {
        // 有依赖的任务
        for (const dep of task.dependencies) {
          if (!dependentTasks.has(dep)) {
            dependentTasks.set(dep, []);
          }
          dependentTasks.get(dep)!.push(i);
        }
      } else {
        // 无依赖的任务可以并行执行
        independentTasks.push(i);
      }
    }

    // 并行执行无依赖的任务（最多 3 个并发）
    if (independentTasks.length > 1) {
      const concurrency = Math.min(independentTasks.length, 3);
      const chunks: number[][] = [];
      
      for (let i = 0; i < independentTasks.length; i += concurrency) {
        chunks.push(independentTasks.slice(i, i + concurrency));
      }

      for (const chunk of chunks) {
        const promises = chunk.map(async (index) => {
          const task = results[index];
          if (task.status === 'completed' || task.status === 'skipped') return;

          updateTaskStatus(index, { status: 'running' });

          const outcome = await this.executeSubTask(
            task, 
            context, 
            requestConfirmation,
            (status, error) => updateTaskStatus(index, { status, error })
          );

          updateTaskStatus(index, { 
            status: outcome.status, 
            result: outcome.result, 
            error: outcome.error 
          });

          return { index, success: outcome.success, error: outcome.error };
        });

        const outcomes = await Promise.all(promises);
        
        // 检查是否有失败的任务
        for (const outcome of outcomes) {
          if (outcome && !outcome.success) {
            errors.push(`任务 [${results[outcome.index].description}] 失败: ${outcome.error}`);
          }
        }
      }
    } else {
      // 单个任务或只有依赖任务，串行执行
      for (let i = 0; i < results.length; i++) {
        const task = results[i];
        if (task.status === 'completed' || task.status === 'skipped') continue;

        updateTaskStatus(i, { status: 'running' });

        const outcome = await this.executeSubTask(
          task, 
          context, 
          requestConfirmation,
          (status, error) => updateTaskStatus(i, { status, error })
        );

        updateTaskStatus(i, { 
          status: outcome.status, 
          result: outcome.result, 
          error: outcome.error 
        });

        if (!outcome.success) {
          errors.push(`任务 [${task.description}] 失败: ${outcome.error}`);
          // 如果失败，将后续所有 pending 的依赖任务置为 skipped
          for (let j = i + 1; j < results.length; j++) {
            if (results[j].status === 'pending') {
              updateTaskStatus(j, { status: 'skipped', error: '由于前置依赖失败而跳过' });
            }
          }
          break;
        }
      }
    }

    const success = errors.length === 0;
    return {
      agentName: this.config.name,
      success,
      subTasks: results,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  private async executeSubTask(
    task: SubTask,
    context: ToolUseContext,
    requestConfirmation?: (task: SubTask) => Promise<boolean>,
    onStatusChange?: (status: SubTask['status'], error?: string) => void
  ): Promise<{ status: SubTask['status']; result?: any; error?: string; success: boolean }> {
    if (!task.toolName) {
      // 动态推断工具？暂时回退到直接调用 ssh:execute 或跳过
      task.toolName = 'ssh:execute';
      if (!task.toolInput) {
        task.toolInput = { command: task.description };
      }
    }

    // 方案 B：有 shell 会话时，自动切换到 shell 执行（共享终端上下文）
    if (task.toolName === 'ssh:execute' && context.shellSessionId) {
      task.toolName = 'ssh:shell:execute';
    }

    try {
      const input = task.toolInput || {};
      
      // 自动注入上下文中的必要参数
      if (task.toolName === 'ssh:execute' && !input.connectionId && context.connectionId) {
        input.connectionId = context.connectionId;
      }
      // shell 执行需要 shellSessionId
      if (task.toolName === 'ssh:shell:execute' && !input.shellSessionId && context.shellSessionId) {
        input.shellSessionId = context.shellSessionId;
      }

      const request = {
        toolName: task.toolName,
        input,
        context,
        userConfirmed: false,
      };

      let result = await this.toolExecutor.execute(request);

      // 如果需要用户确认，触发挂起逻辑
      if (result.state === 'idle' && result.error === '需要用户确认') {
        if (!requestConfirmation) {
          throw new Error('当前环境不支持权限确认，请联系管理员');
        }
        
        // 更新状态为等待确认并推送到前端
        onStatusChange?.('awaiting_confirmation', result.error);
        
        // 挂起，等待前端 Promise 解决
        const isConfirmed = await requestConfirmation(task);
        
        if (!isConfirmed) {
          return { status: 'failed', success: false, error: '用户拒绝执行该操作' };
        }
        
        // 用户已同意，恢复运行状态并带着授权标志重新执行
        onStatusChange?.('running');
        request.userConfirmed = true;
        result = await this.toolExecutor.execute(request);
      }

      // 动态上下文感知：如果工具执行更新了上下文，同步到当前 context 对象中
      if (result.success && result.contextUpdates) {
        Object.assign(context, result.contextUpdates);
      }

      return {
        status: result.success ? 'completed' : 'failed',
        result: result.data,
        error: result.error,
        success: result.success,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        error: error.message,
        success: false,
      };
    }
  }
}
