import { ipcMain } from 'electron';
import { IpcDependencies } from './types';

/**
 * 注册内存管理 IPC Handlers
 */
export function registerMemoryIpcHandlers(deps: IpcDependencies): void {
  const { memoryManager, streamingManager } = deps;

  // ===== 内存管理 =====
  ipcMain.handle('memory:stats', () => {
    return memoryManager.getStats();
  });

  ipcMain.handle('memory:cleanup', async () => {
    return await memoryManager.forceCleanup();
  });

  ipcMain.handle('memory:getConfig', () => {
    return memoryManager.getConfig();
  });

  ipcMain.handle('memory:updateConfig', (_event, config) => {
    memoryManager.updateConfig(config);
    return memoryManager.getConfig();
  });

  // ===== 流式响应 =====
  ipcMain.handle('stream:create', (_event, tabId: string, messageId: string) => {
    return streamingManager.createSession(tabId, messageId);
  });

  ipcMain.handle('stream:cancel', (_event, sessionId: string) => {
    streamingManager.cancelSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('stream:content', (_event, sessionId: string) => {
    return streamingManager.getSessionContent(sessionId);
  });
}
