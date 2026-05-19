// 动态导入 electron（Web 服务器模式下不可用）
let BrowserWindow: any = null;
let Notification: any = null;

try {
  const electron = require('electron');
  BrowserWindow = electron.BrowserWindow;
  Notification = electron.Notification;
} catch {
  // Web 服务器模式，electron 不可用
}

/**
 * 通知管理器
 * 
 * 功能：
 * 1. 系统通知
 * 2. 应用内通知
 * 3. 通知历史
 * 4. 通知配置
 */

export interface NotificationConfig {
  enabled: boolean;
  systemNotifications: boolean;  // 系统级通知
  inAppNotifications: boolean;   // 应用内通知
  sound: boolean;                // 通知声音
  quietHours: {
    enabled: boolean;
    start: string;  // HH:mm
    end: string;    // HH:mm
  };
}

export interface NotificationItem {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  source?: string;  // 来源：monitor, ssh, ai, etc.
  data?: any;       // 附加数据
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  systemNotifications: true,
  inAppNotifications: true,
  sound: true,
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
};

export class NotificationManager {
  private config: NotificationConfig;
  private notifications: NotificationItem[] = [];
  private mainWindow: any = null;  // 使用 any 类型避免 electron 依赖
  private readonly MAX_NOTIFICATIONS = 500;

  constructor(config?: Partial<NotificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: any | null): void {
    this.mainWindow = window;
  }

  /**
   * 发送通知
   */
  notify(
    type: NotificationItem['type'],
    title: string,
    message: string,
    source?: string,
    data?: any
  ): void {
    if (!this.config.enabled) {
      return;
    }

    // 检查静默时间
    if (this.isQuietHours()) {
      return;
    }

    const notification: NotificationItem = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      source,
      data,
    };

    // 添加到历史
    this.notifications.unshift(notification);
    if (this.notifications.length > this.MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, this.MAX_NOTIFICATIONS);
    }

    // 系统通知
    if (this.config.systemNotifications) {
      this.sendSystemNotification(notification);
    }

    // 应用内通知
    if (this.config.inAppNotifications) {
      this.sendInAppNotification(notification);
    }
  }

  /**
   * 发送系统通知
   */
  private sendSystemNotification(notification: NotificationItem): void {
    if (!Notification.isSupported()) {
      return;
    }

    const systemNotification = new Notification({
      title: notification.title,
      body: notification.message,
      silent: !this.config.sound,
    });

    systemNotification.on('click', () => {
      this.mainWindow?.show();
      this.mainWindow?.focus();
    });

    systemNotification.show();
  }

  /**
   * 发送应用内通知
   */
  private sendInAppNotification(notification: NotificationItem): void {
    this.mainWindow?.webContents.send('notification:new', notification);
  }

  /**
   * 检查是否在静默时间
   */
  private isQuietHours(): boolean {
    if (!this.config.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;

    const [startHour, startMinute] = this.config.quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = this.config.quietHours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    if (startTime <= endTime) {
      // 同一天内
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // 跨天
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  /**
   * 获取通知列表
   */
  getNotifications(options?: {
    type?: NotificationItem['type'];
    source?: string;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): NotificationItem[] {
    let filtered = [...this.notifications];

    if (options?.type) {
      filtered = filtered.filter(n => n.type === options.type);
    }

    if (options?.source) {
      filtered = filtered.filter(n => n.source === options.source);
    }

    if (options?.unreadOnly) {
      filtered = filtered.filter(n => !n.read);
    }

    const offset = options?.offset || 0;
    const limit = options?.limit || 50;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * 获取未读通知数
   */
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  /**
   * 标记通知为已读
   */
  markAsRead(notificationId: string): boolean {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  /**
   * 标记所有通知为已读
   */
  markAllAsRead(): void {
    for (const notification of this.notifications) {
      notification.read = true;
    }
  }

  /**
   * 删除通知
   */
  deleteNotification(notificationId: string): boolean {
    const index = this.notifications.findIndex(n => n.id === notificationId);
    if (index >= 0) {
      this.notifications.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 清除所有通知
   */
  clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * 获取配置
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ===== 便捷方法 =====

  /**
   * 发送信息通知
   */
  info(title: string, message: string, source?: string): void {
    this.notify('info', title, message, source);
  }

  /**
   * 发送成功通知
   */
  success(title: string, message: string, source?: string): void {
    this.notify('success', title, message, source);
  }

  /**
   * 发送警告通知
   */
  warning(title: string, message: string, source?: string): void {
    this.notify('warning', title, message, source);
  }

  /**
   * 发送错误通知
   */
  error(title: string, message: string, source?: string): void {
    this.notify('error', title, message, source);
  }

  /**
   * 监控告警通知
   */
  monitorAlert(
    serverId: number,
    hostname: string,
    type: string,
    level: 'warning' | 'critical',
    message: string
  ): void {
    const emoji = level === 'critical' ? '🚨' : '⚠️';
    const title = `${emoji} 服务器告警 - ${hostname}`;
    
    this.notify(
      level === 'critical' ? 'error' : 'warning',
      title,
      message,
      'monitor',
      { serverId, type, level }
    );
  }
}
