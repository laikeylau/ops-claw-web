import { ServerManager } from './server-manager';

/**
 * 服务器资源监控
 * 
 * 功能：
 * 1. CPU 使用率监控
 * 2. 内存使用监控
 * 3. 磁盘使用监控
 * 4. 网络流量监控
 * 5. 进程监控
 */

export interface ServerMetrics {
  serverId: number;
  timestamp: string;
  
  // CPU
  cpu: {
    usage: number;        // 使用率百分比
    cores: number;        // 核心数
    loadAvg: number[];    // 负载平均值 [1min, 5min, 15min]
    model?: string;       // CPU 型号
  };
  
  // 内存
  memory: {
    total: number;        // 总内存 (bytes)
    used: number;         // 已使用 (bytes)
    free: number;         // 空闲 (bytes)
    usage: number;        // 使用率百分比
    swapTotal?: number;   // Swap 总量
    swapUsed?: number;    // Swap 使用
  };
  
  // 磁盘
  disk: {
    partitions: Array<{
      filesystem: string;
      mount: string;
      total: number;
      used: number;
      free: number;
      usage: number;
    }>;
  };
  
  // 网络
  network: {
    interfaces: Array<{
      name: string;
      rxBytes: number;    // 接收字节
      txBytes: number;    // 发送字节
      rxPackets: number;  // 接收包数
      txPackets: number;  // 发送包数
    }>;
    connections: number;  // 连接数
  };
  
  // 系统
  system: {
    hostname: string;
    os: string;
    kernel: string;
    uptime: number;       // 运行时间 (秒)
    processes: number;    // 进程数
  };
}

export interface MonitorAlert {
  id: string;
  serverId: number;
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'process';
  level: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
}

export interface MonitorConfig {
  enabled: boolean;
  interval: number;        // 采集间隔 (毫秒)
  retention: number;       // 数据保留时长 (小时)
  alerts: {
    cpu: { warning: number; critical: number };
    memory: { warning: number; critical: number };
    disk: { warning: number; critical: number };
  };
}

const DEFAULT_CONFIG: MonitorConfig = {
  enabled: true,
  interval: 30000,  // 30 秒
  retention: 24,    // 24 小时
  alerts: {
    cpu: { warning: 80, critical: 95 },
    memory: { warning: 85, critical: 95 },
    disk: { warning: 90, critical: 95 },
  },
};

export class ServerMonitorManager {
  private serverManager: ServerManager;
  private config: MonitorConfig;
  private metricsHistory: Map<number, ServerMetrics[]> = new Map();
  private alerts: MonitorAlert[] = [];
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private connectionServerMap: Map<string, number> = new Map(); // connectionId -> serverId

  constructor(serverManager: ServerManager, config?: Partial<MonitorConfig>) {
    this.serverManager = serverManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册服务器连接
   */
  registerConnection(connectionId: string, serverId: number): void {
    this.connectionServerMap.set(connectionId, serverId);
  }

  /**
   * 开始监控
   */
  startMonitoring(): void {
    if (this.monitorTimer) {
      return;
    }

    this.monitorTimer = setInterval(() => {
      this.collectAllMetrics();
    }, this.config.interval);

    // 立即采集一次
    this.collectAllMetrics();
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /**
   * 采集所有服务器指标
   */
  private async collectAllMetrics(): Promise<void> {
    for (const [connectionId, serverId] of this.connectionServerMap) {
      try {
        const metrics = await this.collectMetrics(connectionId, serverId);
        if (metrics) {
          this.storeMetrics(serverId, metrics);
          this.checkAlerts(serverId, metrics);
        }
      } catch (error) {
        console.error(`采集服务器 ${serverId} 指标失败:`, error);
      }
    }
  }

  /**
   * 采集单个服务器指标
   */
  private async collectMetrics(connectionId: string, serverId: number): Promise<ServerMetrics | null> {
    try {
      // 并行执行多个采集命令
      const [cpuInfo, memInfo, diskInfo, netInfo, sysInfo] = await Promise.all([
        this.collectCpu(connectionId),
        this.collectMemory(connectionId),
        this.collectDisk(connectionId),
        this.collectNetwork(connectionId),
        this.collectSystem(connectionId),
      ]);

      return {
        serverId,
        timestamp: new Date().toISOString(),
        cpu: cpuInfo,
        memory: memInfo,
        disk: diskInfo,
        network: netInfo,
        system: sysInfo,
      };
    } catch {
      return null;
    }
  }

  /**
   * 采集 CPU 信息
   */
  private async collectCpu(connectionId: string): Promise<ServerMetrics['cpu']> {
    const result = await this.serverManager.execute(connectionId, 
      'nproc && cat /proc/loadavg && grep "model name" /proc/cpuinfo | head -1'
    );
    
    const lines = (result.stdout || '').trim().split('\n');
    const cores = parseInt(lines[0]) || 1;
    const loadParts = (lines[1] || '0 0 0').split(' ').map(Number);
    const model = lines[2]?.split(':')[1]?.trim();

    // 获取 CPU 使用率
    const usageResult = await this.serverManager.execute(connectionId,
      "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"
    );
    const usage = parseFloat(usageResult.stdout) || 0;

    return {
      usage,
      cores,
      loadAvg: [loadParts[0] || 0, loadParts[1] || 0, loadParts[2] || 0],
      model,
    };
  }

  /**
   * 采集内存信息
   */
  private async collectMemory(connectionId: string): Promise<ServerMetrics['memory']> {
    const result = await this.serverManager.execute(connectionId, 'free -b');
    const lines = (result.stdout || '').trim().split('\n');
    
    // 解析内存行
    const memLine = lines.find(l => l.startsWith('Mem:'));
    const swapLine = lines.find(l => l.startsWith('Swap:'));
    
    const memParts = memLine?.split(/\s+/).map(Number) || [];
    const swapParts = swapLine?.split(/\s+/).map(Number) || [];
    
    const total = memParts[1] || 0;
    const used = memParts[2] || 0;
    const free = memParts[3] || 0;
    
    return {
      total,
      used,
      free,
      usage: total > 0 ? Math.round((used / total) * 100) : 0,
      swapTotal: swapParts[1] || 0,
      swapUsed: swapParts[2] || 0,
    };
  }

  /**
   * 采集磁盘信息
   */
  private async collectDisk(connectionId: string): Promise<ServerMetrics['disk']> {
    const result = await this.serverManager.execute(connectionId, 'df -B1');
    const lines = (result.stdout || '').trim().split('\n').slice(1); // 跳过标题行
    
    const partitions = lines.map(line => {
      const parts = line.split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const free = parseInt(parts[3]) || 0;
      
      return {
        filesystem: parts[0] || '',
        mount: parts[5] || '',
        total,
        used,
        free,
        usage: total > 0 ? Math.round((used / total) * 100) : 0,
      };
    }).filter(p => p.filesystem && !p.filesystem.startsWith('tmpfs'));

    return { partitions };
  }

  /**
   * 采集网络信息
   */
  private async collectNetwork(connectionId: string): Promise<ServerMetrics['network']> {
    const result = await this.serverManager.execute(connectionId, 'cat /proc/net/dev');
    const lines = (result.stdout || '').trim().split('\n').slice(2); // 跳过标题行
    
    const interfaces = lines.map(line => {
      const parts = line.trim().split(/[\s:]+/);
      return {
        name: parts[0] || '',
        rxBytes: parseInt(parts[1]) || 0,
        txBytes: parseInt(parts[9]) || 0,
        rxPackets: parseInt(parts[2]) || 0,
        txPackets: parseInt(parts[10]) || 0,
      };
    }).filter(i => i.name && i.name !== 'lo');

    // 获取连接数
    const connResult = await this.serverManager.execute(connectionId, 'ss -s | grep "estab"');
    const connections = parseInt(connResult.stdout?.match(/\d+/)?.[0] || '0');

    return { interfaces, connections };
  }

  /**
   * 采集系统信息
   */
  private async collectSystem(connectionId: string): Promise<ServerMetrics['system']> {
    const result = await this.serverManager.execute(connectionId, 
      'hostname && uname -s -r && cat /proc/uptime && ps aux | wc -l'
    );
    
    const lines = (result.stdout || '').trim().split('\n');
    
    return {
      hostname: lines[0] || '',
      os: lines[1]?.split(' ')[0] || '',
      kernel: lines[1]?.split(' ')[1] || '',
      uptime: parseFloat(lines[2]?.split(' ')[0]) || 0,
      processes: parseInt(lines[3]) - 1 || 0, // 减去标题行
    };
  }

  /**
   * 存储指标数据
   */
  private storeMetrics(serverId: number, metrics: ServerMetrics): void {
    if (!this.metricsHistory.has(serverId)) {
      this.metricsHistory.set(serverId, []);
    }

    const history = this.metricsHistory.get(serverId)!;
    history.push(metrics);

    // 清理过期数据
    const cutoff = Date.now() - (this.config.retention * 60 * 60 * 1000);
    while (history.length > 0 && new Date(history[0].timestamp).getTime() < cutoff) {
      history.shift();
    }
  }

  /**
   * 检查告警
   */
  private checkAlerts(serverId: number, metrics: ServerMetrics): void {
    const { alerts: thresholds } = this.config;

    // CPU 告警
    if (metrics.cpu.usage >= thresholds.cpu.critical) {
      this.addAlert(serverId, 'cpu', 'critical', 
        `CPU 使用率严重过高: ${metrics.cpu.usage}%`,
        metrics.cpu.usage, thresholds.cpu.critical
      );
    } else if (metrics.cpu.usage >= thresholds.cpu.warning) {
      this.addAlert(serverId, 'cpu', 'warning',
        `CPU 使用率过高: ${metrics.cpu.usage}%`,
        metrics.cpu.usage, thresholds.cpu.warning
      );
    }

    // 内存告警
    if (metrics.memory.usage >= thresholds.memory.critical) {
      this.addAlert(serverId, 'memory', 'critical',
        `内存使用率严重过高: ${metrics.memory.usage}%`,
        metrics.memory.usage, thresholds.memory.critical
      );
    } else if (metrics.memory.usage >= thresholds.memory.warning) {
      this.addAlert(serverId, 'memory', 'warning',
        `内存使用率过高: ${metrics.memory.usage}%`,
        metrics.memory.usage, thresholds.memory.warning
      );
    }

    // 磁盘告警
    for (const partition of metrics.disk.partitions) {
      if (partition.usage >= thresholds.disk.critical) {
        this.addAlert(serverId, 'disk', 'critical',
          `磁盘 ${partition.mount} 使用率严重过高: ${partition.usage}%`,
          partition.usage, thresholds.disk.critical
        );
      } else if (partition.usage >= thresholds.disk.warning) {
        this.addAlert(serverId, 'disk', 'warning',
          `磁盘 ${partition.mount} 使用率过高: ${partition.usage}%`,
          partition.usage, thresholds.disk.warning
        );
      }
    }
  }

  /**
   * 添加告警
   */
  private addAlert(
    serverId: number, 
    type: MonitorAlert['type'], 
    level: MonitorAlert['level'],
    message: string,
    value: number,
    threshold: number
  ): void {
    // 避免重复告警（5 分钟内相同类型不重复）
    const recentAlert = this.alerts.find(a => 
      a.serverId === serverId && 
      a.type === type && 
      Date.now() - new Date(a.timestamp).getTime() < 5 * 60 * 1000
    );

    if (recentAlert) {
      return;
    }

    this.alerts.push({
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      serverId,
      type,
      level,
      message,
      value,
      threshold,
      timestamp: new Date().toISOString(),
    });

    // 保留最近 100 条告警
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  /**
   * 获取服务器最新指标
   */
  getLatestMetrics(serverId: number): ServerMetrics | null {
    const history = this.metricsHistory.get(serverId);
    return history?.[history.length - 1] || null;
  }

  /**
   * 获取服务器历史指标
   */
  getMetricsHistory(serverId: number, hours?: number): ServerMetrics[] {
    const history = this.metricsHistory.get(serverId) || [];
    
    if (!hours) {
      return history;
    }

    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return history.filter(m => new Date(m.timestamp).getTime() >= cutoff);
  }

  /**
   * 获取告警列表
   */
  getAlerts(serverId?: number, level?: MonitorAlert['level']): MonitorAlert[] {
    let filtered = this.alerts;

    if (serverId !== undefined) {
      filtered = filtered.filter(a => a.serverId === serverId);
    }

    if (level) {
      filtered = filtered.filter(a => a.level === level);
    }

    return filtered.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * 清除告警
   */
  clearAlerts(serverId?: number): void {
    if (serverId !== undefined) {
      this.alerts = this.alerts.filter(a => a.serverId !== serverId);
    } else {
      this.alerts = [];
    }
  }

  /**
   * 获取监控配置
   */
  getConfig(): MonitorConfig {
    return { ...this.config };
  }

  /**
   * 更新监控配置
   */
  updateConfig(config: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...config };

    // 如果间隔改变，重启监控
    if (config.interval && this.monitorTimer) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  /**
   * 获取服务器摘要
   */
  getSummary(): Array<{
    serverId: number;
    hostname: string;
    cpu: number;
    memory: number;
    disk: number;
    alerts: number;
  }> {
    const summary = [];

    for (const [serverId, history] of this.metricsHistory) {
      const latest = history[history.length - 1];
      if (!latest) continue;

      const alerts = this.alerts.filter(a => 
        a.serverId === serverId && 
        Date.now() - new Date(a.timestamp).getTime() < 60 * 60 * 1000
      ).length;

      summary.push({
        serverId,
        hostname: latest.system.hostname,
        cpu: latest.cpu.usage,
        memory: latest.memory.usage,
        disk: latest.disk.partitions[0]?.usage || 0,
        alerts,
      });
    }

    return summary;
  }
}
