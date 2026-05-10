let safeStorage: any = null;
let app: any = null;

try {
  const electron = require('electron');
  safeStorage = electron.safeStorage;
  app = electron.app;
} catch {
  // 非 Electron 环境（如 Web 服务器模式），使用 fallback
}

import fs from 'fs';
import path from 'path';
import { logError, logWarn, serializeError } from './logger';

/**
 * CredentialManager - 安全的密码存储管理器
 * 
 * 使用 Electron safeStorage 进行加密，配合文件持久化存储。
 * 
 * 加密机制：
 * - Windows: DPAPI (Data Protection API)
 * - macOS: Keychain Services
 * - Linux: Secret Service API (libsecret) 或 fallback 提示
 * 
 * 存储格式 (credentials.json):
 * {
 *   "server_1": "base64EncodedEncryptedBuffer",
 *   "server_2": "base64EncodedEncryptedBuffer"
 * }
 */

interface CredentialStore {
  [serverId: string]: string; // Base64 encoded encrypted buffer
}

export class CredentialManager {
  private static credentialsPath: string;
  private static credentials: CredentialStore;
  private static initialized = false;

  /**
   * 初始化凭证存储
   * 在 app ready 后调用
   */
  private static initialize(): void {
    if (this.initialized) return;

    if (app) {
      // Electron 环境
      const userDataPath = app.getPath('userData');
      this.credentialsPath = path.join(userDataPath, 'credentials.json');
    } else {
      // Web 服务器模式：使用当前目录下的 data 文件夹
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.credentialsPath = path.join(dataDir, 'credentials.json');
    }
    this.credentials = this.loadCredentials();
    this.initialized = true;
  }

  /**
   * 从文件加载凭证数据
   */
  private static loadCredentials(): CredentialStore {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      logError('credential-manager', '加载凭证失败', serializeError(e));
    }
    return {};
  }

  /**
   * 保存凭证数据到文件
   */
  private static saveCredentials(): void {
    try {
      fs.writeFileSync(
        this.credentialsPath,
        JSON.stringify(this.credentials, null, 2),
        'utf-8'
      );
    } catch (e) {
      logError('credential-manager', '保存凭证失败', serializeError(e));
      throw new Error('无法保存凭证数据');
    }
  }

  /**
   * 检查加密是否可用
   * Linux 环境可能需要安装 libsecret
   */
  static isEncryptionAvailable(): boolean {
    if (!safeStorage) return false;
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * 获取加密状态信息（用于 UI 显示）
   */
  static getEncryptionStatus(): {
    available: boolean;
    platform: string;
    warning?: string;
  } {
    const available = this.isEncryptionAvailable();
    const platform = process.platform;

    let warning: string | undefined;
    if (!available) {
      if (platform === 'linux') {
        warning = 'Linux 需要安装 libsecret 或 gnome-keyring 才能加密存储密码。' +
          '请运行: sudo apt-get install libsecret-1-dev';
      } else {
        warning = '当前系统不支持安全密码存储，密码将无法加密保存。';
      }
    }

    return { available, platform, warning };
  }

  /**
   * 保存密码
   * @param serverId 服务器标识 (如 "server_1")
   * @param password 明文密码
   */
  static async savePassword(serverId: string, password: string): Promise<void> {
    this.initialize();

    if (!password) {
      await this.deletePassword(serverId);
      return;
    }

    if (this.isEncryptionAvailable() && safeStorage) {
      try {
        const encryptedBuffer = safeStorage.encryptString(password);
        this.credentials[serverId] = encryptedBuffer.toString('base64');
        this.saveCredentials();
        return;
      } catch (e) {
        logError('credential-manager', '加密密码失败，回退到明文存储', serializeError(e));
      }
    }

    // Fallback: 明文存储（Web 服务器模式）
    logWarn('credential-manager', '使用明文存储密码（建议配置系统级磁盘加密）');
    this.credentials[serverId] = `PLAINTEXT:${password}`;
    this.saveCredentials();
  }

  /**
   * 获取密码
   * @param serverId 服务器标识
   * @returns 明文密码或 null
   */
  static async getPassword(serverId: string): Promise<string | null> {
    this.initialize();

    const stored = this.credentials[serverId];
    if (!stored) return null;

    // 检查是否是明文 fallback
    if (stored.startsWith('PLAINTEXT:')) {
      logWarn('credential-manager', '正在读取未加密密码');
      return stored.substring('PLAINTEXT:'.length);
    }

    if (!this.isEncryptionAvailable()) {
      logError('credential-manager', '系统不支持解密已保存凭证');
      return null;
    }

    try {
      // 从 Base64 解码为 Buffer
      const encryptedBuffer = Buffer.from(stored, 'base64');
      // 使用 safeStorage 解密
      const password = safeStorage.decryptString(encryptedBuffer);
      return password;
    } catch (e) {
      logError('credential-manager', '解密密码失败', serializeError(e));
      // 解密失败可能是因为换了机器或加密密钥变化
      // 应该提示用户重新输入密码
      return null;
    }
  }

  /**
   * 删除密码
   * @param serverId 服务器标识
   */
  static async deletePassword(serverId: string): Promise<void> {
    this.initialize();

    if (this.credentials[serverId]) {
      delete this.credentials[serverId];
      this.saveCredentials();
    }
  }

  /**
   * 检查是否存在该服务器的密码
   */
  static hasPassword(serverId: string): boolean {
    this.initialize();
    return !!this.credentials[serverId];
  }

  /**
   * 清除所有凭证 (用于测试或重置)
   */
  static clearAll(): void {
    this.initialize();
    this.credentials = {};
    this.saveCredentials();
  }
}