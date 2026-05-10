import React, { useEffect, useState, useRef, useCallback } from 'react';

interface MonitorData {
  success: boolean;
  cpu: { usage: string; cores: string };
  memory: { total: number; used: number; available: number; usage: string; totalMB: string };
  disk: { total: string; used: string; available: string; usage: string };
  network: { rxBytes: number; txBytes: number; interface: string };
  load: { '1m': string; '5m': string; '15m': string };
  system: { hostname: string; os: string; kernel: string; uptime: string };
  processes: { user: string; pid: string; cpu: string; mem: string; vsz: string; rss: string; stat: string; command: string }[];
  docker: { available: boolean; containers: { id: string; name: string; image: string; status: string; ports: string }[] };
}

interface GeoData {
  success: boolean;
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  timezone?: string;
}

interface Props {
  connectionId: string | undefined;
  visible: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(c => 0x1f1e6 - 65 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function ProgressRing({ value, size = 80, strokeWidth = 6, color }: {
  value: number; size?: number; strokeWidth?: number; color: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="#313244" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  );
}

function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  const numValue = parseFloat(value) || 0;
  return (
    <div className="bg-[#313244] rounded-xl p-4 flex flex-col items-center gap-2 relative overflow-hidden">
      <div className="relative flex items-center justify-center">
        <ProgressRing value={numValue} color={color} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold" style={{ color }}>{value}%</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-[#6c7086]">{label}</div>
        {sub && <div className="text-xs text-[#a6adc8] mt-0.5">{sub}</div>}
      </div>
      <div className="absolute top-2 right-2 text-sm opacity-40">{icon}</div>
    </div>
  );
}

export function ServerMonitor({ connectionId, visible, onClose }: Props) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [prevNet, setPrevNet] = useState<{ rx: number; tx: number; time: number } | null>(null);
  const [netSpeed, setNetSpeed] = useState<{ rx: string; tx: string }>({ rx: '0 B/s', tx: '0 B/s' });
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const geoFetched = useRef(false);

  const fetchMonitor = useCallback(async () => {
    if (!connectionId || !window.electronAPI?.sshMonitor) return;
    try {
      const result = await window.electronAPI.sshMonitor(connectionId);
      if (!result.success) {
        setError(result.error || '获取监控数据失败');
        return;
      }
      setError(null);
      setData(result);

      // 计算网络速率
      const now = Date.now();
      if (prevNet && result.network) {
        const dt = (now - prevNet.time) / 1000;
        if (dt > 0) {
          const rxRate = Math.max(0, (result.network.rxBytes - prevNet.rx) / dt);
          const txRate = Math.max(0, (result.network.txBytes - prevNet.tx) / dt);
          setNetSpeed({ rx: formatBytes(rxRate) + '/s', tx: formatBytes(txRate) + '/s' });
        }
      }
      if (result.network) {
        setPrevNet({ rx: result.network.rxBytes, tx: result.network.txBytes, time: now });
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [connectionId, prevNet]);

  const fetchGeo = useCallback(async () => {
    if (!connectionId || !window.electronAPI?.sshGeoip || geoFetched.current) return;
    geoFetched.current = true;
    try {
      const result = await window.electronAPI.sshGeoip(connectionId);
      if (result.success) setGeo(result);
    } catch { /* ignore */ }
  }, [connectionId]);

  useEffect(() => {
    if (!visible || !connectionId) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    geoFetched.current = false;
    fetchMonitor();
    fetchGeo();
    intervalRef.current = setInterval(fetchMonitor, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, connectionId, fetchMonitor, fetchGeo]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#1e1e2e] rounded-2xl shadow-2xl w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto border border-[#45475a]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#45475a] sticky top-0 bg-[#1e1e2e] z-10">
          <div className="flex items-center gap-3">
            <span className="text-xl">📊</span>
            <div>
              <h2 className="text-base font-semibold text-[#cdd6f4]">
                服务器监控
              </h2>
              {data?.system && (
                <p className="text-xs text-[#6c7086]">{data.system.hostname}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {geo?.country && (
              <span className="text-xs text-[#a6adc8] bg-[#313244] px-2.5 py-1 rounded-full">
                {getCountryFlag(geo.country)} {geo.city || geo.region || geo.country}
              </span>
            )}
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#313244] hover:bg-[#45475a] text-[#cdd6f4] flex items-center justify-center transition-colors">
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-[#f38ba8]/10 border border-[#f38ba8]/30 rounded-lg text-[#f38ba8] text-sm">
            ⚠️ {error}
          </div>
        )}

        {data && (
          <div className="p-6 space-y-6">
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="CPU"
                value={data.cpu.usage}
                sub={`${data.cpu.cores} 核`}
                color="#89b4fa"
                icon="🖥️"
              />
              <MetricCard
                label="内存"
                value={data.memory.usage}
                sub={`${data.memory.used}/${data.memory.total} MB`}
                color="#a6e3a1"
                icon="🧠"
              />
              <MetricCard
                label="磁盘"
                value={data.disk.usage.replace('%', '')}
                sub={`${data.disk.used}/${data.disk.total}`}
                color="#f9e2af"
                icon="💾"
              />
              <div className="bg-[#313244] rounded-xl p-4 flex flex-col items-center justify-center gap-2">
                <div className="text-2xl">⚡</div>
                <div className="text-center">
                  <div className="text-xs text-[#6c7086]">负载</div>
                  <div className="text-sm font-mono text-[#cdd6f4]">
                    {data.load['1m']} / {data.load['5m']} / {data.load['15m']}
                  </div>
                </div>
              </div>
            </div>

            {/* 网络流量 */}
            <div className="bg-[#313244] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span>🌐</span>
                <span className="text-sm font-medium text-[#cdd6f4]">网络流量</span>
                {data.network.interface && (
                  <span className="text-xs text-[#6c7086]">({data.network.interface})</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#89b4fa]/20 flex items-center justify-center text-sm">↓</div>
                  <div>
                    <div className="text-xs text-[#6c7086]">下载</div>
                    <div className="text-sm font-mono text-[#89b4fa]">{formatBytes(data.network.rxBytes)}</div>
                    <div className="text-xs text-[#89b4fa]/70">{netSpeed.rx}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#a6e3a1]/20 flex items-center justify-center text-sm">↑</div>
                  <div>
                    <div className="text-xs text-[#6c7086]">上传</div>
                    <div className="text-sm font-mono text-[#a6e3a1]">{formatBytes(data.network.txBytes)}</div>
                    <div className="text-xs text-[#a6e3a1]/70">{netSpeed.tx}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 系统信息 + 地理位置 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 系统信息 */}
              <div className="bg-[#313244] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span>🖥️</span>
                  <span className="text-sm font-medium text-[#cdd6f4]">系统信息</span>
                </div>
                <div className="space-y-2 text-sm">
                  <InfoRow label="主机名" value={data.system.hostname} />
                  <InfoRow label="操作系统" value={data.system.os} />
                  <InfoRow label="内核" value={data.system.kernel} />
                  <InfoRow label="CPU 核心" value={data.cpu.cores} />
                  <InfoRow label="总内存" value={`${data.memory.totalMB} MB`} />
                  <InfoRow label="运行时间" value={data.system.uptime} />
                </div>
              </div>

              {/* 地理位置 */}
              <div className="bg-[#313244] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span>🌍</span>
                  <span className="text-sm font-medium text-[#cdd6f4]">地理位置</span>
                </div>
                {geo?.success ? (
                  <div className="space-y-2 text-sm">
                    <InfoRow label="IP 地址" value={geo.ip || 'N/A'} />
                    <InfoRow label="国家" value={`${getCountryFlag(geo.country || '')} ${geo.country || 'N/A'}`} />
                    <InfoRow label="城市" value={geo.city || 'N/A'} />
                    <InfoRow label="地区" value={geo.region || 'N/A'} />
                    <InfoRow label="运营商" value={geo.org || 'N/A'} />
                    <InfoRow label="时区" value={geo.timezone || 'N/A'} />
                    {geo.loc && (
                      <InfoRow label="坐标" value={
                        <a href={`https://www.google.com/maps?q=${geo.loc}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[#89b4fa] hover:underline">{geo.loc}</a> as any
                      } />
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-[#6c7086]">
                    {geo === null ? '加载中...' : '无法获取地理位置信息'}
                  </div>
                )}
              </div>
            </div>

            {/* 磁盘详情 */}
            <div className="bg-[#313244] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span>💾</span>
                <span className="text-sm font-medium text-[#cdd6f4]">磁盘使用</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-[#a6adc8]">
                  <span>已用 {data.disk.used}</span>
                  <span>可用 {data.disk.available}</span>
                  <span>总计 {data.disk.total}</span>
                </div>
                <div className="w-full h-3 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-600"
                    style={{
                      width: data.disk.usage,
                      background: parseFloat(data.disk.usage) > 90 ? '#f38ba8'
                        : parseFloat(data.disk.usage) > 70 ? '#f9e2af' : '#a6e3a1',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 进程列表 */}
            {data.processes && data.processes.length > 0 && (
              <div className="bg-[#313244] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span>⚙️</span>
                  <span className="text-sm font-medium text-[#cdd6f4]">进程列表</span>
                  <span className="text-xs text-[#6c7086]">（按 CPU 排序）</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[#6c7086] border-b border-[#45475a]">
                        <th className="text-left py-1.5 pr-3">用户</th>
                        <th className="text-right py-1.5 px-2">PID</th>
                        <th className="text-right py-1.5 px-2">CPU%</th>
                        <th className="text-right py-1.5 px-2">内存%</th>
                        <th className="text-right py-1.5 px-2">RSS</th>
                        <th className="text-left py-1.5 pl-3">命令</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.processes.map((p, i) => (
                        <tr key={p.pid + '-' + i} className="border-b border-[#45475a]/30 hover:bg-[#45475a]/20">
                          <td className="py-1.5 pr-3 text-[#a6adc8]">{p.user}</td>
                          <td className="py-1.5 px-2 text-right text-[#a6adc8] font-mono">{p.pid}</td>
                          <td className={`py-1.5 px-2 text-right font-mono ${parseFloat(p.cpu) > 50 ? 'text-[#f38ba8]' : parseFloat(p.cpu) > 20 ? 'text-[#f9e2af]' : 'text-[#a6e3a1]'}`}>
                            {p.cpu}%
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#89b4fa]">{p.mem}%</td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#a6adc8]">{p.rss}</td>
                          <td className="py-1.5 pl-3 text-[#cdd6f4] truncate max-w-xs" title={p.command}>{p.command}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Docker 容器 */}
            {data.docker.available && (
              <div className="bg-[#313244] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span>🐳</span>
                  <span className="text-sm font-medium text-[#cdd6f4]">Docker 容器</span>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-[#89b4fa]/20 text-[#89b4fa]">{data.docker.containers.length} 个运行中</span>
                </div>
                {data.docker.containers.length === 0 ? (
                  <div className="text-sm text-[#6c7086] py-2">没有正在运行的容器</div>
                ) : (
                  <div className="space-y-2">
                    {data.docker.containers.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#1e1e2e] hover:bg-[#181825] transition-colors">
                        <div className="w-2 h-2 rounded-full bg-[#a6e3a1] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[#cdd6f4]">{c.name}</span>
                            <span className="text-xs text-[#6c7086] font-mono">{c.id?.substring(0, 12)}</span>
                          </div>
                          <div className="text-xs text-[#a6adc8] mt-0.5">{c.image}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-[#a6e3a1]">{c.status}</div>
                          {c.ports && <div className="text-xs text-[#6c7086] font-mono mt-0.5">{c.ports}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-[#6c7086]">
              <div className="w-5 h-5 border-2 border-[#89b4fa] border-t-transparent rounded-full animate-spin" />
              <span>正在获取服务器信息...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[#6c7086]">{label}</span>
      <span className="text-[#cdd6f4] font-mono text-xs truncate ml-4">{value}</span>
    </div>
  );
}
