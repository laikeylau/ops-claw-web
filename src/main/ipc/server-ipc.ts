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
        echo '===PROCESSES==='
        ps aux --sort=-%cpu | head -21
        echo '===DOCKER==='
        docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo 'DOCKER_NOT_AVAILABLE'
        echo '===MONITOR_END==='
      `;
      const result = await serverManager.execute(connectionId, monitorScript);
      if (!result.success) return { success: false, error: result.error || '执行监控命令失败' };

      const output = result.stdout || '';

      // 清理输出（去除 \r、ANSI 转义码）
      const cleanOutput = output.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      // 按标记提取段落
      const getSection = (secName: string) => {
        const marker = `===${secName}===`;
        const s = cleanOutput.indexOf(marker);
        if (s === -1) return '';
        const cs = s + marker.length;
        const e = cleanOutput.indexOf('\n===', cs);
        return e === -1 ? cleanOutput.substring(cs).trim() : cleanOutput.substring(cs, e).trim();
      };

      // CPU
      let cpuUsage = '0.0';
      let cpuCores = '0';
      try {
        const cpuMatch = getSection('CPU').match(/(\d+\.?\d*)\s*%?id/);
        if (cpuMatch) cpuUsage = (100 - parseFloat(cpuMatch[1])).toFixed(1);
        cpuCores = getSection('CPU_CORES').replace(/\D/g, '') || '0';
      } catch { /* fallback */ }

      // 内存
      let memTotal = 0, memUsed = 0, memAvail = 0, memUsage = '0.0', totalMem = '0';
      try {
        const memLine = getSection('MEM').split('\n').find((l: string) => l.trim().startsWith('Mem:')) || '';
        if (memLine) {
          const mp = memLine.trim().split(/\s+/);
          memTotal = parseInt(mp[1]) || 0;
          memUsed = parseInt(mp[2]) || 0;
          memAvail = parseInt(mp[6]) || parseInt(mp[3]) || 0;
          memUsage = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : '0.0';
        }
        totalMem = getSection('TOTAL_MEM').replace(/\D/g, '') || String(memTotal);
      } catch { /* fallback */ }

      // 磁盘
      let diskTotal = 'N/A', diskUsed = 'N/A', diskAvail = 'N/A', diskUsage = 'N/A';
      try {
        const diskLine = getSection('DISK').split('\n').find((l: string) => l.trim().startsWith('/')) || '';
        if (diskLine) {
          const dp = diskLine.trim().split(/\s+/);
          diskTotal = dp[1] || 'N/A'; diskUsed = dp[2] || 'N/A';
          diskAvail = dp[3] || 'N/A'; diskUsage = dp[4] || 'N/A';
        }
      } catch { /* fallback */ }

      // 网络
      let netRx = 0, netTx = 0, netIface = '';
      try {
        for (const line of getSection('NET').split('\n')) {
          if (!line.includes(':')) continue;
          const parts = line.split(':');
          const iface = parts[0].trim();
          if (iface === 'lo' || iface === 'docker0' || iface.startsWith('br-') || iface.startsWith('veth')) continue;
          const stats = (parts[1] || '').trim().split(/\s+/);
          if (stats.length >= 10) {
            netRx += parseInt(stats[0]) || 0;
            netTx += parseInt(stats[8]) || 0;
            if (!netIface) netIface = iface;
          }
        }
      } catch { /* fallback */ }

      // 负载
      let load1 = '0', load5 = '0', load15 = '0';
      try {
        const lp = getSection('LOAD').split(/\s+/);
        load1 = lp[0] || '0'; load5 = lp[1] || '0'; load15 = lp[2] || '0';
      } catch { /* fallback */ }

      // 系统信息
      let hostnameRaw = '', osName = 'Linux', kernelVersion = 'N/A', uptimeRaw = '';
      try {
        hostnameRaw = getSection('HOSTNAME');
        uptimeRaw = getSection('UPTIME');
        const osRaw = getSection('OS');
        if (osRaw) {
          const osLines = osRaw.split('\n');
          const prettyLine = osLines.find((l: string) => l.startsWith('PRETTY_NAME='));
          if (prettyLine) osName = prettyLine.split('=')[1].replace(/"/g, '').trim();
          const kernelLine = osLines.find((l: string) => l.trim() && !l.includes('='));
          if (kernelLine) kernelVersion = kernelLine.trim();
        }
      } catch { /* fallback */ }

      // 进程
      let processes: any[] = [];
      try {
        const procRaw = getSection('PROCESSES');
        if (procRaw) {
          processes = procRaw.split('\n').slice(1, 21).map((line: string) => {
            const parts = line.trim().split(/\s+/);
            return {
              user: parts[0] || '', pid: parts[1] || '', cpu: parts[2] || '0', mem: parts[3] || '0',
              vsz: parts[4] || '0', rss: parts[5] || '0', stat: parts[7] || '',
              command: parts.slice(10).join(' '),
            };
          }).filter((p: any) => p.pid && p.pid !== 'PID');
        }
      } catch { /* fallback */ }

      // Docker
      let containers: any[] = [];
      let dockerAvailable = false;
      try {
        const dockerRaw = getSection('DOCKER');
        if (dockerRaw && !dockerRaw.includes('DOCKER_NOT_AVAILABLE') && !dockerRaw.includes('Cannot connect')) {
          dockerAvailable = true;
          containers = dockerRaw.split('\n').filter((l: string) => l.trim()).map((line: string) => {
            const parts = line.split('\t');
            return { id: parts[0] || '', name: parts[1] || '', image: parts[2] || '', status: parts[3] || '', ports: parts[4] || '' };
          }).filter((c: any) => c.id);
        }
      } catch { /* fallback */ }

      return {
        success: true,
        cpu: { usage: cpuUsage, cores: cpuCores },
        memory: { total: memTotal, used: memUsed, available: memAvail, usage: memUsage, totalMB: totalMem },
        disk: { total: diskTotal, used: diskUsed, available: diskAvail, usage: diskUsage },
        network: { rxBytes: netRx, txBytes: netTx, interface: netIface },
        load: { '1m': load1, '5m': load5, '15m': load15 },
        system: { hostname: hostnameRaw, os: osName, kernel: kernelVersion, uptime: uptimeRaw },
        processes,
        docker: { available: dockerAvailable, containers },
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
