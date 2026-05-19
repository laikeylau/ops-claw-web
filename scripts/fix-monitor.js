const fs = require('fs');
let code = fs.readFileSync('src/server/index.ts', 'utf-8');

const startMarker = "    // 解析各段输出";
const endMarker = "      docker: { available: !dockerRaw.includes('DOCKER_NOT_AVAILABLE'), containers },\n    });";

const startIdx = code.indexOf(startMarker);
const endIdx = code.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  console.log('Start found:', startIdx !== -1);
  console.log('End found:', endIdx !== -1);
  process.exit(1);
}

const endFull = endIdx + endMarker.length;

const replacement = `    // 清理输出（去除 \\r 回车符、ANSI 转义码）
    const cleanOutput = output.replace(/\\r/g, '').replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '');

    // 按标记提取段落（比正则更可靠）
    const getSection = (name: string) => {
      const marker = \`===\${name}===\`;
      const start = cleanOutput.indexOf(marker);
      if (start === -1) return '';
      const contentStart = start + marker.length;
      const nextMarker = cleanOutput.indexOf('\\n===', contentStart);
      return nextMarker === -1
        ? cleanOutput.substring(contentStart).trim()
        : cleanOutput.substring(contentStart, nextMarker).trim();
    };

    // CPU 解析（兼容多种 top 输出格式）
    let cpuUsage = '0.0';
    let cpuCores = '0';
    try {
      const cpuRaw = getSection('CPU');
      const cpuMatch = cpuRaw.match(/(\\d+\\.?\\d*)\\s*%?id/);
      if (cpuMatch) cpuUsage = (100 - parseFloat(cpuMatch[1])).toFixed(1);
      cpuCores = getSection('CPU_CORES').replace(/\\D/g, '') || '0';
    } catch { /* fallback */ }

    // 内存解析（兼容不同 free 输出格式）
    let memTotal = 0, memUsed = 0, memAvailable = 0, memUsage = '0.0', totalMem = '0';
    try {
      const memRaw = getSection('MEM');
      const memLine = memRaw.split('\\n').find((l: string) => l.trim().startsWith('Mem:')) || '';
      if (memLine) {
        const mp = memLine.trim().split(/\\s+/);
        memTotal = parseInt(mp[1]) || 0;
        memUsed = parseInt(mp[2]) || 0;
        memAvailable = parseInt(mp[6]) || parseInt(mp[3]) || 0;
        memUsage = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : '0.0';
      }
      totalMem = getSection('TOTAL_MEM').replace(/\\D/g, '') || String(memTotal);
    } catch { /* fallback */ }

    // 磁盘解析
    let diskTotal = 'N/A', diskUsed = 'N/A', diskAvail = 'N/A', diskUsage = 'N/A';
    try {
      const diskRaw = getSection('DISK');
      const diskLine = diskRaw.split('\\n').find((l: string) => l.trim().startsWith('/')) || '';
      if (diskLine) {
        const dp = diskLine.trim().split(/\\s+/);
        diskTotal = dp[1] || 'N/A';
        diskUsed = dp[2] || 'N/A';
        diskAvail = dp[3] || 'N/A';
        diskUsage = dp[4] || 'N/A';
      }
    } catch { /* fallback */ }

    // 网络解析
    let netRxBytes = 0, netTxBytes = 0, netInterface = '';
    try {
      const netRaw = getSection('NET');
      for (const line of netRaw.split('\\n')) {
        if (!line.includes(':')) continue;
        const parts = line.split(':');
        const iface = parts[0].trim();
        if (iface === 'lo' || iface === 'docker0' || iface.startsWith('br-') || iface.startsWith('veth')) continue;
        const stats = (parts[1] || '').trim().split(/\\s+/);
        if (stats.length >= 10) {
          netRxBytes += parseInt(stats[0]) || 0;
          netTxBytes += parseInt(stats[8]) || 0;
          if (!netInterface) netInterface = iface;
        }
      }
    } catch { /* fallback */ }

    // 负载解析
    let load1 = '0', load5 = '0', load15 = '0';
    try {
      const lp = getSection('LOAD').split(/\\s+/);
      load1 = lp[0] || '0';
      load5 = lp[1] || '0';
      load15 = lp[2] || '0';
    } catch { /* fallback */ }

    // 系统信息解析
    let hostnameRaw = '', osName = 'Linux', kernelVersion = 'N/A', uptimeRaw = '';
    try {
      hostnameRaw = getSection('HOSTNAME');
      uptimeRaw = getSection('UPTIME');
      const osRaw = getSection('OS');
      if (osRaw) {
        const osLines = osRaw.split('\\n');
        const prettyLine = osLines.find((l: string) => l.startsWith('PRETTY_NAME='));
        if (prettyLine) osName = prettyLine.split('=')[1].replace(/"/g, '').trim();
        const kernelLine = osLines.find((l: string) => l.trim() && !l.includes('='));
        if (kernelLine) kernelVersion = kernelLine.trim();
      }
    } catch { /* fallback */ }

    // 进程解析
    let processes: any[] = [];
    try {
      const procRaw = getSection('PROCESSES');
      if (procRaw) {
        processes = procRaw.split('\\n').slice(1, 21).map((line: string) => {
          const parts = line.trim().split(/\\s+/);
          return {
            user: parts[0] || '', pid: parts[1] || '', cpu: parts[2] || '0', mem: parts[3] || '0',
            vsz: parts[4] || '0', rss: parts[5] || '0', stat: parts[7] || '',
            command: parts.slice(10).join(' '),
          };
        }).filter((p: any) => p.pid && p.pid !== 'PID');
      }
    } catch { /* fallback */ }

    // Docker 解析
    let containers: any[] = [];
    let dockerAvailable = false;
    try {
      const dockerRaw = getSection('DOCKER');
      if (dockerRaw && !dockerRaw.includes('DOCKER_NOT_AVAILABLE') && !dockerRaw.includes('Cannot connect')) {
        dockerAvailable = true;
        containers = dockerRaw.split('\\n').filter((l: string) => l.trim()).map((line: string) => {
          const parts = line.split('\\t');
          return { id: parts[0] || '', name: parts[1] || '', image: parts[2] || '', status: parts[3] || '', ports: parts[4] || '' };
        }).filter((c: any) => c.id);
      }
    } catch { /* fallback */ }

    res.json({
      success: true,
      cpu: { usage: cpuUsage, cores: cpuCores },
      memory: { total: memTotal, used: memUsed, available: memAvailable, usage: memUsage, totalMB: totalMem },
      disk: { total: diskTotal, used: diskUsed, available: diskAvail, usage: diskUsage },
      network: { rxBytes: netRxBytes, txBytes: netTxBytes, interface: netInterface },
      load: { '1m': load1, '5m': load5, '15m': load15 },
      system: { hostname: hostnameRaw, os: osName, kernel: kernelVersion, uptime: uptimeRaw },
      processes,
      docker: { available: dockerAvailable, containers },
    });`;

code = code.substring(0, startIdx) + replacement + code.substring(endFull);
fs.writeFileSync('src/server/index.ts', code, 'utf-8');
console.log('OK, new size:', code.length);
