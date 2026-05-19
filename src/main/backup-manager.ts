import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import archiver from 'archiver';
import extract from 'extract-zip';

/**
 * 备份管理器
 * 
 * 功能：
 * 1. 配置备份
 * 2. 数据备份
 * 3. 完整备份
 * 4. 自动备份
 * 5. 备份恢复
 */

export interface BackupMetadata {
  id: string;
  timestamp: string;
  type: 'config' | 'data' | 'full';
  size: number;
  description?: string;
  version: string;
}

export interface BackupConfig {
  enabled: boolean;
  autoBackup: boolean;
  interval: number;          // 自动备份间隔（小时）
  maxBackups: number;        // 最大备份数量
  backupDir: string;         // 备份目录
  includeChatHistory: boolean;
  includeCredentials: boolean;
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: true,
  autoBackup: true,
  interval: 24,  // 每天
  maxBackups: 10,
  backupDir: 'backups',
  includeChatHistory: true,
  includeCredentials: false,  // 默认不包含敏感信息
};

export class BackupManager {
  private config: BackupConfig;
  private backupDir: string;
  private dataDir: string;
  private autoBackupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<BackupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 获取数据目录
    this.dataDir = app.getPath('userData');
    this.backupDir = path.join(this.dataDir, this.config.backupDir);
    
    // 确保备份目录存在
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 开始自动备份
   */
  startAutoBackup(): void {
    if (this.autoBackupTimer) {
      return;
    }

    this.autoBackupTimer = setInterval(() => {
      this.createBackup('full');
    }, this.config.interval * 60 * 60 * 1000);
  }

  /**
   * 停止自动备份
   */
  stopAutoBackup(): void {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
  }

  /**
   * 创建备份
   */
  async createBackup(
    type: BackupMetadata['type'] = 'full',
    description?: string
  ): Promise<BackupMetadata> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup_${timestamp}`;
    const backupFile = path.join(this.backupDir, `${backupId}.zip`);

    // 创建备份元数据
    const metadata: BackupMetadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type,
      size: 0,
      description,
      version: app.getVersion(),
    };

    // 创建 ZIP 归档
    const output = fs.createWriteStream(backupFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        metadata.size = archive.pointer();
        this.saveMetadata(metadata);
        this.cleanupOldBackups();
        resolve(metadata);
      });

      archive.on('error', reject);
      archive.pipe(output);

      // 添加文件到归档
      this.addFilesToArchive(archive, type);

      archive.finalize();
    });
  }

  /**
   * 添加文件到归档
   */
  private addFilesToArchive(archiver: archiver.Archiver, type: BackupMetadata['type']): void {
    // 始终包含配置文件
    const configFile = path.join(this.dataDir, 'ops-claw-data.json');
    if (fs.existsSync(configFile)) {
      archiver.file(configFile, { name: 'config/ops-claw-data.json' });
    }

    // 根据类型添加其他文件
    if (type === 'data' || type === 'full') {
      // 聊天历史（已在配置文件中）
      
      // 命令学习数据
      const learnFile = path.join(this.dataDir, 'command-learn.json');
      if (fs.existsSync(learnFile)) {
        archiver.file(learnFile, { name: 'data/command-learn.json' });
      }

      // 命令模板
      const templatesFile = path.join(this.dataDir, 'command-templates.json');
      if (fs.existsSync(templatesFile)) {
        archiver.file(templatesFile, { name: 'data/command-templates.json' });
      }

      // 审计日志
      const auditDir = path.join(this.dataDir, 'audit-logs');
      if (fs.existsSync(auditDir)) {
        archiver.directory(auditDir, 'data/audit-logs');
      }
    }

    if (type === 'full' && this.config.includeCredentials) {
      // 凭证文件（加密的）
      const credFile = path.join(this.dataDir, 'credentials.json');
      if (fs.existsSync(credFile)) {
        archiver.file(credFile, { name: 'credentials/credentials.json' });
      }
    }

    // 添加备份元数据
    archiver.append(JSON.stringify({ type, timestamp: new Date().toISOString() }, null, 2), 
      { name: 'metadata.json' }
    );
  }

  /**
   * 保存备份元数据
   */
  private saveMetadata(metadata: BackupMetadata): void {
    const metadataFile = path.join(this.backupDir, 'backups.json');
    let backups: BackupMetadata[] = [];

    if (fs.existsSync(metadataFile)) {
      try {
        backups = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
      } catch {
        backups = [];
      }
    }

    backups.push(metadata);
    fs.writeFileSync(metadataFile, JSON.stringify(backups, null, 2), 'utf-8');
  }

  /**
   * 清理旧备份
   */
  private cleanupOldBackups(): void {
    const metadataFile = path.join(this.backupDir, 'backups.json');
    if (!fs.existsSync(metadataFile)) {
      return;
    }

    let backups: BackupMetadata[] = [];
    try {
      backups = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
    } catch {
      return;
    }

    // 按时间排序
    backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 删除超过最大数量的备份
    while (backups.length > this.config.maxBackups) {
      const oldBackup = backups.pop();
      if (oldBackup) {
        const backupFile = path.join(this.backupDir, `${oldBackup.id}.zip`);
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
      }
    }

    fs.writeFileSync(metadataFile, JSON.stringify(backups, null, 2), 'utf-8');
  }

  /**
   * 恢复备份
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    const backupFile = path.join(this.backupDir, `${backupId}.zip`);
    
    if (!fs.existsSync(backupFile)) {
      throw new Error('备份文件不存在');
    }

    try {
      // 解压备份
      await extract(backupFile, { dir: this.dataDir });
      
      // 重新加载配置
      // 注意：实际应用中可能需要重启应用
      
      return true;
    } catch (error: any) {
      throw new Error(`恢复备份失败: ${error.message}`);
    }
  }

  /**
   * 获取备份列表
   */
  getBackups(): BackupMetadata[] {
    const metadataFile = path.join(this.backupDir, 'backups.json');
    if (!fs.existsSync(metadataFile)) {
      return [];
    }

    try {
      const backups: BackupMetadata[] = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
      return backups.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * 删除备份
   */
  deleteBackup(backupId: string): boolean {
    const backupFile = path.join(this.backupDir, `${backupId}.zip`);
    
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }

    // 更新元数据
    const metadataFile = path.join(this.backupDir, 'backups.json');
    if (fs.existsSync(metadataFile)) {
      let backups: BackupMetadata[] = [];
      try {
        backups = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
      } catch {
        return true;
      }

      backups = backups.filter(b => b.id !== backupId);
      fs.writeFileSync(metadataFile, JSON.stringify(backups, null, 2), 'utf-8');
    }

    return true;
  }

  /**
   * 导出备份到指定位置
   */
  async exportBackup(backupId: string, exportPath: string): Promise<boolean> {
    const backupFile = path.join(this.backupDir, `${backupId}.zip`);
    
    if (!fs.existsSync(backupFile)) {
      throw new Error('备份文件不存在');
    }

    fs.copyFileSync(backupFile, exportPath);
    return true;
  }

  /**
   * 从指定位置导入备份
   */
  async importBackup(importPath: string): Promise<BackupMetadata> {
    if (!fs.existsSync(importPath)) {
      throw new Error('导入文件不存在');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `import_${timestamp}`;
    const backupFile = path.join(this.backupDir, `${backupId}.zip`);

    fs.copyFileSync(importPath, backupFile);

    const stats = fs.statSync(backupFile);
    const metadata: BackupMetadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type: 'full',
      size: stats.size,
      description: '导入的备份',
      version: app.getVersion(),
    };

    this.saveMetadata(metadata);
    return metadata;
  }

  /**
   * 获取备份配置
   */
  getConfig(): BackupConfig {
    return { ...this.config };
  }

  /**
   * 更新备份配置
   */
  updateConfig(config: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.autoBackup !== undefined) {
      if (config.autoBackup) {
        this.startAutoBackup();
      } else {
        this.stopAutoBackup();
      }
    }
  }

  /**
   * 获取备份目录大小
   */
  getBackupSize(): number {
    let totalSize = 0;

    if (fs.existsSync(this.backupDir)) {
      const files = fs.readdirSync(this.backupDir);
      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      }
    }

    return totalSize;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.stopAutoBackup();
  }
}
