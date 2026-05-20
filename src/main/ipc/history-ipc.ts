import { ipcMain } from 'electron';
import { IpcDependencies } from './types';

/**
 * 注册执行历史 IPC Handlers
 */
export function registerExecutionHistoryIpcHandlers(deps: IpcDependencies): void {
  const { executionHistory } = deps;

  // 获取历史记录列表
  ipcMain.handle('history:list', (_event, options?: any) => {
    return executionHistory.getRecords(options);
  });

  // 获取单条记录
  ipcMain.handle('history:get', (_event, id: string) => {
    return executionHistory.getRecord(id);
  });

  // 添加执行记录
  ipcMain.handle('history:add', (_event, record: any) => {
    return executionHistory.addRecord(record);
  });

  // 切换收藏状态
  ipcMain.handle('history:toggleFavorite', (_event, id: string) => {
    return executionHistory.toggleFavorite(id);
  });

  // 删除记录
  ipcMain.handle('history:delete', (_event, id: string) => {
    return executionHistory.deleteRecord(id);
  });

  // 清空历史
  ipcMain.handle('history:clear', (_event, keepFavorites?: boolean) => {
    executionHistory.clearHistory(keepFavorites !== false);
    return { success: true };
  });

  // 获取分类列表
  ipcMain.handle('history:categories', () => {
    return executionHistory.getCategories();
  });

  // 获取标签列表
  ipcMain.handle('history:tags', () => {
    return executionHistory.getTags();
  });

  // 获取统计信息
  ipcMain.handle('history:stats', () => {
    return executionHistory.getStats();
  });
}
