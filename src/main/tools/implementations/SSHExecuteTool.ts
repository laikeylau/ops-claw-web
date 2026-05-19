import { Tool, ToolOutput } from '../Tool';
import { RiskLevel } from '../../types/security';
import { ToolUseContext } from '../../types/tool-context';
import { ServerManager, ExecuteResult } from '../../server-manager';

/** SSH 执行输入参数 */
interface SSHExecuteInput {
  connectionId: string;
  command: string;
}

/** SSH 执行输出 */
interface SSHExecuteOutput extends ToolOutput {
  data?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  };
}

export class SSHExecuteTool implements Tool<SSHExecuteInput, SSHExecuteOutput> {
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
  }

  metadata = {
    name: 'ssh:execute',
    description: '在远程服务器上执行 shell 命令',
    category: 'ssh',
    version: '1.0.0',
  };

  security = {
    riskLevel: RiskLevel.MEDIUM,
    requiresConfirmation: true,
    allowedInModes: ['manual' as const, 'ai' as const],
  };

  validateInput(input: SSHExecuteInput): string | null {
    if (!input.connectionId || typeof input.connectionId !== 'string') {
      return 'connectionId 不能为空';
    }
    if (!input.command || typeof input.command !== 'string') {
      return 'command 不能为空';
    }
    return null;
  }

  async execute(input: SSHExecuteInput, context: ToolUseContext): Promise<SSHExecuteOutput> {
    const result: ExecuteResult = await this.serverManager.execute(input.connectionId, input.command);

    // 智能截取输出：保留开头和结尾（关键信息通常在这些位置）
    const maxOutputLength = 2000;
    let stdout = result.stdout || '';
    let stderr = result.stderr || '';

    if (stdout.length > maxOutputLength) {
      const half = maxOutputLength / 2;
      stdout = stdout.substring(0, half) + '\n...[输出已截取]...\n' + stdout.substring(stdout.length - half);
    }
    if (stderr.length > maxOutputLength) {
      const half = maxOutputLength / 2;
      stderr = stderr.substring(0, half) + '\n...[输出已截取]...\n' + stderr.substring(stderr.length - half);
    }

    return {
      success: result.success,
      data: {
        stdout,
        stderr,
        exitCode: result.exitCode,
      },
      error: result.error,
      contextUpdates: {
        lastExitCode: result.exitCode ?? 1,
      },
    };
  }

  /**
   * 可用性检查：需要已建立 SSH 连接
   */
  isAvailable = (context: ToolUseContext): boolean => {
    return context.connectionId !== undefined;
  };
}
