import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { randomUUID } from 'crypto';
import { ServerConfig } from './database';
import { logWarn } from './logger';

export interface ConnectionResult {
  connectionId: string;
  success: boolean;
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

export interface ShellSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

type ShellSession = {
  connectionId: string;
  channel: ClientChannel;
};

export class ServerManager {
  private connections = new Map<string, Client>();
  private shellSessions = new Map<string, ShellSession>();
  /** 默认命令执行超时（ms）：60 秒 */
  private readonly DEFAULT_EXEC_TIMEOUT = 60000;

  connect(server: ServerConfig): Promise<ConnectionResult> {
    return new Promise((resolve) => {
      const conn = new Client();
      const connectionId = `conn_${randomUUID().slice(0, 8)}`;

      const config: ConnectConfig = {
        host: server.host,
        port: server.port || 22,
        username: server.username,
        readyTimeout: 10000,
      };

      if (server.password) {
        config.password = server.password;
      } else if (server.privateKey) {
        config.privateKey = server.privateKey;
      }

      conn.on('ready', () => {
        this.connections.set(connectionId, conn);
        resolve({ connectionId, success: true });
      });

      conn.on('error', (err) => {
        resolve({ connectionId, success: false, error: err.message });
      });

      // 连接关闭时自动清理（防止僵尸连接）
      conn.on('close', () => {
        this.connections.delete(connectionId);
        // 关闭该连接下的所有 shell 会话
        for (const [sid, session] of this.shellSessions) {
          if (session.connectionId === connectionId) {
            this.shellSessions.delete(sid);
          }
        }
      });

      conn.connect(config);
    });
  }

  execute(connectionId: string, command: string, timeoutMs?: number): Promise<ExecuteResult> {
    return new Promise((resolve) => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        resolve({ success: false, error: 'Connection not found' });
        return;
      }

      const timeout = timeoutMs ?? this.DEFAULT_EXEC_TIMEOUT;
      let settled = false;

      // 超时定时器
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          logWarn('ssh', `命令执行超时 (${timeout}ms)`, { connectionId, command });
          resolve({ success: false, error: `命令执行超时 (${timeout / 1000}秒)`, exitCode: -1 });
        }
      }, timeout);

      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({ success: false, error: err.message });
          }
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number | boolean, signal?: string) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          const exitCode = typeof code === 'number' ? code : 0;
          resolve({ 
            success: exitCode === 0, 
            stdout, 
            stderr, 
            exitCode 
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        // 关键：处理 exec 流错误（防止未处理异常导致进程崩溃）
        stream.on('error', (err: Error) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({ success: false, error: err.message, exitCode: -1 });
          }
        });
      });
    });
  }

  createShellSession(
    connectionId: string,
    cols: number,
    rows: number,
    onData: (sessionId: string, data: string) => void,
    onClose: (sessionId: string) => void,
    onError: (sessionId: string, error: string) => void,
  ): Promise<ShellSessionResult> {
    return new Promise((resolve) => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        resolve({ success: false, error: 'Connection not found' });
        return;
      }

      conn.shell({ term: 'xterm-256color', cols, rows }, (err, channel) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        const sessionId = `shell_${randomUUID().slice(0, 8)}`;
        this.shellSessions.set(sessionId, { connectionId, channel });

        channel.on('data', (data: Buffer) => {
          onData(sessionId, data.toString());
        });

        channel.on('close', () => {
          this.shellSessions.delete(sessionId);
          onClose(sessionId);
        });

        channel.on('error', (error: Error) => {
          onError(sessionId, error.message);
        });

        resolve({ success: true, sessionId });
      });
    });
  }

  writeToShell(sessionId: string, data: string): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) {
      throw new Error('Shell session not found');
    }
    session.channel.write(data);
  }

  resizeShell(sessionId: string, cols: number, rows: number): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) {
      throw new Error('Shell session not found');
    }
    session.channel.setWindow(rows, cols, rows, cols);
  }

  closeShell(sessionId: string): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) return;
    session.channel.close();
    this.shellSessions.delete(sessionId);
  }

  disconnect(connectionId: string): void {
    for (const [sessionId, session] of this.shellSessions.entries()) {
      if (session.connectionId === connectionId) {
        session.channel.close();
        this.shellSessions.delete(sessionId);
      }
    }

    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.end();
      this.connections.delete(connectionId);
    }
  }

  disconnectAll(): void {
    for (const [sessionId, session] of this.shellSessions.entries()) {
      session.channel.close();
      this.shellSessions.delete(sessionId);
    }

    for (const [connectionId, conn] of this.connections.entries()) {
      conn.end();
      this.connections.delete(connectionId);
    }
  }

  /**
   * 通过交互式 shell 执行命令（方案 B：共享终端上下文）
   * 用标记包裹命令，从 shell 输出中提取命令结果
   */
  executeViaShell(sessionId: string, command: string, timeoutMs?: number): Promise<ExecuteResult> {
    return new Promise((resolve) => {
      const session = this.shellSessions.get(sessionId);
      if (!session) {
        resolve({ success: false, error: 'Shell session not found' });
        return;
      }

      const markerId = randomUUID().slice(0, 8);
      const startMarker = `__SCMD_S_${markerId}__`;
      const endMarker = `__SCMD_E_${markerId}__`;
      const exitRegex = new RegExp(`__SCMD_X_(\\d+)_${markerId}__`);

      let buffer = '';
      let settled = false;
      let exitCode = 0;

      const timeout = timeoutMs ?? this.DEFAULT_EXEC_TIMEOUT;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          logWarn('ssh', `Shell 命令执行超时 (${timeout}ms)`, { sessionId, command });
          // 超时时也尝试提取已有的输出
          const startIdx = buffer.indexOf(startMarker);
          const partialOutput = startIdx !== -1
            ? buffer.substring(startIdx + startMarker.length).replace(exitRegex, '').trim()
            : '';
          resolve({ success: false, error: `命令执行超时 (${timeout / 1000}秒)`, exitCode: -1, stdout: partialOutput });
        }
      }, timeout);

      const onData = (data: Buffer) => {
        if (settled) return;
        buffer += data.toString();

        // 提取退出码
        const exitMatch = buffer.match(exitRegex);
        if (exitMatch) {
          exitCode = parseInt(exitMatch[1]);
        }

        // 检测结束标记
        if (buffer.includes(endMarker)) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            cleanup();

            const startIdx = buffer.indexOf(startMarker);
            const endIdx = buffer.indexOf(endMarker);
            let rawOutput = '';

            if (startIdx !== -1 && endIdx !== -1) {
              rawOutput = buffer.substring(startIdx + startMarker.length, endIdx);
            }

            // 清理退出码标记行
            rawOutput = rawOutput.replace(exitRegex, '').trim();

            resolve({ success: exitCode === 0, stdout: rawOutput, exitCode });
          }
        }
      };

      const cleanup = () => {
        session.channel.removeListener('data', onData);
      };

      session.channel.on('data', onData);

      // 发送带标记的命令
      const wrapped = [
        `echo '${startMarker}'`,
        command,
        `__SCMD_X=$?`,
        `echo "__SCMD_X_${'${__SCMD_X}'}_${markerId}__"`,
        `echo '${endMarker}'`,
      ].join(' ; ');

      session.channel.write(wrapped + '\n');
    });
  }
}
