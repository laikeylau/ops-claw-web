import OpenAI from 'openai';
import { AIConfigItem, SessionContext, CommandHistory } from './database';

/**
 * 简单命令缓存 - 避免重复调用 AI
 * 常见的自然语言 -> shell 命令映射，直接返回不调用 AI
 */
const SIMPLE_COMMAND_CACHE: Record<string, { command: string; explanation: string }> = {
  // Docker 常用
  '查看docker容器': { command: 'docker ps -a', explanation: '查看所有 Docker 容器' },
  '查看容器': { command: 'docker ps -a', explanation: '查看所有 Docker 容器' },
  'docker容器列表': { command: 'docker ps -a', explanation: '查看所有 Docker 容器' },
  '查看docker镜像': { command: 'docker images', explanation: '查看所有 Docker 镜像' },
  '查看镜像': { command: 'docker images', explanation: '查看所有 Docker 镜像' },
  'docker版本': { command: 'docker version', explanation: '查看 Docker 版本信息' },
  'docker信息': { command: 'docker info', explanation: '查看 Docker 系统信息' },
  // 系统信息
  '查看磁盘': { command: 'df -h', explanation: '查看磁盘使用情况' },
  '磁盘空间': { command: 'df -h', explanation: '查看磁盘使用情况' },
  '查看内存': { command: 'free -h', explanation: '查看内存使用情况' },
  '内存使用': { command: 'free -h', explanation: '查看内存使用情况' },
  '查看cpu': { command: 'top -bn1 | head -20', explanation: '查看 CPU 使用情况' },
  '系统信息': { command: 'uname -a', explanation: '查看系统信息' },
  '查看进程': { command: 'ps aux | head -20', explanation: '查看运行中的进程' },
  '当前目录': { command: 'pwd', explanation: '显示当前工作目录' },
  '查看目录': { command: 'ls -la', explanation: '查看当前目录文件列表' },
  '列出文件': { command: 'ls -la', explanation: '查看当前目录文件列表' },
  // 网络
  '查看网络': { command: 'ip addr', explanation: '查看网络接口信息' },
  '查看端口': { command: 'netstat -tlnp', explanation: '查看监听端口' },
  // 服务
  '查看服务': { command: 'systemctl list-units --type=service --state=running', explanation: '查看运行中的服务' },
  // Git
  'git状态': { command: 'git status', explanation: '查看 Git 仓库状态' },
  'git日志': { command: 'git log --oneline -10', explanation: '查看最近 10 条 Git 提交记录' },
};

/**
 * 快速匹配简单命令（支持模糊匹配）
 */
function matchSimpleCommand(prompt: string): { command: string; explanation: string } | null {
  const normalized = prompt.trim().toLowerCase();
  // 精确匹配
  if (SIMPLE_COMMAND_CACHE[normalized]) {
    return SIMPLE_COMMAND_CACHE[normalized];
  }
  // 模糊匹配
  for (const [key, value] of Object.entries(SIMPLE_COMMAND_CACHE)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }
  return null;
}

export interface AIGenerateResult {
  command: string;
  explanation: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface AIAnalyzeResult {
  analysis: string;
  suggestions: string[];
  nextCommand?: string;
  nextCommandReason?: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface AIDecomposeResult {
  subTasks: {
    id: string;
    description: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    dependencies: string[];
    expectedOutput?: string;
  }[];
  reasoning: string;
  suggestedAgent?: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

// 扩展的 AI 上下文
export interface AIContext {
  os: string;
  history?: string;
  // 新增工作上下文
  currentDirectory?: string;
  hostname?: string;
  recentCommands?: CommandHistory[];
  taskGoal?: string;
  // 新增任务历史摘要（AI 生成的智能摘要）
  taskHistorySummary?: string;
}

/** 智能摘要请求 */
export interface AISummaryRequest {
  taskHistory: Array<{
    action: string;
    content: string;
    command?: string;
    result?: string;
  }>;
  recentCommands: CommandHistory[];
  currentGoal?: string;
}

/** 智能摘要结果 */
export interface AISummaryResult {
  summary: string;
  keyFindings: string[];     // 关键发现（如发现的路径、重要结果）
  successfulCommands: string[]; // 成功执行的命令摘要
  failedCommands: string[];    // 失败的命令
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export class AIEngine {
  /** Client 缓存：endpoint#apiKey → OpenAI 实例 */
  private clientCache = new Map<string, OpenAI>();

  /**
   * 获取或创建 OpenAI Client（复用 HTTP 连接池）
   */
  private getClient(config: AIConfigItem): OpenAI {
    const key = `${config.endpoint}#${config.apiKey || ''}`;
    let client = this.clientCache.get(key);
    if (!client) {
      client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });
      this.clientCache.set(key, client);
    }
    return client;
  }

  /**
   * 清除 Client 缓存（配置变更时调用）
   */
  clearClientCache(): void {
    this.clientCache.clear();
  }

  /**
   * 构建公共上下文信息片段（提取重复逻辑）
   */
  private buildContextParts(context: AIContext): string[] {
    const parts: string[] = [];
    if (context.currentDirectory) {
      parts.push(`当前工作目录: ${context.currentDirectory}`);
    }
    if (context.hostname) {
      parts.push(`主机名: ${context.hostname}`);
    }
    if (context.recentCommands && context.recentCommands.length > 0) {
      parts.push('最近执行的命令:');
      for (const cmd of context.recentCommands.slice(-3)) {
        const status = cmd.exitCode === 0 ? '成功' : '失败';
        parts.push(`  - ${cmd.command} (退出码: ${cmd.exitCode}, 目录: ${cmd.directory || context.currentDirectory || '未知'})`);
      }
    }
    if (context.taskGoal) {
      parts.push(`当前任务目标: ${context.taskGoal}`);
    }
    if (context.taskHistorySummary) {
      parts.push(`\n之前的操作历史:\n${context.taskHistorySummary}`);
    }
    if (context.history) {
      parts.push(context.history);
    }
    return parts;
  }

  /**
   * 构建 OS 相关提示
   */
  private getOsHint(os: string): string {
    return os === 'windows'
      ? '当前目标服务器是 Windows，请优先生成 PowerShell 命令，避免使用 Linux shell 语法、bash 工具链和 Unix 路径格式。'
      : '当前目标服务器是 Linux，请生成标准 shell 命令，避免使用 PowerShell 语法。';
  }

  async generateCommand(
    prompt: string,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AIGenerateResult> {
    try {
      // 快速缓存匹配：常见请求直接返回，不调用 AI（节省 token）
      const cached = matchSimpleCommand(prompt);
      if (cached) {
        return cached;
      }

      const client = this.getClient(config);

      const commandStylePrompt = `4. ${this.getOsHint(context.os || 'linux')}`;

      const contextParts = this.buildContextParts(context);
      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维助手。用户会通过自然语言描述他们想执行的操作，你需要将其转换为准确的 shell 命令。

规则：
1. 只输出命令，不要输出多余解释
2. 命令必须安全，不要使用 rm -rf / 等危险命令
3. 如果是复杂操作，拆分成多行命令（用 && 连接）
${commandStylePrompt}
5. 操作系统：${context.os}
${contextInfo}

重要提示：
- 如果用户提到"进入目录"或相对路径操作，请使用当前工作目录作为基准路径
- 如果之前的命令已经切换了目录，后续命令应基于新的目录位置
- 使用绝对路径可以避免路径混淆问题

返回 json 格式：
{
  "command": "实际执行的命令",
  "explanation": "用中文简要解释这个命令的作用"
}`;

      // 使用流式请求（兼容要求 stream=true 的 API 代理）
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        stream: true,
      });

      // 累积流式响应
      let content = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        content += delta;
      }

      // 尝试提取 JSON 部分（AI 可能在 JSON 前后添加了其他文字）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
      const parsed = JSON.parse(jsonStr);
      return {
        ...parsed,
      };
    } catch (error: any) {
      throw new Error(`AI 命令生成失败：${error.message}`);
    }
  }

  async analyzeResult(
    userPrompt: string,
    command: string,
    output: string,
    exitCode: number | undefined,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AIAnalyzeResult> {
    try {
      const client = this.getClient(config);

      const commandStylePrompt = context.os === 'windows'
        ? '- 当前目标服务器是 Windows，如有后续命令请使用 PowerShell 语法'
        : '- 当前目标服务器是 Linux，如有后续命令请使用标准 shell 语法';

      const contextParts = this.buildContextParts(context);
      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维助手。用户刚才提出了一个运维需求，你给出了执行命令，现在需要你分析命令执行结果并给出专业建议。

你的任务是：
1. 分析命令输出结果，判断是否达到用户目标
2. 如果有问题，给出具体建议和解决方案
3. 如果需要进一步操作，给出后续命令建议

分析要点：
- 仔细阅读输出内容，识别关键信息
- 注意错误信息、异常状态、关键数值
- 结合用户原始需求判断是否需要继续操作
${commandStylePrompt}
${contextInfo}

重要提示：
- 如果后续命令涉及路径操作，请使用当前工作目录作为基准
- 保持任务的连贯性，后续命令应该基于当前状态继续推进

返回 json 格式：
{
  "analysis": "用中文分析命令执行结果，告诉用户当前状态",
  "suggestions": ["建议1", "建议2", "建议3"],
  "nextCommand": "如果需要继续操作的后续命令（可选）",
  "nextCommandReason": "为什么需要执行这个后续命令（可选）"
}`;

      const userMessage = `用户原始需求：${userPrompt}

执行的命令：${command}

命令输出：
${output}

退出码：${exitCode ?? '未知'}

请分析结果并给出建议。`;

      // 使用流式请求（兼容要求 stream=true 的 API 代理）
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        stream: true,
      });

      // 累积流式响应
      let content = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        content += delta;
      }

      // 尝试提取 JSON 部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
      const result = JSON.parse(jsonStr);
      return {
        analysis: result.analysis || '命令已执行完成。',
        suggestions: result.suggestions || [],
        nextCommand: result.nextCommand,
        nextCommandReason: result.nextCommandReason,
      };
    } catch (error: any) {
      throw new Error(`AI 结果分析失败：${error.message}`);
    }
  }

  async decomposeTask(
    prompt: string,
    context: AIContext,
    config: AIConfigItem,
    options: { allowedTools: string[]; maxSteps: number }
  ): Promise<AIDecomposeResult> {
    try {
      const client = this.getClient(config);

      const osHint = context.os === 'windows'
        ? '目标服务器是 Windows，请使用 PowerShell 命令。'
        : '目标服务器是 Linux，请使用标准 bash/shell 命令。';

      const contextParts = this.buildContextParts(context);
      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维助手，像一个经验丰富的一线工程师。你的风格是：简单直接、不废话、能一条命令解决的绝不拆成两条。

## 核心原则
- **能一步完成的，只用一步**。查信息、看状态这类简单任务，一条命令就够了。
- **用最简单、最常用的命令**。不要用复杂拼接、嵌套管道。直接用标准命令。
- **不要过度检查**。不需要先检查工具是否安装、服务是否可用，直接执行目标命令。如果失败了，用户会告诉你。

## 判断规则
1. 简单查询任务（查看状态、列表、信息）→ 1 步，一条命令
2. 中等任务（安装、配置、修改）→ 1-2 步
3. 复杂任务（部署、迁移、多服务联动）→ 最多 ${options.maxSteps} 步
4. 与服务器无关的对话 → subTasks 设为空数组 []

## 命令风格
- 查看 docker：直接用 docker ps、docker images 等
- 查看系统：直接用 top、free、df 等
- 不要 docker ps --format 'table ...' 这种复杂格式，直接 docker ps -a
- 不要用 >/dev/null 2>&1 && echo ... 这种花哨写法

${osHint}
${contextInfo}

可用工具：${options.allowedTools.join(', ')}

返回纯 json：
{
  "subTasks": [{"id": "step1", "description": "做什么", "toolName": "ssh:execute", "toolInput": {"command": "实际命令"}}],
  "reasoning": "简短说明思路",
  "suggestedAgent": "general"
}`;

      // 使用流式请求（兼容要求 stream=true 的 API 代理）
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        stream: true,
      });

      // 累积流式响应
      let content = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        content += delta;
      }

      // 如果流式响应为空，返回空结果
      if (!content || content.trim() === '') {
        return { subTasks: [], reasoning: 'AI 未返回有效响应', suggestedAgent: 'general' };
      }

      // 尝试提取 JSON 部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(jsonStr);

      // 如果没有 subTasks，则视为通用对话，返回空数组
      const subTasksRaw = Array.isArray(parsed.subTasks) ? parsed.subTasks : [];

      return {
        subTasks: subTasksRaw.map((st: any) => ({
          id: st.id || `step${Math.random().toString(36).slice(2, 8)}`,
          description: st.description,
          toolName: st.toolName || 'ssh:execute',
          toolInput: st.toolInput || {},
          dependencies: st.dependencies || [],
          expectedOutput: st.expectedOutput || '',
        })),
        reasoning: parsed.reasoning || '',
        suggestedAgent: parsed.suggestedAgent || 'general',
      };
    } catch (error: any) {
      throw new Error(`AI 任务分解失败：${error.message}`);
    }
  }

  /**
   * 生成智能上下文摘要（Claude Code 方案）
   * 不是简单截取，而是让 AI 提取关键信息
   */
  async generateContextSummary(
    request: AISummaryRequest,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AISummaryResult> {
    try {
      const client = this.getClient(config);

      // 构建历史内容（限制总长度避免 Token 过多）
      const maxHistoryLength = 3000; // 最大历史字符数
      let historyContent = request.taskHistory.map(step => {
        if (step.action === 'intent') {
          return `用户意图: ${step.content}`;
        } else if (step.action === 'command') {
          return `执行命令: ${step.command || step.content}`;
        } else if (step.action === 'result') {
          // 结果智能截取：保留关键行
          const resultContent = step.result || step.content;
          const lines = resultContent.split('\n').filter(l => l.trim().length > 0 && l.trim().length < 200);
          return `执行结果: ${lines.slice(0, 10).join('; ')}`;
        } else if (step.action === 'analysis') {
          return `AI分析: ${step.content}`;
        }
        return step.content;
      }).join('\n');

      // 如果历史过长，从前面截断（保留最近的）
      if (historyContent.length > maxHistoryLength) {
        historyContent = historyContent.slice(-maxHistoryLength);
      }

      const systemPrompt = `你是一个上下文摘要助手。你的任务是从操作历史中提取关键信息，生成简洁但信息完整的摘要。

摘要要求：
1. **关键发现** - 提取所有发现的重要路径、文件、配置信息（必须保留完整路径！）
2. **成功操作** - 记录成功执行的命令及其关键结果
3. **失败操作** - 记录失败的命令及原因
4. **当前状态** - 总结当前工作目录、任务进展

重要规则：
- 保留具体的路径信息（如 /data/dify、/home/user/project）- 这是最重要的信息！
- 保留重要的数值信息（如容器 ID、端口、版本号）
- 不要丢失上下文依赖的关键信息
- 摘要应该让后续任务能够感知之前的结果

返回 json 格式：
{
  "summary": "一段简洁的摘要，描述之前做了什么",
  "keyFindings": ["发现的关键信息列表，如路径、配置等"],
  "successfulCommands": ["成功执行的命令摘要"],
  "failedCommands": ["失败的命令及原因"]
}`;

      const userMessage = `当前任务目标: ${request.currentGoal || '未知'}
当前工作目录: ${context.currentDirectory || '未知'}

操作历史:
${historyContent}

请生成智能摘要。`;

      // 使用流式请求（兼容要求 stream=true 的 API 代理）
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        stream: true,
      });

      // 累积流式响应
      let content = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        content += delta;
      }

      // 尝试提取 JSON 部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
      const parsed = JSON.parse(jsonStr);

      return {
        summary: parsed.summary || '',
        keyFindings: parsed.keyFindings || [],
        successfulCommands: parsed.successfulCommands || [],
        failedCommands: parsed.failedCommands || [],
      };
    } catch (error: any) {
      // 摘要失败时返回空摘要，不影响主流程
      console.error('AI 摘要生成失败:', error.message);
      return {
        summary: '',
        keyFindings: [],
        successfulCommands: [],
        failedCommands: [],
      };
    }
  }
}
