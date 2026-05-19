import { Client, SFTPWrapper } from 'ssh2';
import fs from 'fs';
import path from 'path';

/**
 * SFTP 管理器 - 文件传输功能
 * 
 * 功能：
 * 1. 上传文件到远程服务器
 * 2. 从远程服务器下载文件
 * 3. 远程目录浏览
 * 4. 传输进度回调
 */

export interface SftpFileInfo {
  name: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  isDirectory: boolean;
  isFile: boolean;
  permissions: number;
  owner: number;
  group: number;
}

export interface TransferProgress {
  transferred: number;
  total: number;
  percent: number;
  speed: number;  // bytes per second
  eta: number;    // estimated time remaining in seconds
}

export interface TransferResult {
  success: boolean;
  message: string;
  localPath?: string;
  remotePath?: string;
  size?: number;
  duration?: number;
  error?: string;
}

export class SftpManager {
  private connections: Map<string, Client> = new Map();
  private sftpSessions: Map<string, SFTPWrapper> = new Map();

  constructor(connections: Map<string, Client>) {
    this.connections = connections;
  }

  /**
   * 获取或创建 SFTP 会话
   */
  private async getSftpSession(connectionId: string): Promise<SFTPWrapper> {
    // 检查现有会话
    const existing = this.sftpSessions.get(connectionId);
    if (existing) {
      return existing;
    }

    // 创建新会话
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`连接 ${connectionId} 不存在`);
    }

    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`创建 SFTP 会话失败: ${err.message}`));
          return;
        }
        this.sftpSessions.set(connectionId, sftp);
        resolve(sftp);
      });
    });
  }

  /**
   * 列出远程目录内容
   */
  async listDirectory(connectionId: string, remotePath: string): Promise<SftpFileInfo[]> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(new Error(`读取目录失败: ${err.message}`));
          return;
        }

        const files: SftpFileInfo[] = list.map(item => ({
          name: item.filename,
          size: item.attrs.size,
          modifyTime: item.attrs.mtime * 1000,
          accessTime: item.attrs.atime * 1000,
          isDirectory: (item.attrs.mode & 0o40000) !== 0,
          isFile: (item.attrs.mode & 0o100000) !== 0,
          permissions: item.attrs.mode & 0o777,
          owner: item.attrs.uid,
          group: item.attrs.gid,
        }));

        // 排序：目录在前，文件在后
        files.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        resolve(files);
      });
    });
  }

  /**
   * 上传文件
   */
  async uploadFile(
    connectionId: string,
    localPath: string,
    remotePath: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<TransferResult> {
    const sftp = await this.getSftpSession(connectionId);
    const startTime = Date.now();

    // 获取本地文件信息
    const stat = fs.statSync(localPath);
    const totalSize = stat.size;

    return new Promise((resolve, reject) => {
      let transferred = 0;
      let lastTime = startTime;
      let lastTransferred = 0;

      const readStream = fs.createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        
        // 计算进度
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        
        if (elapsed >= 0.5) {  // 每 0.5 秒更新一次
          const speed = (transferred - lastTransferred) / elapsed;
          const remaining = totalSize - transferred;
          const eta = speed > 0 ? remaining / speed : 0;
          
          onProgress?.({
            transferred,
            total: totalSize,
            percent: Math.round((transferred / totalSize) * 100),
            speed,
            eta,
          });
          
          lastTime = now;
          lastTransferred = transferred;
        }
      });

      writeStream.on('close', () => {
        const duration = (Date.now() - startTime) / 1000;
        resolve({
          success: true,
          message: '文件上传成功',
          localPath,
          remotePath,
          size: totalSize,
          duration,
        });
      });

      writeStream.on('error', (err: Error) => {
        reject(new Error(`上传失败: ${err.message}`));
      });

      readStream.pipe(writeStream);
    });
  }

  /**
   * 下载文件
   */
  async downloadFile(
    connectionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<TransferResult> {
    const sftp = await this.getSftpSession(connectionId);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // 获取远程文件信息
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          reject(new Error(`获取文件信息失败: ${err.message}`));
          return;
        }

        const totalSize = stats.size;
        let transferred = 0;
        let lastTime = startTime;
        let lastTransferred = 0;

        const readStream = sftp.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(localPath);

        readStream.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          
          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          
          if (elapsed >= 0.5) {
            const speed = (transferred - lastTransferred) / elapsed;
            const remaining = totalSize - transferred;
            const eta = speed > 0 ? remaining / speed : 0;
            
            onProgress?.({
              transferred,
              total: totalSize,
              percent: Math.round((transferred / totalSize) * 100),
              speed,
              eta,
            });
            
            lastTime = now;
            lastTransferred = transferred;
          }
        });

        writeStream.on('close', () => {
          const duration = (Date.now() - startTime) / 1000;
          resolve({
            success: true,
            message: '文件下载成功',
            localPath,
            remotePath,
            size: totalSize,
            duration,
          });
        });

        writeStream.on('error', (err: Error) => {
          reject(new Error(`下载失败: ${err.message}`));
        });

        readStream.pipe(writeStream);
      });
    });
  }

  /**
   * 创建远程目录
   */
  async createDirectory(connectionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) {
          reject(new Error(`创建目录失败: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 删除远程文件
   */
  async deleteFile(connectionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) {
          reject(new Error(`删除文件失败: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 删除远程目录
   */
  async deleteDirectory(connectionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) {
          reject(new Error(`删除目录失败: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 重命名远程文件/目录
   */
  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(new Error(`重命名失败: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 获取远程文件信息
   */
  async stat(connectionId: string, remotePath: string): Promise<SftpFileInfo> {
    const sftp = await this.getSftpSession(connectionId);

    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          reject(new Error(`获取文件信息失败: ${err.message}`));
          return;
        }

        resolve({
          name: path.basename(remotePath),
          size: stats.size,
          modifyTime: stats.mtime * 1000,
          accessTime: stats.atime * 1000,
          isDirectory: (stats.mode & 0o40000) !== 0,
          isFile: (stats.mode & 0o100000) !== 0,
          permissions: stats.mode & 0o777,
          owner: stats.uid,
          group: stats.gid,
        });
      });
    });
  }

  /**
   * 关闭 SFTP 会话
   */
  closeSession(connectionId: string): void {
    const sftp = this.sftpSessions.get(connectionId);
    if (sftp) {
      sftp.end();
      this.sftpSessions.delete(connectionId);
    }
  }

  /**
   * 关闭所有会话
   */
  closeAllSessions(): void {
    for (const [id, sftp] of this.sftpSessions) {
      sftp.end();
    }
    this.sftpSessions.clear();
  }
}
