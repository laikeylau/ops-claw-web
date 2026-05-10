import { ipcMain } from 'electron';
import { SessionContext, TaskStep, CommandHistory } from '../database';
import { IpcDependencies } from './types';

/**
 * 注册上下文管理 IPC Handlers（上下文、消息、Token 预算）
 */
export function registerContextIpcHandlers(deps: IpcDependencies): void {
  const { db, budgetTracker, compactEngine } = deps;

  // ===== 上下文管理 =====
  ipcMain.handle('context:get', (_event, tabId: string) => db.getContext(tabId));

  ipcMain.handle('context:update', (_event, tabId: string, updates: Partial<SessionContext>) =>
    db.updateContext(tabId, updates)
  );

  ipcMain.handle('context:clear', (_event, tabId: string) => db.clearContext(tabId));

  ipcMain.handle('context:summary', (_event, tabId: string) => db.buildHistorySummary(tabId));

  ipcMain.handle('context:addTaskStep', (_event, tabId: string, step: TaskStep) => {
    db.addTaskStep(tabId, step);
    return db.getContext(tabId);
  });

  ipcMain.handle('context:addCommand', (_event, tabId: string, command: CommandHistory) => {
    db.addCommandToHistory(tabId, command);
    return db.getContext(tabId);
  });

  // ===== 聊天消息 =====
  ipcMain.handle('message:list', (_event, tabId: string) => db.getMessages(tabId));
  ipcMain.handle('message:save', (_event, tabId: string, message: any) => db.saveMessage(tabId, message));
  ipcMain.handle('message:clear', (_event, tabId: string) => db.deleteServerMessages(tabId));

  // ===== Token 预算管理 =====
  ipcMain.handle('budget:state', () => budgetTracker.getState());

  ipcMain.handle('budget:reset', () => {
    budgetTracker.reset();
    return budgetTracker.getState();
  });

  ipcMain.handle('budget:compact', (_event, tabId: string) => {
    const context = db.getContext(tabId);
    const result = compactEngine.compact(context);
    const newContext = compactEngine.applyCompact(context, result);
    db.updateContext(tabId, newContext);
    budgetTracker.reduceUsage(result.tokenReduction);
    return { budgetState: budgetTracker.getState(), compactResult: result };
  });
}
