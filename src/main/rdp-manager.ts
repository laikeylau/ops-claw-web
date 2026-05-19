import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * RDP 连接配置
 */
export interface RdpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  domain?: string;
  
  // 显示设置
  width?: number;
  height?: number;
  colorDepth?: number;  // 8, 15, 16, 24, 32
  
  // 连接设置
  autoReconnect?: boolean;
  reconnectInterval?: number;
  connectionTimeout?: number;
  
  // 功能开关
  audioRedirection?: boolean;
  clipboardRedirection?: boolean;
  printerRedirection?: boolean;
  driveRedirection?: boolean;
  usbRedirection?: boolean;
  
  // 安全设置
  securityLayer?: 'rdp' | 'tls' | 'nla';  // 远程桌面、TLS、网络级别身份验证
  enableNLA?: boolean;  // 网络级别身份验证
  
  // 性能设置
  experienceLevel?: 'modem' | 'broadband' | 'lan' | 'auto';
  enableCompression?: boolean;
  enableBitmapCaching?: boolean;
  
  // 其他
  shell?: string;  // 启动程序
  workingDirectory?: string;
  extraArgs?: string[];
}

/**
 * RDP 会话信息
 */
export interface RdpSession {
  id: string;
  serverId: number;
  config: RdpConfig;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startTime: string;
  endTime?: string;
  error?: string;
  process?: ChildProcess;
}

/**
 * RDP 连接结果
 */
export interface RdpConnectResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

/**
 * RDP 会话状态
 */
export interface RdpSessionStatus {
  id: string;
  serverId: number;
  status: RdpSession['status'];
  host: string;
  startTime: string;
  duration?: number;
}

/**
 * RDP 管理器
 * 
 * 支持多种 RDP 连接方式：
 * 1. 原生 RDP 客户端 (mstsc.exe / xfreerdo / openconnect)
 * 2. Web-based RDP (通过 Guacamole 或类似方案)
 * 3. 自定义 RDP 实现
 */
export class RdpManager {
  private sessions: Map<string, RdpSession> = new Map();
  private rdpClientPath: string | null = null;
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'ops-claw-rdp');
    this.detectRdpClient();
    
    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 检测可用的 RDP 客户端
   */
  private detectRdpClient(): void {
    const platform = os.platform();

    if (platform === 'win32') {
      // Windows: 使用 mstsc.exe
      this.rdpClientPath = 'mstsc.exe';
    } else if (platform === 'linux') {
      // Linux: 尝试 xfreerdp 或 rdesktop
      const candidates = ['xfreerdp', 'rdesktop', 'remmina'];
      for (const cmd of candidates) {
        try {
          // 检查命令是否存在
          const result = require('child_process').execSync(`which ${cmd} 2>/dev/null`).toString().trim();
          if (result) {
            this.rdpClientPath = cmd;
            break;
          }
        } catch {
          // 继续尝试下一个
        }
      }
    } else if (platform === 'darwin') {
      // macOS: 使用 Microsoft Remote Desktop 或 openconnect
      this.rdpClientPath = 'open';
    }
  }

  /**
   * 检查 RDP 客户端是否可用
   */
  isRdpAvailable(): boolean {
    return this.rdpClientPath !== null;
  }

  /**
   * 获取 RDP 客户端信息
   */
  getClientInfo(): { available: boolean; client: string | null; platform: string } {
    return {
      available: this.rdpClientPath !== null,
      client: this.rdpClientPath,
      platform: os.platform(),
    };
  }

  /**
   * 创建 RDP 连接
   */
  async connect(serverId: number, config: RdpConfig): Promise<RdpConnectResult> {
    // 检查 RDP 客户端
    if (!this.rdpClientPath) {
      return {
        success: false,
        error: '未找到 RDP 客户端。请安装 xfreerdp (Linux) 或使用 Windows 远程桌面。',
      };
    }

    const sessionId = `rdp_${randomUUID().slice(0, 8)}`;
    const session: RdpSession = {
      id: sessionId,
      serverId,
      config,
      status: 'connecting',
      startTime: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);

    try {
      const process = await this.launchRdpClient(sessionId, config);
      session.process = process;
      session.status = 'connected';

      // 监听进程退出
      process.on('exit', (code) => {
        session.status = 'disconnected';
        session.endTime = new Date().toISOString();
        this.sessions.delete(sessionId);
      });

      process.on('error', (err) => {
        session.status = 'error';
        session.error = err.message;
        session.endTime = new Date().toISOString();
      });

      return {
        success: true,
        sessionId,
      };
    } catch (error: any) {
      session.status = 'error';
      session.error = error.message;
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 启动 RDP 客户端进程
   */
  private async launchRdpClient(sessionId: string, config: RdpConfig): Promise<ChildProcess> {
    const platform = os.platform();

    if (platform === 'win32') {
      return this.launchWindowsRdp(sessionId, config);
    } else if (platform === 'linux') {
      return this.launchLinuxRdp(sessionId, config);
    } else if (platform === 'darwin') {
      return this.launchMacRdp(sessionId, config);
    }

    throw new Error(`不支持的操作系统: ${platform}`);
  }

  /**
   * Windows RDP 客户端
   */
  private async launchWindowsRdp(sessionId: string, config: RdpConfig): Promise<ChildProcess> {
    // 创建 .rdp 配置文件
    const rdpFile = this.createRdpFile(sessionId, config);
    
    // 启动 mstsc.exe
    const args = [rdpFile];
    
    // 添加额外参数
    if (config.width && config.height) {
      // mstsc 不支持直接设置分辨率，需要通过 .rdp 文件
    }

    const process = spawn('mstsc.exe', args, {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    return process;
  }

  /**
   * Linux RDP 客户端 (xfreerdp)
   */
  private async launchLinuxRdp(sessionId: string, config: RdpConfig): Promise<ChildProcess> {
    const args: string[] = [];

    if (this.rdpClientPath === 'xfreerdp') {
      // xfreerdp 参数
      args.push(`/v:${config.host}`);
      args.push(`/port:${config.port || 3389}`);
      args.push(`/u:${config.username}`);
      
      if (config.password) {
        args.push(`/p:${config.password}`);
      }
      
      if (config.domain) {
        args.push(`/d:${config.domain}`);
      }
      
      if (config.width && config.height) {
        args.push(`/size:${config.width}x${config.height}`);
      }
      
      if (config.colorDepth) {
        args.push(`/bpp:${config.colorDepth}`);
      }
      
      // 安全设置
      if (config.securityLayer === 'nla' || config.enableNLA) {
        args.push('/sec:nla');
      } else if (config.securityLayer === 'tls') {
        args.push('/sec:tls');
      }
      
      // 功能开关
      if (config.audioRedirection === false) {
        args.push('/audio-mode:2');
      }
      
      if (config.clipboardRedirection === false) {
        args.push('-clipboard');
      }
      
      if (config.driveRedirection) {
        args.push(`/drive:home,${os.homedir()}`);
      }
      
      // 性能设置
      if (config.experienceLevel === 'lan') {
        args.push('/network:lan');
      } else if (config.experienceLevel === 'broadband') {
        args.push('/network:modem');
      }
      
      // 忽略证书错误
      args.push('/cert:ignore');
      args.push('/auto-reconnect');
      args.push('/dynamic-resolution');
      
    } else if (this.rdpClientPath === 'rdesktop') {
      // rdesktop 参数
      args.push(`-u${config.username}`);
      args.push(`-p${config.password || ''}`);
      args.push(`-g${config.width || 1920}x${config.height || 1080}`);
      args.push(`${config.host}:${config.port || 3389}`);
    }

    // 添加额外参数
    if (config.extraArgs) {
      args.push(...config.extraArgs);
    }

    const process = spawn(this.rdpClientPath!, args, {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    return process;
  }

  /**
   * macOS RDP 客户端
   */
  private async launchMacRdp(sessionId: string, config: RdpConfig): Promise<ChildProcess> {
    // 创建 .rdp 文件
    const rdpFile = this.createRdpFile(sessionId, config);
    
    // 使用 open 命令打开 .rdp 文件（会调用 Microsoft Remote Desktop）
    const process = spawn('open', [rdpFile], {
      detached: true,
      stdio: 'ignore',
    });

    process.unref();
    return process;
  }

  /**
   * 创建 .rdp 配置文件
   */
  private createRdpFile(sessionId: string, config: RdpConfig): string {
    const rdpContent = [
      `full address:s:${config.host}:${config.port || 3389}`,
      `username:s:${config.username}`,
      config.domain ? `domain:s:${config.domain}` : '',
      config.width && config.height ? `desktopwidth:i:${config.width}` : 'desktopwidth:i:1920',
      config.width && config.height ? `desktopheight:i:${config.height}` : 'desktopheight:i:1080',
      `session bpp:i:${config.colorDepth || 32}`,
      `compression:i:${config.enableCompression !== false ? 1 : 0}`,
      `bitmapcachepersistenable:i:${config.enableBitmapCaching !== false ? 1 : 0}`,
      `audiomode:i:${config.audioRedirection === false ? 2 : 0}`,
      `redirectprinters:i:${config.printerRedirection !== false ? 1 : 0}`,
      `redirectcomports:i:0`,
      `redirectsmartcards:i:0`,
      `redirectclipboard:i:${config.clipboardRedirection !== false ? 1 : 0}`,
      `redirectposdevices:i:0`,
      `displayconnectionbar:i:1`,
      `autoreconnection enabled:i:${config.autoReconnect !== false ? 1 : 0}`,
      `authentication level:i:0`,
      `prompt for credentials:i:1`,
      `negotiate security layer:i:${config.securityLayer === 'nla' || config.enableNLA ? 1 : 0}`,
      `remoteapplicationmode:i:0`,
      `alternate shell:s:${config.shell || ''}`,
      `shell working directory:s:${config.workingDirectory || ''}`,
      `gatewayhostname:s:`,
      `gatewayusagemethod:i:4`,
      `gatewaycredentialssource:i:4`,
      `gatewayprofileusagemethod:i:0`,
      `promptcredentialonce:i:0`,
      `gatewaybrokeringtype:i:0`,
      `use redirection server name:i:0`,
      `rdgiskdcproxy:i:0`,
      `kdcproxyname:s:`,
    ].filter(Boolean).join('\r\n');

    const rdpFile = path.join(this.tempDir, `${sessionId}.rdp`);
    fs.writeFileSync(rdpFile, rdpContent, 'utf-8');
    
    return rdpFile;
  }

  /**
   * 断开 RDP 连接
   */
  disconnect(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // 终止进程
    if (session.process) {
      session.process.kill();
    }

    session.status = 'disconnected';
    session.endTime = new Date().toISOString();
    this.sessions.delete(sessionId);

    // 清理临时文件
    this.cleanupSessionFiles(sessionId);

    return true;
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.process) {
        session.process.kill();
      }
      session.status = 'disconnected';
      session.endTime = new Date().toISOString();
      this.cleanupSessionFiles(sessionId);
    }
    this.sessions.clear();
  }

  /**
   * 获取会话状态
   */
  getSessionStatus(sessionId: string): RdpSessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const startTime = new Date(session.startTime).getTime();
    const now = Date.now();

    return {
      id: session.id,
      serverId: session.serverId,
      status: session.status,
      host: session.config.host,
      startTime: session.startTime,
      duration: Math.round((now - startTime) / 1000),
    };
  }

  /**
   * 获取所有会话状态
   */
  getAllSessions(): RdpSessionStatus[] {
    const sessions: RdpSessionStatus[] = [];
    
    for (const [id, session] of this.sessions) {
      const startTime = new Date(session.startTime).getTime();
      const now = Date.now();
      
      sessions.push({
        id: session.id,
        serverId: session.serverId,
        status: session.status,
        host: session.config.host,
        startTime: session.startTime,
        duration: Math.round((now - startTime) / 1000),
      });
    }
    
    return sessions;
  }

  /**
   * 清理会话临时文件
   */
  private cleanupSessionFiles(sessionId: string): void {
    try {
      const rdpFile = path.join(this.tempDir, `${sessionId}.rdp`);
      if (fs.existsSync(rdpFile)) {
        fs.unlinkSync(rdpFile);
      }
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 清理所有临时文件
   */
  cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
        fs.rmdirSync(this.tempDir);
      }
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 生成 RDP 连接 URL
   * 用于 Deep Link 或外部应用调用
   */
  generateRdpUrl(config: RdpConfig): string {
    const params = new URLSearchParams();
    params.set('hostname', config.host);
    params.set('port', String(config.port || 3389));
    params.set('username', config.username);
    
    if (config.domain) {
      params.set('domain', config.domain);
    }
    
    return `rdp://${params.toString()}`;
  }

  /**
   * 导出 RDP 配置文件
   */
  exportRdpFile(config: RdpConfig): string {
    const sessionId = 'export';
    return this.createRdpFile(sessionId, config);
  }
}
