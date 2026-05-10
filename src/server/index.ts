// @ts-nocheck
// 使用 require 导入第三方包（无需安装类型声明）
const express = require('express');
const { createServer } = require('http');
const { Server: SocketServer } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');

// Bridge 脚本内容（编译时内联）
const { WEB_BRIDGE_SCRIPT } = require('./bridge-content');
import { ServerManager } from '../main/server-manager';
import { AIEngine } from '../main/ai-engine';
import { DatabaseManager } from '../main/database';
import { SecurityAnalyzer } from '../main/tools/SecurityAnalyzer';
import { ToolRegistry } from '../main/tools/ToolRegistry';
import { ToolExecutor } from '../main/tools/ToolExecutor';
import { SSHExecuteTool } from '../main/tools/implementations/SSHExecuteTool';
import { AIGenerateTool } from '../main/tools/implementations/AIGenerateTool';
import { TokenBudgetTracker } from '../main/context/TokenBudget';
import { CompactEngine } from '../main/context/CompactEngine';
import { SessionLogger } from '../main/recovery/SessionLogger';
import { SessionRecovery } from '../main/recovery/SessionRecovery';
import { PermissionManager } from '../main/tools/PermissionManager';
import { AgentCoordinator } from '../main/agents/AgentCoordinator';
import { initializeAgentSystem } from '../main/agents';
import { AIContext } from '../main/ai-engine';
import { CommandHistory } from '../main/database';
import { SubTask } from '../main/agents/Agent';
import { ToolUseContext } from '../main/types/tool-context';

// ===== 配置 =====
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'ops-claw-default-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'opsclaw2024';
const JWT_EXPIRES = '24h';

// ===== 初始化核心服务 =====
const db = new DatabaseManager();
const serverManager = new ServerManager();
const aiEngine = new AIEngine();
const securityAnalyzer = new SecurityAnalyzer();
const permissionManager = new PermissionManager();
const toolRegistry = new ToolRegistry();
const toolExecutor = new ToolExecutor(toolRegistry, securityAnalyzer, permissionManager);
const budgetTracker = new TokenBudgetTracker();
const compactEngine = new CompactEngine(budgetTracker);
const sessionLogger = new SessionLogger();
const sessionRecovery = new SessionRecovery(sessionLogger);
const agentCoordinator = initializeAgentSystem(toolExecutor, toolRegistry, aiEngine);

// 注册内置工具
toolRegistry.register(new SSHExecuteTool(serverManager));
toolRegistry.register(new AIGenerateTool(aiEngine));

// ===== Express 应用 =====
const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json());

// ===== 认证中间件 =====
interface JwtPayload {
  authenticated: boolean;
  iat?: number;
  exp?: number;
}

function generateToken(): string {
  return jwt.sign({ authenticated: true } as JwtPayload, SESSION_SECRET, { expiresIn: JWT_EXPIRES });
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: '未认证' });
    return;
  }
  try {
    jwt.verify(token, SESSION_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

// ===== 登录接口 =====
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateToken();
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// ===== 服务器管理路由 =====
app.get('/api/servers', authMiddleware, (_req, res) => {
  res.json(db.getServers());
});

app.post('/api/servers', authMiddleware, async (req, res) => {
  try {
    const id = await db.addServer(req.body);
    res.json({ success: true, id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/servers/:id', authMiddleware, async (req, res) => {
  try {
    await db.updateServer(parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/servers/:id', authMiddleware, async (req, res) => {
  try {
    await db.deleteServer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SSH 连接路由 =====
app.post('/api/ssh/connect', authMiddleware, async (req, res) => {
  const { serverId } = req.body;
  const server = await db.getServerWithPassword(serverId);
  if (!server) {
    res.status(404).json({ success: false, error: 'Server not found' });
    return;
  }
  const result = await serverManager.connect(server);
  res.json(result);
});

app.post('/api/ssh/execute', authMiddleware, async (req, res) => {
  const { connectionId, command } = req.body;
  const result = await serverManager.execute(connectionId, command);
  res.json(result);
});

app.post('/api/ssh/disconnect', authMiddleware, (req, res) => {
  const { connectionId } = req.body;
  serverManager.disconnect(connectionId);
  res.json({ success: true });
});

// ===== SSH 服务器监控 =====
app.post('/api/ssh/monitor', authMiddleware, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) { res.status(400).json({ error: '缺少 connectionId' }); return; }

    // 批量执行监控命令（一次性获取所有数据，减少 RTT）
    const monitorScript = `
      echo '===MONITOR_START==='
      echo '===CPU==='
      top -bn1 | head -5
      echo '===MEM==='
      free -m
      echo '===DISK==='
      df -h /
      echo '===NET==='
      cat /proc/net/dev | head -4
      echo '===LOAD==='
      cat /proc/loadavg
      echo '===UPTIME==='
      uptime -p 2>/dev/null || uptime
      echo '===OS==='
      cat /etc/os-release 2>/dev/null | head -4
      uname -r
      echo '===HOSTNAME==='
      hostname -f 2>/dev/null || hostname
      echo '===CPU_CORES==='
      nproc
      echo '===TOTAL_MEM==='
      awk '/MemTotal/ {print int(\$2/1024)}' /proc/meminfo
      echo '===PROCESSES==='
      ps aux --sort=-%cpu | head -21
      echo '===DOCKER==='
      docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo 'DOCKER_NOT_AVAILABLE'
      echo '===MONITOR_END==='
    `;

    const result = await serverManager.execute(connectionId, monitorScript);
    if (!result.success) {
      res.json({ success: false, error: result.error || '执行监控命令失败' });
      return;
    }

    const output = result.stdout || '';

    // 清理输出（去除 \r 回车符、ANSI 转义码）
    const cleanOutput = output.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // 按标记提取段落（比正则更可靠）
    const getSection = (name: string) => {
      const marker = `===${name}===`;
      const start = cleanOutput.indexOf(marker);
      if (start === -1) return '';
      const contentStart = start + marker.length;
      const nextMarker = cleanOutput.indexOf('\n===', contentStart);
      return nextMarker === -1
        ? cleanOutput.substring(contentStart).trim()
        : cleanOutput.substring(contentStart, nextMarker).trim();
    };

    // CPU 解析（兼容多种 top 输出格式）
    let cpuUsage = '0.0';
    let cpuCores = '0';
    try {
      const cpuRaw = getSection('CPU');
      const cpuMatch = cpuRaw.match(/(\d+\.?\d*)\s*%?id/);
      if (cpuMatch) cpuUsage = (100 - parseFloat(cpuMatch[1])).toFixed(1);
      cpuCores = getSection('CPU_CORES').replace(/\D/g, '') || '0';
    } catch { /* fallback */ }

    // 内存解析（兼容不同 free 输出格式）
    let memTotal = 0, memUsed = 0, memAvailable = 0, memUsage = '0.0', totalMem = '0';
    try {
      const memRaw = getSection('MEM');
      const memLine = memRaw.split('\n').find((l: string) => l.trim().startsWith('Mem:')) || '';
      if (memLine) {
        const mp = memLine.trim().split(/\s+/);
        memTotal = parseInt(mp[1]) || 0;
        memUsed = parseInt(mp[2]) || 0;
        memAvailable = parseInt(mp[6]) || parseInt(mp[3]) || 0;
        memUsage = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : '0.0';
      }
      totalMem = getSection('TOTAL_MEM').replace(/\D/g, '') || String(memTotal);
    } catch { /* fallback */ }

    // 磁盘解析
    let diskTotal = 'N/A', diskUsed = 'N/A', diskAvail = 'N/A', diskUsage = 'N/A';
    try {
      const diskRaw = getSection('DISK');
      const diskLine = diskRaw.split('\n').find((l: string) => l.trim().startsWith('/')) || '';
      if (diskLine) {
        const dp = diskLine.trim().split(/\s+/);
        diskTotal = dp[1] || 'N/A';
        diskUsed = dp[2] || 'N/A';
        diskAvail = dp[3] || 'N/A';
        diskUsage = dp[4] || 'N/A';
      }
    } catch { /* fallback */ }

    // 网络解析
    let netRxBytes = 0, netTxBytes = 0, netInterface = '';
    try {
      const netRaw = getSection('NET');
      for (const line of netRaw.split('\n')) {
        if (!line.includes(':')) continue;
        const parts = line.split(':');
        const iface = parts[0].trim();
        if (iface === 'lo' || iface === 'docker0' || iface.startsWith('br-') || iface.startsWith('veth')) continue;
        const stats = (parts[1] || '').trim().split(/\s+/);
        if (stats.length >= 10) {
          netRxBytes += parseInt(stats[0]) || 0;
          netTxBytes += parseInt(stats[8]) || 0;
          if (!netInterface) netInterface = iface;
        }
      }
    } catch { /* fallback */ }

    // 负载解析
    let load1 = '0', load5 = '0', load15 = '0';
    try {
      const lp = getSection('LOAD').split(/\s+/);
      load1 = lp[0] || '0';
      load5 = lp[1] || '0';
      load15 = lp[2] || '0';
    } catch { /* fallback */ }

    // 系统信息解析
    let hostnameRaw = '', osName = 'Linux', kernelVersion = 'N/A', uptimeRaw = '';
    try {
      hostnameRaw = getSection('HOSTNAME');
      uptimeRaw = getSection('UPTIME');
      const osRaw = getSection('OS');
      if (osRaw) {
        const osLines = osRaw.split('\n');
        const prettyLine = osLines.find((l: string) => l.startsWith('PRETTY_NAME='));
        if (prettyLine) osName = prettyLine.split('=')[1].replace(/"/g, '').trim();
        const kernelLine = osLines.find((l: string) => l.trim() && !l.includes('='));
        if (kernelLine) kernelVersion = kernelLine.trim();
      }
    } catch { /* fallback */ }

    // 进程解析
    let processes: any[] = [];
    try {
      const procRaw = getSection('PROCESSES');
      if (procRaw) {
        processes = procRaw.split('\n').slice(1, 21).map((line: string) => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0] || '', pid: parts[1] || '', cpu: parts[2] || '0', mem: parts[3] || '0',
            vsz: parts[4] || '0', rss: parts[5] || '0', stat: parts[7] || '',
            command: parts.slice(10).join(' '),
          };
        }).filter((p: any) => p.pid && p.pid !== 'PID');
      }
    } catch { /* fallback */ }

    // Docker 解析
    let containers: any[] = [];
    let dockerAvailable = false;
    try {
      const dockerRaw = getSection('DOCKER');
      if (dockerRaw && !dockerRaw.includes('DOCKER_NOT_AVAILABLE') && !dockerRaw.includes('Cannot connect')) {
        dockerAvailable = true;
        containers = dockerRaw.split('\n').filter((l: string) => l.trim()).map((line: string) => {
          const parts = line.split('\t');
          return { id: parts[0] || '', name: parts[1] || '', image: parts[2] || '', status: parts[3] || '', ports: parts[4] || '' };
        }).filter((c: any) => c.id);
      }
    } catch { /* fallback */ }

    res.json({
      success: true,
      cpu: { usage: cpuUsage, cores: cpuCores },
      memory: { total: memTotal, used: memUsed, available: memAvailable, usage: memUsage, totalMB: totalMem },
      disk: { total: diskTotal, used: diskUsed, available: diskAvail, usage: diskUsage },
      network: { rxBytes: netRxBytes, txBytes: netTxBytes, interface: netInterface },
      load: { '1m': load1, '5m': load5, '15m': load15 },
      system: { hostname: hostnameRaw, os: osName, kernel: kernelVersion, uptime: uptimeRaw },
      processes,
      docker: { available: dockerAvailable, containers },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SSH 获取服务器地理位置 =====
app.post('/api/ssh/geoip', authMiddleware, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) { res.status(400).json({ error: '缺少 connectionId' }); return; }

    // 在远程服务器上查询 IP 地理信息
    const result = await serverManager.execute(connectionId, 'curl -s --connect-timeout 5 ipinfo.io/json 2>/dev/null || echo "{}"');
    if (!result.success) {
      res.json({ success: false, error: result.error });
      return;
    }
    try {
      const geo = JSON.parse(result.stdout || '{}');
      res.json({ success: true, ...geo });
    } catch {
      res.json({ success: false, error: '解析地理位置失败' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 命令安全分析 =====
app.post('/api/command/analyze', authMiddleware, (req, res) => {
  const { command } = req.body;
  const analysis = securityAnalyzer.analyze(command);
  const permission = permissionManager.checkPermission(command, analysis.level);
  if (permission === 'allow') {
    analysis.requiresConfirmation = false;
    analysis.blocked = false;
  } else if (permission === 'confirm') {
    analysis.requiresConfirmation = true;
    analysis.blocked = false;
  } else if (permission === 'deny') {
    analysis.requiresConfirmation = true;
    analysis.blocked = true;
  }
  res.json(analysis);
});

// ===== 工具系统 =====
app.post('/api/tools/execute', authMiddleware, async (req, res) => {
  const result = await toolExecutor.execute(req.body);
  res.json(result);
});

app.get('/api/tools/list', authMiddleware, (_req, res) => {
  const tools = toolRegistry.getAvailableTools();
  res.json(tools.map(t => ({
    name: t.metadata.name,
    description: t.metadata.description,
    category: t.metadata.category,
    riskLevel: t.security.riskLevel,
  })));
});

// ===== AI 功能 =====
app.post('/api/ai/generate', authMiddleware, async (req, res) => {
  try {
    const { tabId, prompt, context } = req.body;
    const config = await db.getActiveAIConfig();
    if (!config) { res.status(400).json({ error: '未配置 AI 服务' }); return; }

    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal || prompt,
    };

    db.addTaskStep(tabId, { timestamp: new Date().toISOString(), action: 'intent', content: prompt });
    sessionLogger.log('user_intent', tabId, { prompt });
    db.updateContext(tabId, { taskGoal: prompt });

    const result = await aiEngine.generateCommand(prompt, mergedContext, config);
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }
    sessionLogger.log('ai_command', tabId, { command: result.command, explanation: result.explanation });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  try {
    const { tabId, userPrompt, command, output, exitCode, context } = req.body;
    const config = await db.getActiveAIConfig();
    if (!config) { res.status(400).json({ error: '未配置 AI 服务' }); return; }

    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal,
    };

    const result = await aiEngine.analyzeResult(userPrompt, command, output, exitCode, mergedContext, config);
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(), action: 'result',
      content: output.substring(0, 500), command, result: `退出码: ${exitCode}`,
    });

    const cmdHistory: CommandHistory = {
      command, output: output.substring(0, 1000), exitCode: exitCode ?? 1,
      timestamp: new Date().toISOString(), directory: dbContext.currentDirectory,
    };
    db.addCommandToHistory(tabId, cmdHistory);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== AI 配置管理 =====
app.get('/api/ai/configs', authMiddleware, (_req, res) => { res.json(db.getAIConfigs()); });
app.get('/api/ai/configs/active', authMiddleware, async (_req, res) => { res.json(await db.getActiveAIConfig()); });
app.get('/api/ai/configs/active-id', authMiddleware, (_req, res) => { res.json(db.getActiveAIConfigId()); });
app.get('/api/ai/configs/:id', authMiddleware, async (req, res) => { res.json(await db.getAIConfig(parseInt(req.params.id))); });
app.post('/api/ai/configs', authMiddleware, async (req, res) => {
  try { const id = await db.addAIConfig(req.body); res.json({ success: true, id }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ai/configs/:id', authMiddleware, async (req, res) => {
  try { await db.updateAIConfig(parseInt(req.params.id), req.body); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/ai/configs/:id', authMiddleware, async (req, res) => {
  try { await db.deleteAIConfig(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ai/configs/:id/activate', authMiddleware, (req, res) => {
  try { db.setActiveAIConfig(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ===== 上下文管理 =====
app.get('/api/context/:tabId', authMiddleware, (req, res) => { res.json(db.getContext(req.params.tabId)); });
app.put('/api/context/:tabId', authMiddleware, (req, res) => {
  db.updateContext(req.params.tabId, req.body);
  res.json({ success: true });
});
app.delete('/api/context/:tabId', authMiddleware, (req, res) => {
  db.clearContext(req.params.tabId);
  res.json({ success: true });
});
app.get('/api/context/:tabId/summary', authMiddleware, (req, res) => {
  res.json(db.buildHistorySummary(req.params.tabId));
});
app.post('/api/context/:tabId/task-step', authMiddleware, (req, res) => {
  db.addTaskStep(req.params.tabId, req.body);
  res.json(db.getContext(req.params.tabId));
});
app.post('/api/context/:tabId/command', authMiddleware, (req, res) => {
  db.addCommandToHistory(req.params.tabId, req.body);
  res.json(db.getContext(req.params.tabId));
});

// ===== 聊天消息 =====
app.get('/api/messages/:tabId', authMiddleware, (req, res) => { res.json(db.getMessages(req.params.tabId)); });
app.post('/api/messages/:tabId', authMiddleware, (req, res) => {
  db.saveMessage(req.params.tabId, req.body);
  res.json({ success: true });
});
app.delete('/api/messages/:tabId', authMiddleware, (req, res) => {
  db.deleteServerMessages(req.params.tabId);
  res.json({ success: true });
});

// ===== Token 预算 =====
app.get('/api/budget', authMiddleware, (_req, res) => { res.json(budgetTracker.getState()); });
app.post('/api/budget/reset', authMiddleware, (_req, res) => {
  budgetTracker.reset();
  res.json(budgetTracker.getState());
});
app.post('/api/budget/compact', authMiddleware, (req, res) => {
  const { tabId } = req.body;
  const context = db.getContext(tabId);
  const result = compactEngine.compact(context);
  const newContext = compactEngine.applyCompact(context, result);
  db.updateContext(tabId, newContext);
  budgetTracker.reduceUsage(result.tokenReduction);
  res.json({ budgetState: budgetTracker.getState(), compactResult: result });
});

// ===== 会话恢复 =====
app.get('/api/recovery/check', authMiddleware, (_req, res) => { res.json(sessionRecovery.checkRecovery()); });
app.get('/api/recovery/:tabId', authMiddleware, (req, res) => { res.json(sessionRecovery.getServerRecoveryData(req.params.tabId)); });
app.post('/api/recovery/confirm', authMiddleware, (_req, res) => {
  sessionRecovery.confirmRecovery();
  sessionLogger.log('session_start', 'app', { recovered: true });
  res.json({ success: true });
});
app.post('/api/recovery/dismiss', authMiddleware, (_req, res) => {
  sessionRecovery.dismissRecovery();
  sessionLogger.log('session_start', 'app', { recovered: false });
  res.json({ success: true });
});

// ===== 权限管理 =====
app.get('/api/permissions', authMiddleware, (_req, res) => { res.json(permissionManager.getConfig()); });
app.put('/api/permissions/mode', authMiddleware, (req, res) => {
  permissionManager.setMode(req.body.mode);
  res.json(permissionManager.getConfig());
});
app.post('/api/permissions/rules', authMiddleware, (req, res) => {
  res.json(permissionManager.addRule(req.body));
});
app.delete('/api/permissions/rules/:id', authMiddleware, (req, res) => {
  res.json(permissionManager.removeRule(req.params.id));
});

// ===== Agent 系统 =====
app.get('/api/agents', authMiddleware, (_req, res) => { res.json(agentCoordinator.getAvailableAgents()); });

app.post('/api/agents/decompose', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body;
    const tabId = context.sessionId;
    const config = await db.getActiveAIConfig();
    if (!config) { res.status(400).json({ error: '未配置 AI 服务' }); return; }

    compactEngine.setAIConfig(config);

    const budgetState = budgetTracker.getState();
    if (budgetState.shouldCompact) {
      const currentContext = db.getContext(tabId);
      const compactResult = await compactEngine.compactWithAISummary(currentContext, currentContext.taskGoal || prompt);
      const newContext = compactEngine.applyCompact(currentContext, compactResult);
      db.updateContext(tabId, newContext);
      budgetTracker.reduceUsage(compactResult.tokenReduction);
    }

    const latestContext = db.getContext(tabId);
    const updatedToolContext = { ...context, sessionContext: latestContext };
    const result = await agentCoordinator.decomposeTask(prompt, updatedToolContext, config);

    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agents/execute', authMiddleware, async (req, res) => {
  try {
    const { agentName, subTasks, context, userPrompt } = req.body;
    const config = await db.getActiveAIConfig();
    if (!config) { res.status(400).json({ error: '未配置 AI 服务' }); return; }

    const result = await agentCoordinator.executeTask(
      agentName, subTasks, context, config, userPrompt,
      (updatedSubTasks) => {
        io.to(context.sessionId).emit('agent:progress', {
          tabId: context.sessionId, subTasks: updatedSubTasks,
        });
      },
    );

    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agents/confirm', authMiddleware, (req, res) => {
  const { tabId, taskId, isConfirmed } = req.body;
  res.json(agentCoordinator.resolveConfirmation(tabId, taskId, isConfirmed));
});

// ===== 日志 =====
app.post('/api/log', authMiddleware, (req, res) => {
  const { level, scope, message, meta } = req.body;
  const { logMessage } = require('../main/logger');
  logMessage(level, scope, message, meta);
  res.json({ success: true });
});

// ===== 健康检查 =====
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ===== 静态文件服务（前端） =====
const rendererPath = path.join(__dirname, '../../out/renderer');
const fs = require('fs');

// 直接使用编译内联的 bridge 脚本（无需读取外部文件）
const bridgeScript = WEB_BRIDGE_SCRIPT;

// 同时提供独立文件访问（可选）
app.get('/web-bridge.js', (_req, res) => {
  res.type('application/javascript').send(bridgeScript);
});

// 提供静态资源
app.use(express.static(rendererPath, { index: false }));

// 注入 bridge 脚本后返回 index.html
app.get('*', (_req, res) => {
  const htmlPath = path.join(rendererPath, 'index.html');
  try {
    let html = fs.readFileSync(htmlPath, 'utf-8');
    // 内联注入 bridge 脚本（确保在任何环境下都能工作）
    html = html.replace('</head>', `<script>\n${bridgeScript}\n</script>\n</head>`);
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('前端文件未构建，请先运行 npm run build');
  }
});

// ===== Socket.io SSH Shell =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
  if (!token) { return next(new Error('未认证')); }
  try {
    jwt.verify(token, SESSION_SECRET);
    next();
  } catch {
    next(new Error('Token 无效'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket.io] 客户端连接: ${socket.id}`);

  // 加入房间（用于 Agent 进度推送）
  socket.on('join', (room: string) => {
    socket.join(room);
  });

  // SSH Shell 创建
  socket.on('ssh:shell:create', async (data: { connectionId: string; cols: number; rows: number }) => {
    const result = await serverManager.createShellSession(
      data.connectionId, data.cols, data.rows,
      (sessionId, shellData) => {
        socket.emit('ssh:shell:data', { sessionId, data: shellData });
      },
      (sessionId) => {
        socket.emit('ssh:shell:close', { sessionId });
      },
      (sessionId, error) => {
        socket.emit('ssh:shell:error', { sessionId, error });
      },
    );
    socket.emit('ssh:shell:created', result);
  });

  // SSH Shell 写入
  socket.on('ssh:shell:write', (data: { sessionId: string; data: string }) => {
    try {
      serverManager.writeToShell(data.sessionId, data.data);
    } catch (e: any) {
      socket.emit('ssh:shell:error', { sessionId: data.sessionId, error: e.message });
    }
  });

  // SSH Shell 调整大小
  socket.on('ssh:shell:resize', (data: { sessionId: string; cols: number; rows: number }) => {
    try {
      serverManager.resizeShell(data.sessionId, data.cols, data.rows);
    } catch { /* ignore */ }
  });

  // SSH Shell 关闭
  socket.on('ssh:shell:close', (data: { sessionId: string }) => {
    try {
      serverManager.closeShell(data.sessionId);
    } catch { /* ignore */ }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] 客户端断开: ${socket.id}`);
  });
});

// ===== 启动服务 =====
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║           Ops Claw Web Server                    ║
╠══════════════════════════════════════════════════╣
║  地址: http://0.0.0.0:${PORT}                      ║
║  默认密码: ${ADMIN_PASSWORD}                          ║
║                                                  ║
║  环境变量:                                        ║
║  - PORT         服务端口 (默认 3000)              ║
║  - ADMIN_PASSWORD  登录密码                       ║
║  - SESSION_SECRET  JWT 密钥                       ║
╚══════════════════════════════════════════════════╝
  `);
});

// ===== 优雅退出 =====
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  db.flush();
  serverManager.disconnectAll();
  sessionLogger.close();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获异常:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});
