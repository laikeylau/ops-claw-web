import React, { useState, useEffect, useCallback } from 'react';
import { toast } from './Toast';

/**
 * RDP 连接配置
 */
interface RdpConfig {
  width?: number;
  height?: number;
  colorDepth?: number;
  audioRedirection?: boolean;
  clipboardRedirection?: boolean;
  driveRedirection?: boolean;
  securityLayer?: 'rdp' | 'tls' | 'nla';
  enableNLA?: boolean;
  experienceLevel?: 'modem' | 'broadband' | 'lan' | 'auto';
}

/**
 * RDP 会话状态
 */
interface RdpSessionStatus {
  id: string;
  serverId: number;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  host: string;
  startTime: string;
  duration?: number;
}

/**
 * RDP 客户端信息
 */
interface RdpClientInfo {
  available: boolean;
  client: string | null;
  platform: string;
}

/**
 * RDP 视图组件属性
 */
interface RdpViewProps {
  serverId: number;
  serverName: string;
  serverHost: string;
  isConnected: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * RDP 视图组件
 */
export function RdpView({
  serverId,
  serverName,
  serverHost,
  isConnected,
  onConnect,
  onDisconnect,
}: RdpViewProps) {
  const [clientInfo, setClientInfo] = useState<RdpClientInfo | null>(null);
  const [session, setSession] = useState<RdpSessionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<RdpConfig>({
    width: 1920,
    height: 1080,
    colorDepth: 32,
    audioRedirection: true,
    clipboardRedirection: true,
    driveRedirection: false,
    securityLayer: 'nla',
    enableNLA: true,
    experienceLevel: 'auto',
  });

  // 检查 RDP 客户端可用性
  useEffect(() => {
    checkRdpAvailability();
  }, []);

  // 定期更新会话状态
  useEffect(() => {
    if (!session) return;

    const timer = setInterval(() => {
      updateSessionStatus();
    }, 5000);

    return () => clearInterval(timer);
  }, [session?.id]);

  const checkRdpAvailability = async () => {
    try {
      const info = await window.electronAPI.rdpIsAvailable();
      setClientInfo(info);
    } catch {
      setClientInfo({ available: false, client: null, platform: 'unknown' });
    }
  };

  const updateSessionStatus = async () => {
    if (!session) return;

    try {
      const status = await window.electronAPI.rdpSessionStatus(session.id);
      if (status) {
        setSession(status);
        
        if (status.status === 'disconnected' || status.status === 'error') {
          onDisconnect?.();
        }
      } else {
        setSession(null);
        onDisconnect?.();
      }
    } catch {
      // 会话可能已结束
    }
  };

  const handleConnect = useCallback(async () => {
    setConnecting(true);

    try {
      const result = await window.electronAPI.rdpConnect(serverId, config);

      if (result.success) {
        const status: RdpSessionStatus = {
          id: result.sessionId,
          serverId,
          status: 'connected',
          host: serverHost,
          startTime: new Date().toISOString(),
        };
        setSession(status);
        toast.success('RDP 连接已建立');
        onConnect?.();
      } else {
        toast.error(`RDP 连接失败: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`RDP 连接失败: ${error.message}`);
    } finally {
      setConnecting(false);
    }
  }, [serverId, serverHost, config, onConnect]);

  const handleDisconnect = useCallback(async () => {
    if (!session) return;

    try {
      await window.electronAPI.rdpDisconnect(session.id);
      setSession(null);
      toast.success('RDP 连接已断开');
      onDisconnect?.();
    } catch (error: any) {
      toast.error(`断开失败: ${error.message}`);
    }
  }, [session, onDisconnect]);

  const handleExportRdp = useCallback(async () => {
    try {
      const result = await window.electronAPI.rdpExportFile(serverId);
      if (result.success) {
        toast.success(`RDP 文件已导出: ${result.path}`);
      } else {
        toast.error(`导出失败: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`导出失败: ${error.message}`);
    }
  }, [serverId]);

  const handleOpenExternal = useCallback(async () => {
    try {
      await window.electronAPI.rdpOpenExternal(serverId);
    } catch (error: any) {
      toast.error(`打开失败: ${error.message}`);
    }
  }, [serverId]);

  // RDP 客户端不可用
  if (clientInfo && !clientInfo.available) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-8">
        <div className="text-6xl mb-6">🖥️</div>
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
          RDP 客户端不可用
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-400 text-center max-w-md space-y-3">
          <p>当前系统未检测到 RDP 客户端。</p>
          
          {clientInfo.platform === 'linux' && (
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-left">
              <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                📦 安装 xfreerdp：
              </p>
              <code className="block bg-blue-100 dark:bg-blue-800/50 rounded px-3 py-2 text-xs font-mono">
                # Ubuntu/Debian<br />
                sudo apt install freerdp2-x11<br /><br />
                # CentOS/RHEL<br />
                sudo yum install freerdp<br /><br />
                # Arch Linux<br />
                sudo pacman -S freerdp
              </code>
            </div>
          )}
          
          {clientInfo.platform === 'darwin' && (
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-left">
              <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                📦 安装 Microsoft Remote Desktop：
              </p>
              <p className="text-xs">
                从 Mac App Store 安装 Microsoft Remote Desktop 应用
              </p>
            </div>
          )}
          
          {clientInfo.platform === 'win32' && (
            <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 text-left">
              <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                ⚠️ 未找到 mstsc.exe
              </p>
              <p className="text-xs">
                Windows 远程桌面客户端应该已内置。请检查系统是否完整安装。
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-800">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🖥️</span>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
              {serverName}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {serverHost}:3389
            </p>
          </div>
          
          {session && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              session.status === 'connected' 
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : session.status === 'connecting'
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {session.status === 'connected' ? '已连接' : 
               session.status === 'connecting' ? '连接中...' : 
               session.status === 'error' ? '连接错误' : '已断开'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="RDP 设置"
          >
            ⚙️ 设置
          </button>
          
          <button
            onClick={handleExportRdp}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="导出 RDP 文件"
          >
            📄 导出
          </button>
          
          <button
            onClick={handleOpenExternal}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="使用系统 RDP 客户端打开"
          >
            🔗 外部打开
          </button>
          
          {!session || session.status === 'disconnected' || session.status === 'error' ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-500 disabled:bg-gray-400 rounded transition-colors"
            >
              {connecting ? '连接中...' : '连接'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded transition-colors"
            >
              断开
            </button>
          )}
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                分辨率
              </label>
              <select
                value={`${config.width}x${config.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  setConfig({ ...config, width: w, height: h });
                }}
                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              >
                <option value="1920x1080">1920 x 1080</option>
                <option value="1680x1050">1680 x 1050</option>
                <option value="1440x900">1440 x 900</option>
                <option value="1366x768">1366 x 768</option>
                <option value="1280x1024">1280 x 1024</option>
                <option value="1280x720">1280 x 720</option>
                <option value="1024x768">1024 x 768</option>
                <option value="800x600">800 x 600</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                颜色深度
              </label>
              <select
                value={config.colorDepth}
                onChange={(e) => setConfig({ ...config, colorDepth: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              >
                <option value="32">32 位</option>
                <option value="24">24 位</option>
                <option value="16">16 位</option>
                <option value="15">15 位</option>
                <option value="8">8 位</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                安全层
              </label>
              <select
                value={config.securityLayer}
                onChange={(e) => setConfig({ ...config, securityLayer: e.target.value as any })}
                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              >
                <option value="nla">NLA (推荐)</option>
                <option value="tls">TLS</option>
                <option value="rdp">标准 RDP</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                网络类型
              </label>
              <select
                value={config.experienceLevel}
                onChange={(e) => setConfig({ ...config, experienceLevel: e.target.value as any })}
                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              >
                <option value="auto">自动检测</option>
                <option value="lan">局域网</option>
                <option value="broadband">宽带</option>
                <option value="modem">调制解调器</option>
              </select>
            </div>
          </div>

          <div className="flex gap-4 mt-3">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={config.audioRedirection}
                onChange={(e) => setConfig({ ...config, audioRedirection: e.target.checked })}
                className="rounded"
              />
              音频重定向
            </label>
            
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={config.clipboardRedirection}
                onChange={(e) => setConfig({ ...config, clipboardRedirection: e.target.checked })}
                className="rounded"
              />
              剪贴板同步
            </label>
            
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={config.driveRedirection}
                onChange={(e) => setConfig({ ...config, driveRedirection: e.target.checked })}
                className="rounded"
              />
              驱动器映射
            </label>
          </div>
        </div>
      )}

      {/* RDP 显示区域 */}
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        {!session || session.status === 'disconnected' ? (
          <div className="text-center text-gray-400">
            <div className="text-8xl mb-6">🖥️</div>
            <h4 className="text-lg font-medium text-gray-300 mb-2">
              Windows 远程桌面
            </h4>
            <p className="text-sm text-gray-500 mb-6">
              点击"连接"按钮启动 RDP 会话
            </p>
            <div className="text-xs text-gray-600 space-y-1">
              <p>目标: {serverHost}:3389</p>
              <p>客户端: {clientInfo?.client || '未知'}</p>
            </div>
          </div>
        ) : session.status === 'connecting' ? (
          <div className="text-center text-gray-400">
            <div className="animate-spin text-6xl mb-4">⏳</div>
            <p className="text-sm">正在连接到 {serverHost}...</p>
          </div>
        ) : session.status === 'error' ? (
          <div className="text-center text-red-400">
            <div className="text-6xl mb-4">❌</div>
            <p className="text-sm mb-2">连接失败</p>
            <p className="text-xs text-red-500">请检查服务器配置和网络连接</p>
            <button
              onClick={handleConnect}
              className="mt-4 px-4 py-2 text-xs bg-red-600 hover:bg-red-500 text-white rounded"
            >
              重试连接
            </button>
          </div>
        ) : (
          <div className="text-center text-green-400">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-sm mb-1">已连接到 {serverHost}</p>
            <p className="text-xs text-gray-500">
              RDP 会话已在外部窗口打开
            </p>
            {session.duration !== undefined && (
              <p className="text-xs text-gray-600 mt-2">
                连接时长: {Math.floor(session.duration / 60)}分{session.duration % 60}秒
              </p>
            )}
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span>🖥️ RDP</span>
          <span>端口: 3389</span>
          {config.width && config.height && (
            <span>分辨率: {config.width}x{config.height}</span>
          )}
          <span>颜色: {config.colorDepth}位</span>
        </div>
        <div>
          {clientInfo?.client && <span>客户端: {clientInfo.client}</span>}
        </div>
      </div>
    </div>
  );
}
