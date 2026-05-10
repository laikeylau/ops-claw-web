import { ipcMain } from 'electron';
import { logMessage, getLogPaths } from '../logger';
import { IpcDependencies } from './types';

/**
 * 注册系统级 IPC Handlers（日志、权限、恢复、工具）
 */
export function registerSystemIpcHandlers(deps: IpcDependencies): void {
  const { securityAnalyzer, permissionManager, toolExecutor, toolRegistry,
          sessionRecovery, sessionLogger } = deps;

  // ===== 日志 =====
  ipcMain.handle('log:write', (_event, level: 'info' | 'warn' | 'error', scope: string, message: string, meta?: unknown) => {
    logMessage(level, scope, message, meta);
  });

  ipcMain.handle('log:paths', () => getLogPaths());

  // ===== 命令安全分析 =====
  ipcMain.handle('command:analyze', (_event, command: string) => {
    const analysis = securityAnalyzer.analyze(command);
    const permission = permissionManager.checkPermission(command, analysis.level);
    if (permission === 'allow') {
      analysis.requiresConfirmation = false;
      analysis.blocked = false;
    } else if (permission === 'confirm') {
      analysis.requiresConfirmation = true;
      analysis.blocked = false;
    } else if (permission === 'deny') {
      analysis.requiresConfirmation = true;
      analysis.blocked = true;
    }
    return analysis;
  });

  // ===== 工具系统 =====
  ipcMain.handle('tool:execute', async (_event, request) => {
    return toolExecutor.execute(request);
  });

  ipcMain.handle('tool:list', () => {
    const tools = toolRegistry.getAvailableTools();
    return tools.map(t => ({
      name: t.metadata.name,
      description: t.metadata.description,
      category: t.metadata.category,
      riskLevel: t.security.riskLevel,
    }));
  });

  // ===== 会话恢复 =====
  ipcMain.handle('recovery:check', () => sessionRecovery.checkRecovery());

  ipcMain.handle('recovery:getData', (_event, tabId: string) =>
    sessionRecovery.getServerRecoveryData(tabId)
  );

  ipcMain.handle('recovery:confirm', () => {
    sessionRecovery.confirmRecovery();
    sessionLogger.log('session_start', 'app', { recovered: true });
  });

  ipcMain.handle('recovery:dismiss', () => {
    sessionRecovery.dismissRecovery();
    sessionLogger.log('session_start', 'app', { recovered: false });
  });

  // ===== 权限管理 =====
  ipcMain.handle('permission:getConfig', () => permissionManager.getConfig());

  ipcMain.handle('permission:setMode', (_event, mode: 'standard' | 'cautious' | 'strict') => {
    permissionManager.setMode(mode);
    return permissionManager.getConfig();
  });

  ipcMain.handle('permission:addRule', (_event, rule: { pattern: string; action: 'allow' | 'deny' | 'confirm'; description?: string }) => {
    return permissionManager.addRule(rule);
  });

  ipcMain.handle('permission:removeRule', (_event, id: string) => {
    return permissionManager.removeRule(id);
  });
}
