import { ipcMain, shell } from 'electron';
import { IpcDependencies } from './types';
import { RdpConfig } from '../rdp-manager';

/**
 * 注册 RDP 相关 IPC Handlers
 */
export function registerRdpIpcHandlers(deps: IpcDependencies): void {
  const { db, rdpManager, mainWindow } = deps;

  // ===== RDP 连接管理 =====
  
  /**
   * 检查 RDP 客户端是否可用
   */
  ipcMain.handle('rdp:isAvailable', () => {
    return rdpManager.getClientInfo();
  });

  /**
   * 创建 RDP 连接
   */
  ipcMain.handle('rdp:connect', async (_event, serverId: number, config?: Partial<RdpConfig>) => {
    // 获取服务器配置
    const server = await db.getServerWithPassword(serverId);
    if (!server) {
      return { success: false, error: '服务器不存在' };
    }

    // 构建 RDP 配置
    const rdpConfig: RdpConfig = {
      host: server.host,
      port: server.port || 3389,
      username: server.username,
      password: server.password,
      domain: config?.domain,
      width: config?.width || 1920,
      height: config?.height || 1080,
      colorDepth: config?.colorDepth || 32,
      audioRedirection: config?.audioRedirection ?? true,
      clipboardRedirection: config?.clipboardRedirection ?? true,
      driveRedirection: config?.driveRedirection ?? false,
      securityLayer: config?.securityLayer || 'nla',
      enableNLA: config?.enableNLA ?? true,
      experienceLevel: config?.experienceLevel || 'auto',
      ...config,
    };

    const result = await rdpManager.connect(serverId, rdpConfig);
    return result;
  });

  /**
   * 断开 RDP 连接
   */
  ipcMain.handle('rdp:disconnect', (_event, sessionId: string) => {
    return rdpManager.disconnect(sessionId);
  });

  /**
   * 断开所有 RDP 连接
   */
  ipcMain.handle('rdp:disconnectAll', () => {
    rdpManager.disconnectAll();
    return { success: true };
  });

  /**
   * 获取 RDP 会话状态
   */
  ipcMain.handle('rdp:sessionStatus', (_event, sessionId: string) => {
    return rdpManager.getSessionStatus(sessionId);
  });

  /**
   * 获取所有 RDP 会话
   */
  ipcMain.handle('rdp:allSessions', () => {
    return rdpManager.getAllSessions();
  });

  /**
   * 导出 RDP 配置文件
   */
  ipcMain.handle('rdp:exportFile', async (_event, serverId: number) => {
    const server = await db.getServerWithPassword(serverId);
    if (!server) {
      return { success: false, error: '服务器不存在' };
    }

    const config: RdpConfig = {
      host: server.host,
      port: server.port || 3389,
      username: server.username,
      password: server.password,
    };

    const rdpFilePath = rdpManager.exportRdpFile(config);
    return { success: true, path: rdpFilePath };
  });

  /**
   * 使用系统默认应用打开 RDP
   */
  ipcMain.handle('rdp:openExternal', async (_event, serverId: number) => {
    const server = await db.getServerWithPassword(serverId);
    if (!server) {
      return { success: false, error: '服务器不存在' };
    }

    const config: RdpConfig = {
      host: server.host,
      port: server.port || 3389,
      username: server.username,
      password: server.password,
    };

    try {
      // 生成 RDP URL 或文件
      const rdpUrl = rdpManager.generateRdpUrl(config);
      await shell.openExternal(rdpUrl);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
