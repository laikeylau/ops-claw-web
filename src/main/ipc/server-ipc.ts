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

  // ===== SSH 服务器监控 =====
  ipcMain.handle('ssh:monitor', async (_event, connectionId: string) => {
    try {
      const monitorScript = `
        echo '===MONITOR_START==='
        echo '===CPU==='
        top -bn1 | head -5
        echo '===MEM==='
        free -m
        echo '===DISK==='
        df -h /
        echo '===NET==='
        cat /proc/net/dev | head -4
        echo '===LOAD==='
        cat /proc/loadavg
        echo '===UPTIME==='
        uptime -p 2>/dev/null || uptime
        echo '===OS==='
        cat /etc/os-release 2>/dev/null | head -4
        uname -r
        echo '===HOSTNAME==='
        hostname -f 2>/dev/null || hostname
        echo '===CPU_CORES==='
        nproc
        echo '===TOTAL_MEM==='
        awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo
        echo '===MONITOR_END==='
      `;
      const result = await serverManager.execute(connectionId, monitorScript);
      if (!result.success) return { success: false, error: result.error || '执行监控命令失败' };

      const output = result.stdout || '';
      const section = (name: string) => {
        const re = new RegExp(`===${name}===\\s*([\\s\\S]*?)(?=\\n===|$)`);
        const m = output.match(re);
        return m ? m[1].trim() : '';
      };

      const cpuMatch = section('CPU').match(/(\d+\.?\d*)\s*id/);
      const cpuUsage = cpuMatch ? (100 - parseFloat(cpuMatch[1])).toFixed(1) : 'N/A';

      const memLine = section('MEM').split('\n').find((l: string) => l.startsWith('Mem:')) || '';
      const mp = memLine.split(/\s+/);
      const memTotal = parseInt(mp[1]) || 0;
      const memUsed = parseInt(mp[2]) || 0;
      const memFree = parseInt(mp[3]) || 0;
      const memAvail = parseInt(mp[6]) || memFree;

      const diskLine = section('DISK').split('\n').find((l: string) => l.startsWith('/')) || '';
      const dp = diskLine.split(/\s+/);

      const netLines = section('NET').split('\n').filter((l: string) => l.includes(':') && !l.includes('lo'));
      let netRx = 0, netTx = 0, netIface = '';
      for (const line of netLines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const iface = parts[0].trim();
          if (iface === 'lo' || iface.startsWith('docker') || iface.startsWith('br-')) continue;
          const stats = parts[1].trim().split(/\s+/);
          netRx += parseInt(stats[0]) || 0;
          netTx += parseInt(stats[8]) || 0;
          if (!netIface) netIface = iface;
        }
      }

      const loadParts = section('LOAD').split(/\s+/);
      const osRaw = section('OS');

      return {
        success: true,
        cpu: { usage: cpuUsage, cores: section('CPU_CORES') || 'N/A' },
        memory: { total: memTotal, used: memUsed, available: memAvail, usage: memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : 'N/A', totalMB: section('TOTAL_MEM') || 'N/A' },
        disk: { total: dp[1] || 'N/A', used: dp[2] || 'N/A', available: dp[3] || 'N/A', usage: dp[4] || 'N/A' },
        network: { rxBytes: netRx, txBytes: netTx, interface: netIface },
        load: { '1m': loadParts[0] || 'N/A', '5m': loadParts[1] || 'N/A', '15m': loadParts[2] || 'N/A' },
        system: {
          hostname: section('HOSTNAME'),
          os: osRaw.split('\n').find((l: string) => l.startsWith('PRETTY_NAME'))?.split('=')[1]?.replace(/"/g, '') || 'Linux',
          kernel: osRaw.split('\n').find((l: string) => !l.includes('=')) || 'N/A',
          uptime: section('UPTIME'),
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ssh:geoip', async (_event, connectionId: string) => {
    try {
      const result = await serverManager.execute(connectionId, 'curl -s --connect-timeout 5 ipinfo.io/json 2>/dev/null || echo "{}"');
      if (!result.success) return { success: false, error: result.error };
      try {
        return { success: true, ...JSON.parse(result.stdout || '{}') };
      } catch {
        return { success: false, error: '解析失败' };
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
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
