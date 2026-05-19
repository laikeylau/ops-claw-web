let _app: any = null;
try {
  _app = require('electron').app;
} catch {
  // 非 Electron 环境
}

import fs from 'fs';
import path from 'path';
import { CredentialManager } from './credential-manager';
import { logError, serializeError } from './logger';

export interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  type: 'linux' | 'windows';
  connectionType?: 'ssh' | 'rdp';  // 连接类型：SSH 或 RDP
  rdpConfig?: {
    width?: number;
    height?: number;
    colorDepth?: number;
    audioRedirection?: boolean;
    clipboardRedirection?: boolean;
    driveRedirection?: boolean;
    securityLayer?: 'rdp' | 'tls' | 'nla';
  };
}

export interface AIConfigItem {
  id: number;
  name: string;
  endpoint: string;
  apiKey?: string;  // 存储时不保存，用 CredentialManager
  model: string;
  isDefault?: boolean;
  createdAt?: string;
}

/** AI 配置类型别名（供 Agent/TaskDecomposer 使用） */
export type AIConfig = AIConfigItem;

/** 聊天消息 */
export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  type?: string;
  meta?: Record<string, unknown>;
}

/** 命令历史记录 */
export interface CommandHistory {
  command: string;
  output: string;
  exitCode: number;
  timestamp: string;
  directory?: string;
}

/** 简单命令模式 - 不需要 AI 分析的命令 */
const SIMPLE_COMMAND_PATTERNS: RegExp[] = [
  // 查看类
  /^ls(\s|$)/, /^ll(\s|$)/, /^la(\s|$)/, /^pwd$/, /^whoami$/, /^hostname$/, /^date$/, /^uptime$/,
  /^cat\s+/, /^head\s+/, /^tail\s+/, /^wc\s+/, /^file\s+/, /^stat\s+/,
  /^echo\s+/, /^printf\s+/, /^true$/, /^false$/, /^id$/, /^uname(\s|$)/,
  // Docker 查看
  /^docker\s+ps(\s|$)/, /^docker\s+images(\s|$)/, /^docker\s+version$/, /^docker\s+info$/,
  /^docker\s+logs\s+/, /^docker\s+inspect\s+/, /^docker\s+stats(\s|$)/,
  // 系统查看
  /^top\s*-b/, /^htop$/, /^free(\s|$)/, /^df(\s|$)/, /^du\s+/, /^mount$/, /^env$/, /^set$/,
  /^ps\s+/, /^pgrep\s+/, /^lsof(\s|$)/, /^netstat\s+/, /^ss\s+/, /^ip\s+addr/,
  // 网络查看
  /^ping\s+/, /^curl\s+/, /^wget\s+/, /^dig\s+/, /^nslookup\s+/, /^traceroute\s+/,
  // Git 查看
  /^git\s+status$/, /^git\s+log/, /^git\s+diff/, /^git\s+branch/, /^git\s+remote/,
  // 文件查找
  /^find\s+/, /^locate\s+/, /^which\s+/, /^whereis\s+/, /^type\s+/,
  /^grep\s+/, /^egrep\s+/, /^fgrep\s+/,
];

/**
 * 判断是否为简单/信息类命令（不需要 AI 分析结果）
 * 这类命令通常只是查看信息，成功执行即可，无需额外分析
 */
export function isSimpleCommand(command: string): boolean {
  const trimmed = command.trim();
  // 多命令组合不算简单
  if (trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';')) {
    return false;
  }
  // 复杂管道不算简单
  const pipeCount = (trimmed.match(/\|/g) || []).length;
  if (pipeCount > 1) {
    return false;
  }
  return SIMPLE_COMMAND_PATTERNS.some(pattern => pattern.test(trimmed));
}

/** 任务步骤 */
export interface TaskStep {
  timestamp: string;
  action: 'intent' | 'command' | 'result' | 'analysis';
  content: string;
  command?: string;
  result?: string;
}

/** 会话上下文 */
export interface SessionContext {
  currentDirectory?: string;
  hostname?: string;
  recentCommands: CommandHistory[];
  taskHistory: TaskStep[];
  environmentVars: Record<string, string>;
  taskGoal?: string;
  taskHistorySummary?: string;
  lastExitCode?: number;
}

interface AppData {
  servers: ServerConfig[];
  aiConfigs: AIConfigItem[];  // 多个 AI 配置
  activeAIConfigId: number;   // 当前激活的配置 ID
  messages: Record<string, ChatMessage[]>;
  contexts: Record<string, SessionContext>;
}

const AI_API_KEY_CREDENTIAL_PREFIX = 'ai_config_';

const DEFAULT_DATA: AppData = {
  servers: [],
  aiConfigs: [{
    id: 1,
    name: '默认配置',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    isDefault: true,
  }],
  activeAIConfigId: 1,
  messages: {},
  contexts: {}
};

export class DatabaseManager {
  private dataPath: string;
  private data: AppData;
  /** debounce 定时器：合并短时间内多次 saveData 为一次写入 */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** debounce 延迟（ms） */
  private readonly SAVE_DEBOUNCE_MS = 300;
  /** AI 配置缓存（避免每次都从 CredentialManager 读取） */
  private aiConfigCache: Map<number, { config: AIConfigItem; timestamp: number }> = new Map();
  private readonly CONFIG_CACHE_TTL = 60000; // 1 分钟缓存

  constructor() {
    if (_app) {
      const userDataPath = _app.getPath('userData');
      this.dataPath = path.join(userDataPath, 'ops-claw-data.json');
    } else {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.dataPath = path.join(dataDir, 'ops-claw-data.json');
    }
    this.data = this.loadData();
  }

  private loadData(): AppData {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const loaded = JSON.parse(raw);
        return { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), ...loaded };
      }
    } catch (e) {
      logError('database', '加载数据失败', serializeError(e));
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  private saveData(): void {
    // Debounce: 合并 300ms 内的多次写入
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        // 写入前备份（防止崩溃损坏）
        const backupPath = this.dataPath + '.bak';
        if (fs.existsSync(this.dataPath)) {
          try {
            fs.copyFileSync(this.dataPath, backupPath);
          } catch { /* 备份失败不阻塞主流程 */ }
        }
        fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (e) {
        logError('database', '保存数据失败', serializeError(e));
      }
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即写入（应用退出时调用，确保数据不丢）
   */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logError('database', '保存数据失败', serializeError(e));
    }
  }

  getServers(): ServerConfig[] {
    return this.data.servers.map(s => ({ ...s, password: undefined })); // 不返回密码
  }

  getServer(id: number): ServerConfig | undefined {
    return this.data.servers.find(s => s.id === id);
  }

  async addServer(config: Omit<ServerConfig, 'id'>): Promise<number> {
    const newId = this.data.servers.length > 0 ? Math.max(...this.data.servers.map(s => s.id)) + 1 : 1;
    const { password, ...safeConfig } = config;
    const newServer: ServerConfig = { ...safeConfig, id: newId };

    this.data.servers.push(newServer);

    if (password) {
      await CredentialManager.savePassword(`server_${newId}`, password);
    }

    this.saveData();
    return newId;
  }

  async getServerWithPassword(id: number): Promise<ServerConfig | undefined> {
    const server = this.data.servers.find(s => s.id === id);
    if (server) {
      server.password = await CredentialManager.getPassword(`server_${id}`) || undefined;
    }
    return server;
  }

  async deleteServer(id: number): Promise<void> {
    this.data.servers = this.data.servers.filter(s => s.id !== id);
    // 删除该服务器关联的消息（使用 toString 作为 key）
    delete this.data.messages[String(id)];
    await CredentialManager.deletePassword(`server_${id}`);
    this.saveData();
  }

  async updateServer(id: number, config: Omit<ServerConfig, 'id'>): Promise<void> {
    const idx = this.data.servers.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Server not found');
    const { password, ...safeConfig } = config;
    this.data.servers[idx] = { ...safeConfig, id };
    if (password) {
      await CredentialManager.savePassword(`server_${id}`, password);
    }
    this.saveData();
  }

  // ===== AI 配置管理（增删改查）=====

  /**
   * 获取所有 AI 配置列表
   */
  getAIConfigs(): AIConfigItem[] {
    return this.data.aiConfigs.map(c => ({ ...c, apiKey: undefined }));
  }

  /**
   * 获取单个 AI 配置（带 apiKey，使用缓存优化）
   */
  async getAIConfig(id: number): Promise<AIConfigItem | undefined> {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) return undefined;

    // 检查缓存
    const cached = this.aiConfigCache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CONFIG_CACHE_TTL) {
      return cached.config;
    }

    // 从 CredentialManager 获取 apiKey
    const apiKey = await CredentialManager.getPassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`) || '';
    const result = { ...config, apiKey };

    // 更新缓存
    this.aiConfigCache.set(id, { config: result, timestamp: Date.now() });

    return result;
  }

  /**
   * 获取当前激活的 AI 配置
   */
  async getActiveAIConfig(): Promise<AIConfigItem | undefined> {
    const activeId = this.data.activeAIConfigId;
    return this.getAIConfig(activeId);
  }

  /**
   * 添加 AI 配置
   */
  async addAIConfig(config: Omit<AIConfigItem, 'id'>): Promise<number> {
    const newId = this.data.aiConfigs.length > 0
      ? Math.max(...this.data.aiConfigs.map(c => c.id)) + 1
      : 1;

    const newConfig: AIConfigItem = {
      id: newId,
      name: config.name,
      endpoint: config.endpoint,
      model: config.model,
      isDefault: config.isDefault || false,
      createdAt: new Date().toISOString(),
    };

    this.data.aiConfigs.push(newConfig);

    // 保存 apiKey 到 CredentialManager
    if (config.apiKey) {
      await CredentialManager.savePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${newId}`, config.apiKey);
    }

    // 如果是第一个配置，自动设为激活
    if (this.data.aiConfigs.length === 1) {
      this.data.activeAIConfigId = newId;
    }

    this.saveData();
    return newId;
  }

  /**
   * 更新 AI 配置
   */
  async updateAIConfig(id: number, config: Omit<AIConfigItem, 'id'>): Promise<void> {
    const idx = this.data.aiConfigs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('AI config not found');

    const { apiKey, ...safeConfig } = config;
    this.data.aiConfigs[idx] = {
      ...safeConfig,
      id,
      createdAt: this.data.aiConfigs[idx].createdAt || new Date().toISOString(),
    };

    if (apiKey) {
      await CredentialManager.savePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`, apiKey);
    }

    // 清除缓存
    this.aiConfigCache.delete(id);

    this.saveData();
  }

  /**
   * 删除 AI 配置
   */
  async deleteAIConfig(id: number): Promise<void> {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) return;

    // 不允许删除默认配置（至少保留一个）
    if (config.isDefault && this.data.aiConfigs.length === 1) {
      throw new Error('不能删除唯一的配置');
    }

    this.data.aiConfigs = this.data.aiConfigs.filter(c => c.id !== id);
    await CredentialManager.deletePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`);

    // 清除缓存
    this.aiConfigCache.delete(id);

    // 如果删除的是当前激活的配置，切换到第一个
    if (this.data.activeAIConfigId === id && this.data.aiConfigs.length > 0) {
      this.data.activeAIConfigId = this.data.aiConfigs[0].id;
    }

    this.saveData();
  }

  /**
   * 设置激活的 AI 配置
   */
  setActiveAIConfig(id: number): void {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) throw new Error('AI config not found');
    this.data.activeAIConfigId = id;
    this.saveData();
  }

  /**
   * 获取当前激活配置的 ID
   */
  getActiveAIConfigId(): number {
    return this.data.activeAIConfigId;
  }

  getMessages(tabId: string): ChatMessage[] {
    return this.data.messages[tabId] || [];
  }

  saveMessage(tabId: string, message: ChatMessage): void {
    if (!this.data.messages[tabId]) {
      this.data.messages[tabId] = [];
    }
    this.data.messages[tabId].push(message);
    this.saveData();
  }

  deleteServerMessages(tabId: string): void {
    delete this.data.messages[tabId];
    this.saveData();
  }

  // 会话上下文管理
  getContext(tabId: string): SessionContext {
    return this.data.contexts[tabId] || {
      recentCommands: [],
      taskHistory: [],
      environmentVars: {}
    };
  }

  updateContext(tabId: string, updates: Partial<SessionContext>): void {
    const current = this.getContext(tabId);
    this.data.contexts[tabId] = { ...current, ...updates };
    this.saveData();
  }

  // 添加命令到历史（保留最近5条，减少 token 消耗）
  addCommandToHistory(tabId: string, command: CommandHistory): void {
    const context = this.getContext(tabId);
    const recentCommands = context.recentCommands || [];
    recentCommands.push(command);
    // 保留最近5条（原来10条，减少发送给 AI 的上下文大小）
    if (recentCommands.length > 5) {
      recentCommands.shift();
    }
    this.updateContext(tabId, { recentCommands });
  }

  // 添加任务步骤（保留最近10条，减少 token 消耗）
  addTaskStep(tabId: string, step: TaskStep): void {
    const context = this.getContext(tabId);
    const taskHistory = context.taskHistory || [];
    taskHistory.push(step);
    // 保留最近10条步骤（原来20条，减少上下文大小）
    if (taskHistory.length > 10) {
      taskHistory.shift();
    }
    this.updateContext(tabId, { taskHistory });
  }

  // 清除上下文（开始新任务）
  clearContext(tabId: string): void {
    delete this.data.contexts[tabId];
    this.saveData();
  }

  // 构建用于 AI 的历史摘要
  buildHistorySummary(tabId: string): string {
    const context = this.getContext(tabId);
    const parts: string[] = [];

    // 当前目录
    if (context.currentDirectory) {
      parts.push(`当前工作目录: ${context.currentDirectory}`);
    }

    // 主机名
    if (context.hostname) {
      parts.push(`主机名: ${context.hostname}`);
    }

    // 任务历史
    if (context.taskHistory && context.taskHistory.length > 0) {
      parts.push('\n最近的操作历史:');
      const recentSteps = context.taskHistory.slice(-5);
      for (const step of recentSteps) {
        if (step.action === 'intent') {
          parts.push(`- 用户意图: ${step.content}`);
        } else if (step.action === 'command') {
          parts.push(`- 执行命令: ${step.command || step.content}`);
        } else if (step.action === 'result') {
          parts.push(`- 结果: ${step.result || step.content}`);
        }
      }
    }

    // 最近命令历史
    if (context.recentCommands && context.recentCommands.length > 0) {
      parts.push('\n最近执行的命令:');
      const recentCommands = context.recentCommands.slice(-3);
      for (const cmd of recentCommands) {
        const status = cmd.exitCode === 0 ? '成功' : '失败';
        parts.push(`- ${cmd.command} (${status}, 目录: ${cmd.directory || '未知'})`);
      }
    }

    return parts.join('\n');
  }
}
