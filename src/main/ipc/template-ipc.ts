import { ipcMain } from 'electron';
import { IpcDependencies } from './types';

/**
 * 注册命令模板 IPC Handlers
 */
export function registerTemplateIpcHandlers(deps: IpcDependencies): void {
  const { commandTemplates } = deps;

  ipcMain.handle('template:list', (_event, category?: string) => {
    return commandTemplates.getTemplates(category);
  });

  ipcMain.handle('template:categories', () => {
    return commandTemplates.getCategories();
  });

  ipcMain.handle('template:search', (_event, query: string) => {
    return commandTemplates.searchTemplates(query);
  });

  ipcMain.handle('template:popular', (_event, limit?: number) => {
    return commandTemplates.getPopularTemplates(limit || 10);
  });

  ipcMain.handle('template:create', (_event, template: any) => {
    return commandTemplates.addTemplate(template);
  });

  ipcMain.handle('template:update', (_event, id: string, template: any) => {
    return { success: commandTemplates.updateTemplate(id, template) };
  });

  ipcMain.handle('template:delete', (_event, id: string) => {
    return { success: commandTemplates.deleteTemplate(id) };
  });

  ipcMain.handle('template:use', (_event, id: string) => {
    commandTemplates.recordUsage(id);
    return { success: true };
  });

  ipcMain.handle('template:render', (_event, templateId: string, variables: Record<string, string>) => {
    const command = commandTemplates.renderTemplate(templateId, variables);
    if (command) {
      return { success: true, command };
    } else {
      return { success: false, error: '模板不存在' };
    }
  });
}
