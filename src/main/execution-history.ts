import fs from 'fs';
import path from 'path';

/**
 * 执行历史管理器 - 保存命令执行记录、AI分析、支持收藏
 */

/** 执行历史记录 */
export interface ExecutionRecord {
  id: string;
  prompt: string;              // 用户原始输入
  command: string;             // 执行的命令
  output: string;              // 命令输出
  exitCode: number;            // 退出码
  analysis?: string;           // AI 分析结果
  suggestions?: string[];      // AI 建议
  nextCommand?: string;        // 推荐的下一步命令
  nextCommandReason?: string;  // 推荐原因
  serverId?: number;           // 服务器 ID
  serverName?: string;         // 服务器名称
  category?: string;           // 分类（自动识别或手动标记）
  tags?: string[];             // 标签
  isFavorite: boolean;         // 是否收藏
  createdAt: string;           // 创建时间
  updatedAt: string;           // 更新时间
}

/** 历史数据结构 */
interface ExecutionHistoryData {
  records: ExecutionRecord[];
  favorites: string[];         // 收藏记录 ID 列表
}

const MAX_RECORDS = 1000;
const MAX_FAVORITES = 200;

export class ExecutionHistoryManager {
  private dataPath: string;
  private data: ExecutionHistoryData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir?: string) {
    const baseDir = dataDir || (typeof process !== 'undefined' && process.env.APPDATA)
      ? path.join(process.env.APPDATA, 'ops-claw')
      : path.join(process.cwd(), 'data');

    this.dataPath = path.join(baseDir, 'execution-history.json');
    this.data = this.loadData();
  }

  private loadData(): ExecutionHistoryData {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // 加载失败使用默认数据
    }
    return { records: [], favorites: [] };
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch {
        // 保存失败不影响主流程
      }
    }, 1000);
  }

  /**
   * 添加执行记录
   */
  addRecord(record: Omit<ExecutionRecord, 'id' | 'isFavorite' | 'createdAt' | 'updatedAt'>): ExecutionRecord {
    const now = new Date().toISOString();
    const newRecord: ExecutionRecord = {
      ...record,
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
      category: record.category || this.categorizeCommand(record.command),
      tags: record.tags || this.extractTags(record.command),
    };

    this.data.records.unshift(newRecord);

    // 限制记录数量
    if (this.data.records.length > MAX_RECORDS) {
      // 保留收藏的记录，删除未收藏的旧记录
      const favorites = this.data.records.filter(r => r.isFavorite);
      const nonFavorites = this.data.records.filter(r => !r.isFavorite);
      this.data.records = [...favorites, ...nonFavorites.slice(0, MAX_RECORDS - favorites.length)];
    }

    this.scheduleSave();
    return newRecord;
  }

  /**
   * 获取历史记录列表
   */
  getRecords(options?: {
    category?: string;
    tag?: string;
    search?: string;
    favoritesOnly?: boolean;
    limit?: number;
    offset?: number;
  }): { records: ExecutionRecord[]; total: number } {
    let filtered = [...this.data.records];

    // 只看收藏
    if (options?.favoritesOnly) {
      filtered = filtered.filter(r => r.isFavorite);
    }

    // 按分类过滤
    if (options?.category) {
      filtered = filtered.filter(r => r.category === options.category);
    }

    // 按标签过滤
    if (options?.tag) {
      filtered = filtered.filter(r => r.tags?.includes(options.tag!));
    }

    // 搜索
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(r =>
        r.prompt.toLowerCase().includes(searchLower) ||
        r.command.toLowerCase().includes(searchLower) ||
        r.output.toLowerCase().includes(searchLower) ||
        r.analysis?.toLowerCase().includes(searchLower)
      );
    }

    const total = filtered.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    const records = filtered.slice(offset, offset + limit);

    return { records, total };
  }

  /**
   * 获取单条记录
   */
  getRecord(id: string): ExecutionRecord | undefined {
    return this.data.records.find(r => r.id === id);
  }

  /**
   * 切换收藏状态
   */
  toggleFavorite(id: string): boolean {
    const record = this.data.records.find(r => r.id === id);
    if (!record) return false;

    record.isFavorite = !record.isFavorite;
    record.updatedAt = new Date().toISOString();

    if (record.isFavorite) {
      if (!this.data.favorites.includes(id)) {
        this.data.favorites.push(id);
      }
    } else {
      this.data.favorites = this.data.favorites.filter(fId => fId !== id);
    }

    // 限制收藏数量
    if (this.data.favorites.length > MAX_FAVORITES) {
      const oldestFavId = this.data.favorites.shift();
      if (oldestFavId) {
        const oldestRecord = this.data.records.find(r => r.id === oldestFavId);
        if (oldestRecord) {
          oldestRecord.isFavorite = false;
        }
      }
    }

    this.scheduleSave();
    return record.isFavorite;
  }

  /**
   * 删除记录
   */
  deleteRecord(id: string): boolean {
    const index = this.data.records.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.data.records.splice(index, 1);
    this.data.favorites = this.data.favorites.filter(fId => fId !== id);
    this.scheduleSave();
    return true;
  }

  /**
   * 清空历史记录（保留收藏）
   */
  clearHistory(keepFavorites: boolean = true): void {
    if (keepFavorites) {
      this.data.records = this.data.records.filter(r => r.isFavorite);
    } else {
      this.data.records = [];
      this.data.favorites = [];
    }
    this.scheduleSave();
  }

  /**
   * 获取所有分类
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const record of this.data.records) {
      if (record.category) {
        categories.add(record.category);
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * 获取所有标签
   */
  getTags(): string[] {
    const tags = new Set<string>();
    for (const record of this.data.records) {
      if (record.tags) {
        for (const tag of record.tags) {
          tags.add(tag);
        }
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; favorites: number; categories: number; tags: number } {
    return {
      total: this.data.records.length,
      favorites: this.data.records.filter(r => r.isFavorite).length,
      categories: this.getCategories().length,
      tags: this.getTags().length,
    };
  }

  // ===== 私有方法 =====

  /**
   * 自动分类命令
   */
  private categorizeCommand(command: string): string {
    const cmd = command.toLowerCase().trim();

    if (cmd.startsWith('docker')) return 'docker';
    if (cmd.startsWith('git')) return 'git';
    if (cmd.startsWith('npm') || cmd.startsWith('yarn') || cmd.startsWith('pnpm')) return 'package';
    if (cmd.startsWith('systemctl') || cmd.startsWith('service')) return 'service';
    if (cmd.startsWith('apt') || cmd.startsWith('yum') || cmd.startsWith('dnf') || cmd.startsWith('apk')) return 'package';
    if (cmd.startsWith('mysql') || cmd.startsWith('psql') || cmd.startsWith('redis-cli') || cmd.startsWith('mongo')) return 'database';
    if (cmd.startsWith('curl') || cmd.startsWith('wget') || cmd.startsWith('ssh') || cmd.startsWith('scp')) return 'network';
    if (cmd.startsWith('ls') || cmd.startsWith('cd') || cmd.startsWith('pwd') || cmd.startsWith('find') || cmd.startsWith('grep')) return 'filesystem';
    if (cmd.startsWith('top') || cmd.startsWith('htop') || cmd.startsWith('ps') || cmd.startsWith('free') || cmd.startsWith('df')) return 'monitoring';
    if (cmd.startsWith('cat') || cmd.startsWith('tail') || cmd.startsWith('head') || cmd.startsWith('less')) return 'view';

    return 'other';
  }

  /**
   * 从命令中提取标签
   */
  private extractTags(command: string): string[] {
    const tags: string[] = [];
    const cmd = command.toLowerCase();

    // 常见标签
    if (cmd.includes('nginx') || cmd.includes('apache') || cmd.includes('httpd')) tags.push('web-server');
    if (cmd.includes('mysql') || cmd.includes('mariadb')) tags.push('mysql');
    if (cmd.includes('postgres') || cmd.includes('psql')) tags.push('postgresql');
    if (cmd.includes('redis')) tags.push('redis');
    if (cmd.includes('mongo')) tags.push('mongodb');
    if (cmd.includes('docker')) tags.push('docker');
    if (cmd.includes('k8s') || cmd.includes('kubectl')) tags.push('kubernetes');
    if (cmd.includes('log') || cmd.includes('journalctl')) tags.push('logging');
    if (cmd.includes('backup') || cmd.includes('dump')) tags.push('backup');
    if (cmd.includes('ssl') || cmd.includes('cert') || cmd.includes('https')) tags.push('ssl');
    if (cmd.includes('firewall') || cmd.includes('iptables') || cmd.includes('ufw')) tags.push('firewall');

    return tags.slice(0, 5); // 最多5个标签
  }
}
