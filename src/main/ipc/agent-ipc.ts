import { ipcMain } from 'electron';
import { SubTask } from '../agents/Agent';
import { ToolUseContext } from '../types/tool-context';
import { IpcDependencies } from './types';

/**
 * 注册 Agent 系统 IPC Handlers
 */
export function registerAgentIpcHandlers(deps: IpcDependencies): void {
  const { db, budgetTracker, compactEngine, agentCoordinator, mainWindow, commandLearner } = deps;

  ipcMain.handle('agent:list', () => {
    return agentCoordinator.getAvailableAgents();
  });

  ipcMain.handle('agent:decompose', async (_event, prompt: string, context: ToolUseContext) => {
    const tabId = context.sessionId;
    const config = await db.getActiveAIConfig();
    if (!config) return { success: false, subTasks: [], reasoning: '未配置 AI 服务' };

    // 设置 AI 配置给 CompactEngine（用于智能摘要）
    compactEngine.setAIConfig(config);

    // Claude Code 方案：每次 AI 调用前检查预算，自动触发压缩
    const budgetState = budgetTracker.getState();
    if (budgetState.shouldCompact) {
      console.log(`[AutoCompact] Token 使用 ${budgetState.percentUsed}%，触发自动压缩`);
      const currentContext = db.getContext(tabId);
      const compactResult = await compactEngine.compactWithAISummary(
        currentContext,
        currentContext.taskGoal || prompt
      );
      const newContext = compactEngine.applyCompact(currentContext, compactResult);
      db.updateContext(tabId, newContext);
      budgetTracker.reduceUsage(compactResult.tokenReduction);
      console.log(`[AutoCompact] 完成，节省 ${compactResult.tokenReduction} Token`);
    }

    // 获取最新上下文（可能在压缩后已更新）
    const latestContext = db.getContext(tabId);
    const updatedToolContext = {
      ...context,
      sessionContext: latestContext
    };

    const result = await agentCoordinator.decomposeTask(prompt, updatedToolContext, config);

    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    return result;
  });

  ipcMain.handle('agent:execute', async (
    _event,
    agentName: string,
    subTasks: SubTask[],
    context: ToolUseContext,
    userPrompt: string
  ) => {
    const tabId = context.sessionId;
    const config = await db.getActiveAIConfig();
    if (!config) return { agentName, success: false, subTasks, errors: ['未配置 AI 服务'], durationMs: 0 };

    const result = await agentCoordinator.executeTask(
      agentName, subTasks, context, config, userPrompt,
      (updatedSubTasks) => {
        mainWindow?.webContents.send('agent:progress', { tabId, subTasks: updatedSubTasks });
      }
    );

    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    // 记录命令学习（异步，不阻塞返回）
    const completedTasks = result.subTasks.filter(t => t.status === 'completed' && t.toolInput?.command);
    for (const task of completedTasks) {
      commandLearner.recordExecution(
        userPrompt,
        task.toolInput.command as string,
        task.result?.exitCode === 0
      );
    }

    return result;
  });

  ipcMain.handle('agent:confirm', (_event, tabId: string, taskId: string, isConfirmed: boolean) => {
    return agentCoordinator.resolveConfirmation(tabId, taskId, isConfirmed);
  });
}
