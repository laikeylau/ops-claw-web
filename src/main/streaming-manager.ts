// 动态导入 electron（Web 服务器模式下不可用）
let BrowserWindow: any = null;
try {
  BrowserWindow = require('electron').BrowserWindow;
} catch {
  // Web 服务器模式
}

/**
 * 流式响应管理器 - 支持 AI 响应的流式推送
 * 
 * 功能：
 * 1. 管理多个流式响应会话
 * 2. 支持增量推送 AI 响应
 * 3. 自动清理过期会话
 */

interface StreamingSession {
  id: string;
  tabId: string;
  messageId: string;
  startTime: number;
  buffer: string;
  isComplete: boolean;
}

const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 分钟超时

export class StreamingManager {
  private sessions: Map<string, StreamingSession> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 每分钟清理过期会话
    this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * 创建新的流式会话
   */
  createSession(tabId: string, messageId: string): string {
    const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    this.sessions.set(sessionId, {
      id: sessionId,
      tabId,
      messageId,
      startTime: Date.now(),
      buffer: '',
      isComplete: false,
    });

    return sessionId;
  }

  /**
   * 推送流式数据到前端
   */
  pushChunk(sessionId: string, chunk: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.isComplete) return;

    session.buffer += chunk;

    // 推送到前端
    this.mainWindow?.webContents.send('ai:stream:chunk', {
      sessionId,
      tabId: session.tabId,
      messageId: session.messageId,
      chunk,
      fullContent: session.buffer,
    });
  }

  /**
   * 完成流式会话
   */
  completeSession(sessionId: string, finalContent?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isComplete = true;
    if (finalContent) {
      session.buffer = finalContent;
    }

    // 推送完成事件
    this.mainWindow?.webContents.send('ai:stream:complete', {
      sessionId,
      tabId: session.tabId,
      messageId: session.messageId,
      fullContent: session.buffer,
    });

    // 延迟清理（保留一段时间供前端使用）
    setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 10000);
  }

  /**
   * 取消流式会话
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isComplete = true;

    this.mainWindow?.webContents.send('ai:stream:cancel', {
      sessionId,
      tabId: session.tabId,
      messageId: session.messageId,
    });

    this.sessions.delete(sessionId);
  }

  /**
   * 获取会话内容
   */
  getSessionContent(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.buffer || null;
  }

  /**
   * 检查会话是否完成
   */
  isSessionComplete(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isComplete ?? true;
  }

  /**
   * 清理过期会话
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.startTime > SESSION_TIMEOUT) {
        this.cancelSession(id);
      }
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
