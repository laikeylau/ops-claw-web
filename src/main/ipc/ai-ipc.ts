import { ipcMain } from 'electron';
import { AIContext } from '../ai-engine';
import { CommandHistory, isSimpleCommand } from '../database';
import { IpcDependencies } from './types';

/**
 * 注册 AI 相关 IPC Handlers（生成、分析、配置管理）
 */
export function registerAiIpcHandlers(deps: IpcDependencies): void {
  const { db, aiEngine, budgetTracker, sessionLogger, commandLearner } = deps;

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

  // ===== AI 结果分析（智能跳过简单命令）=====
  ipcMain.handle('ai:analyze', async (_event, tabId: string, userPrompt: string, command: string, output: string, exitCode: number | undefined, context: AIContext) => {
    // 记录命令历史（无论是否分析都要记录）
    const dbContext = db.getContext(tabId);

    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(),
      action: 'result',
      content: output.substring(0, 500),
      command,
      result: `退出码: ${exitCode}`
    });

    const cmdHistory: CommandHistory = {
      command,
      output: output.substring(0, 500),  // 减少输出存储（原1000），节省空间和 token
      exitCode: exitCode ?? 1,
      timestamp: new Date().toISOString(),
      directory: dbContext.currentDirectory
    };
    db.addCommandToHistory(tabId, cmdHistory);

    // 智能跳过：简单命令 + 成功执行 = 不需要 AI 分析（节省约 50% token）
    const isSimple = isSimpleCommand(command);
    const isSuccess = exitCode === 0;
    if (isSimple && isSuccess) {
      return {
        analysis: '命令执行成功。',
        suggestions: [],
      };
    }

    const config = await db.getActiveAIConfig();
    if (!config) return { success: false, error: '未配置 AI 服务' };

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

    // 记录命令学习（异步，不阻塞返回）
    commandLearner.recordExecution(userPrompt, command, exitCode === 0);

    return result;
  });

  // ===== 命令推荐 =====
  ipcMain.handle('ai:recommendCommands', (_event, prompt: string) => {
    return commandLearner.recommendCommands(prompt);
  });

  ipcMain.handle('ai:frequentCommands', (_event, limit?: number) => {
    return commandLearner.getFrequentCommands(limit);
  });

  ipcMain.handle('ai:recentCommands', (_event, limit?: number) => {
    return commandLearner.getRecentCommands(limit);
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
