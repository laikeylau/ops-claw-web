import fs from 'fs';
import path from 'path';

// 动态导入 electron（Web 服务器模式下不可用）
let app: any = null;
try {
  app = require('electron').app;
} catch {
  // Web 服务器模式
}

/**
 * 会话录制器
 * 
 * 功能：
 * 1. 录制 SSH 会话
 * 2. 录制命令执行
 * 3. 回放会话
 * 4. 导出会话记录
 */

export interface RecordingEntry {
  timestamp: string;
  type: 'input' | 'output' | 'command' | 'resize' | 'info';
  data: string;
  metadata?: Record<string, any>;
}

export interface RecordingSession {
  id: string;
  serverId: number;
  serverName: string;
  startTime: string;
  endTime?: string;
  entries: RecordingEntry[];
  metadata: {
    hostname?: string;
    os?: string;
    terminalSize?: { cols: number; rows: number };
    duration?: number;
  };
}

export interface RecordingConfig {
  enabled: boolean;
  autoRecord: boolean;
  maxDuration: number;  // 最大录制时长（分钟）
  maxSessions: number;  // 最大会话数
  recordingsDir: string;
}

const DEFAULT_CONFIG: RecordingConfig = {
  enabled: true,
  autoRecord: false,
  maxDuration: 60,  // 1 小时
  maxSessions: 100,
  recordingsDir: 'recordings',
};

export class SessionRecorder {
  private config: RecordingConfig;
  private recordingsDir: string;
  private activeRecordings: Map<string, RecordingSession> = new Map();

  constructor(config?: Partial<RecordingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Web 服务器模式下使用环境变量或默认路径
    const dataDir = app ? app.getPath('userData') : (process.env.DATA_DIR || '/app/data');
    this.recordingsDir = path.join(dataDir, this.config.recordingsDir);
    
    // 确保目录存在
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  /**
   * 开始录制会话
   */
  startRecording(sessionId: string, serverId: number, serverName: string): void {
    if (!this.config.enabled) {
      return;
    }

    const recording: RecordingSession = {
      id: sessionId,
      serverId,
      serverName,
      startTime: new Date().toISOString(),
      entries: [],
      metadata: {},
    };

    this.activeRecordings.set(sessionId, recording);
  }

  /**
   * 停止录制会话
   */
  stopRecording(sessionId: string): RecordingSession | null {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) {
      return null;
    }

    recording.endTime = new Date().toISOString();
    recording.metadata.duration = Math.round(
      (new Date(recording.endTime).getTime() - new Date(recording.startTime).getTime()) / 1000
    );

    // 保存到文件
    this.saveRecording(recording);
    
    // 从活动录制中移除
    this.activeRecordings.delete(sessionId);
    
    // 清理旧录制
    this.cleanupOldRecordings();

    return recording;
  }

  /**
   * 记录输入
   */
  recordInput(sessionId: string, data: string): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) return;

    // 检查时长限制
    const duration = (Date.now() - new Date(recording.startTime).getTime()) / 1000 / 60;
    if (duration >= this.config.maxDuration) {
      this.stopRecording(sessionId);
      return;
    }

    recording.entries.push({
      timestamp: new Date().toISOString(),
      type: 'input',
      data,
    });
  }

  /**
   * 记录输出
   */
  recordOutput(sessionId: string, data: string): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) return;

    recording.entries.push({
      timestamp: new Date().toISOString(),
      type: 'output',
      data,
    });
  }

  /**
   * 记录命令
   */
  recordCommand(sessionId: string, command: string, exitCode?: number): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) return;

    recording.entries.push({
      timestamp: new Date().toISOString(),
      type: 'command',
      data: command,
      metadata: exitCode !== undefined ? { exitCode } : undefined,
    });
  }

  /**
   * 记录终端大小变化
   */
  recordResize(sessionId: string, cols: number, rows: number): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) return;

    recording.entries.push({
      timestamp: new Date().toISOString(),
      type: 'resize',
      data: `${cols}x${rows}`,
      metadata: { cols, rows },
    });

    recording.metadata.terminalSize = { cols, rows };
  }

  /**
   * 记录信息
   */
  recordInfo(sessionId: string, info: string, metadata?: Record<string, any>): void {
    const recording = this.activeRecordings.get(sessionId);
    if (!recording) return;

    recording.entries.push({
      timestamp: new Date().toISOString(),
      type: 'info',
      data: info,
      metadata,
    });
  }

  /**
   * 保存录制到文件
   */
  private saveRecording(recording: RecordingSession): void {
    const filename = `${recording.id}_${recording.startTime.replace(/[:.]/g, '-')}.json`;
    const filepath = path.join(this.recordingsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(recording, null, 2), 'utf-8');
  }

  /**
   * 清理旧录制
   */
  private cleanupOldRecordings(): void {
    const recordings = this.getRecordings();
    
    while (recordings.length > this.config.maxSessions) {
      const oldest = recordings.pop();
      if (oldest) {
        const filepath = path.join(this.recordingsDir, `${oldest.id}.json`);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }
    }
  }

  /**
   * 获取录制列表
   */
  getRecordings(): RecordingSession[] {
    if (!fs.existsSync(this.recordingsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.recordingsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    const recordings: RecordingSession[] = [];

    for (const file of files) {
      try {
        const filepath = path.join(this.recordingsDir, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        recordings.push(JSON.parse(content));
      } catch {
        // 跳过损坏的文件
      }
    }

    return recordings;
  }

  /**
   * 获取单个录制
   */
  getRecording(recordingId: string): RecordingSession | null {
    const filepath = path.join(this.recordingsDir, `${recordingId}.json`);
    
    if (!fs.existsSync(filepath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 删除录制
   */
  deleteRecording(recordingId: string): boolean {
    const filepath = path.join(this.recordingsDir, `${recordingId}.json`);
    
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return true;
    }

    return false;
  }

  /**
   * 导出录制为文本
   */
  exportAsText(recordingId: string): string {
    const recording = this.getRecording(recordingId);
    if (!recording) {
      throw new Error('录制不存在');
    }

    let text = `会话录制: ${recording.serverName}\n`;
    text += `开始时间: ${recording.startTime}\n`;
    text += `结束时间: ${recording.endTime || '未结束'}\n`;
    text += `持续时间: ${recording.metadata.duration || 0} 秒\n`;
    text += `${'='.repeat(80)}\n\n`;

    for (const entry of recording.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      
      switch (entry.type) {
        case 'input':
          text += `[${time}] > ${entry.data}`;
          break;
        case 'output':
          text += entry.data;
          break;
        case 'command':
          text += `\n[${time}] $ ${entry.data}\n`;
          if (entry.metadata?.exitCode !== undefined) {
            text += `Exit code: ${entry.metadata.exitCode}\n`;
          }
          break;
        case 'info':
          text += `[${time}] *** ${entry.data} ***\n`;
          break;
        case 'resize':
          text += `[${time}] Terminal resized to ${entry.data}\n`;
          break;
      }
    }

    return text;
  }

  /**
   * 导出录制为 HTML
   */
  exportAsHTML(recordingId: string): string {
    const recording = this.getRecording(recordingId);
    if (!recording) {
      throw new Error('录制不存在');
    }

    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>会话录制 - ${recording.serverName}</title>
  <style>
    body { font-family: 'Courier New', monospace; background: #1e1e1e; color: #d4d4d4; padding: 20px; }
    .header { background: #2d2d2d; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .terminal { background: #0d0d0d; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
    .input { color: #4ec9b0; }
    .output { color: #d4d4d4; }
    .command { color: #569cd6; font-weight: bold; }
    .info { color: #ce9178; font-style: italic; }
    .timestamp { color: #6a9955; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🖥️ 会话录制</h1>
    <p>服务器: ${recording.serverName}</p>
    <p>时间: ${recording.startTime} - ${recording.endTime || '未结束'}</p>
    <p>持续: ${recording.metadata.duration || 0} 秒</p>
  </div>
  <div class="terminal">`;

    for (const entry of recording.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      
      switch (entry.type) {
        case 'input':
          html += `<span class="timestamp">[${time}]</span> <span class="input">&gt; ${this.escapeHtml(entry.data)}</span>`;
          break;
        case 'output':
          html += `<span class="output">${this.escapeHtml(entry.data)}</span>`;
          break;
        case 'command':
          html += `\n<span class="timestamp">[${time}]</span> <span class="command">$ ${this.escapeHtml(entry.data)}</span>\n`;
          break;
        case 'info':
          html += `<span class="timestamp">[${time}]</span> <span class="info">*** ${this.escapeHtml(entry.data)} ***</span>\n`;
          break;
      }
    }

    html += `</div></body></html>`;
    return html;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 获取录制配置
   */
  getConfig(): RecordingConfig {
    return { ...this.config };
  }

  /**
   * 更新录制配置
   */
  updateConfig(config: Partial<RecordingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查是否正在录制
   */
  isRecording(sessionId: string): boolean {
    return this.activeRecordings.has(sessionId);
  }

  /**
   * 获取活动录制列表
   */
  getActiveRecordings(): string[] {
    return Array.from(this.activeRecordings.keys());
  }
}
