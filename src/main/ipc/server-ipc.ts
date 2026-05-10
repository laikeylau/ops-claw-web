import { ipcMain } from 'electron';
import { IpcDependencies } from './types';

/**
 * 注册服务器管理 + SSH 连接 IPC Handlers
 */
export function registerServerIpcHandlers(deps: IpcDependencies): void {
  const { db, serverManager, mainWindow } = deps;

  // ===== 服务器 CRUD =====
  ipcMain.handle('server:list', () => db.getServers());
  ipcMain.handle('server:add', async (_event, config) => await db.addServer(config));
  ipcMain.handle('server:delete', async (_event, id: number) => await db.deleteServer(id));
  ipcMain.handle('server:update', async (_event, id: number, config) => await db.updateServer(id, config));

  // ===== SSH 连接 =====
  ipcMain.handle('ssh:connect', async (_event, serverId: number) => {
    const server = await db.getServerWithPassword(serverId);
    if (!server) return { success: false, error: 'Server not found' };
    return serverManager.connect(server);
  });

  ipcMain.handle('ssh:execute', (_event, connectionId: string, command: string) => {
    return serverManager.execute(connectionId, command);
  });

  ipcMain.handle('ssh:disconnect', (_event, connectionId: string) => {
    serverManager.disconnect(connectionId);
  });

  // ===== Shell 会话 =====
  ipcMain.handle('ssh:shell:create', async (_event, connectionId: string, cols: number, rows: number) => {
    return serverManager.createShellSession(
      connectionId, cols, rows,
      (sessionId, data) => mainWindow?.webContents.send('ssh:shell:data', { sessionId, data }),
      (sessionId) => mainWindow?.webContents.send('ssh:shell:close', { sessionId }),
      (sessionId, error) => mainWindow?.webContents.send('ssh:shell:error', { sessionId, error }),
    );
  });

  ipcMain.handle('ssh:shell:write', (_event, sessionId: string, data: string) => {
    serverManager.writeToShell(sessionId, data);
  });

  ipcMain.handle('ssh:shell:resize', (_event, sessionId: string, cols: number, rows: number) => {
    serverManager.resizeShell(sessionId, cols, rows);
  });

  ipcMain.handle('ssh:shell:close', (_event, sessionId: string) => {
    serverManager.closeShell(sessionId);
  });
}
