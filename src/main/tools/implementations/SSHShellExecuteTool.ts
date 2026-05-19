import { Tool, ToolOutput } from '../Tool';
import { RiskLevel } from '../../types/security';
import { ToolUseContext } from '../../types/tool-context';
import { ServerManager, ExecuteResult } from '../../server-manager';

/** Shell 执行输入参数 */
interface SSHShellExecuteInput {
  shellSessionId: string;
  command: string;
}

/** Shell 执行输出 */
interface SSHShellExecuteOutput extends ToolOutput {
  data?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  };
}

/**
 * 通过交互式 Shell 执行命令的工具（方案 B）
 *
 * 与 SSHExecuteTool 的区别：
 * - SSHExecuteTool 使用 conn.exec() 创建独立的 exec 通道（不共享终端状态）
 * - SSHShellExecuteTool 使用 shellSession 的 channel.write()（共享终端状态）
 *
 * 优势：
 * - AI 执行的命令会出现在终端中（用户可见）
 * - 保持 shell 上下文（当前目录、环境变量等）
 * - 更自然的交互体验
 */
export class SSHShellExecuteTool implements Tool<SSHShellExecuteInput, SSHShellExecuteOutput> {
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
  }

  metadata = {
    name: 'ssh:shell:execute',
    description: '通过交互式终端执行 shell 命令（共享终端上下文，命令可见）',
    category: 'ssh',
    version: '1.0.0',
  };

  security = {
    riskLevel: RiskLevel.MEDIUM,
    requiresConfirmation: true,
    allowedInModes: ['manual' as const, 'ai' as const],
  };

  validateInput(input: SSHShellExecuteInput): string | null {
    if (!input.shellSessionId || typeof input.shellSessionId !== 'string') {
      return 'shellSessionId 不能为空';
    }
    if (!input.command || typeof input.command !== 'string') {
      return 'command 不能为空';
    }
    return null;
  }

  async execute(input: SSHShellExecuteInput, context: ToolUseContext): Promise<SSHShellExecuteOutput> {
    const result: ExecuteResult = await this.serverManager.executeViaShell(
      input.shellSessionId,
      input.command
    );

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
   * 可用性检查：需要已建立 shell 会话
   */
  isAvailable = (context: ToolUseContext): boolean => {
    return !!context.shellSessionId;
  };
}
