import { ipcMain } from 'electron';
import { AIContext } from '../ai-engine';
import { CommandHistory } from '../database';
import { IpcDependencies } from './types';

/**
 * 注册 AI 相关 IPC Handlers（生成、分析、配置管理）
 */
export function registerAiIpcHandlers(deps: IpcDependencies): void {
  const { db, aiEngine, budgetTracker, sessionLogger } = deps;

  // ===== AI 命令生成 =====
  ipcMain.handle('ai:generate', async (_event, tabId: string, prompt: string, context: AIContext) => {
    const config = await db.getActiveAIConfig();
    if (!config) return { success: false, error: '未配置 AI 服务' };

    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal || prompt
    };

    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(),
      action: 'intent',
      content: prompt
    });
    sessionLogger.log('user_intent', tabId, { prompt });
    db.updateContext(tabId, { taskGoal: prompt });

    const result = await aiEngine.generateCommand(prompt, mergedContext, config);
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }
    sessionLogger.log('ai_command', tabId, { command: result.command, explanation: result.explanation });
    return result;
  });

  // ===== AI 结果分析 =====
  ipcMain.handle('ai:analyze', async (_event, tabId: string, userPrompt: string, command: string, output: string, exitCode: number | undefined, context: AIContext) => {
    const config = await db.getActiveAIConfig();
    if (!config) return { success: false, error: '未配置 AI 服务' };

    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal
    };

    const result = await aiEngine.analyzeResult(userPrompt, command, output, exitCode, mergedContext, config);
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(),
      action: 'result',
      content: output.substring(0, 500),
      command,
      result: `退出码: ${exitCode}`
    });

    const cmdHistory: CommandHistory = {
      command,
      output: output.substring(0, 1000),
      exitCode: exitCode ?? 1,
      timestamp: new Date().toISOString(),
      directory: dbContext.currentDirectory
    };
    db.addCommandToHistory(tabId, cmdHistory);
    return result;
  });

  // ===== AI 配置管理 =====
  ipcMain.handle('ai:listConfigs', () => db.getAIConfigs());
  ipcMain.handle('ai:getConfig', async (_event, id: number) => await db.getAIConfig(id));
  ipcMain.handle('ai:getActiveConfig', async () => await db.getActiveAIConfig());
  ipcMain.handle('ai:addConfig', async (_event, config) => await db.addAIConfig(config));
  ipcMain.handle('ai:updateConfig', async (_event, id: number, config) => await db.updateAIConfig(id, config));
  ipcMain.handle('ai:deleteConfig', async (_event, id: number) => await db.deleteAIConfig(id));
  ipcMain.handle('ai:setActiveConfig', (_event, id: number) => db.setActiveAIConfig(id));
  ipcMain.handle('ai:getActiveConfigId', () => db.getActiveAIConfigId());
}
