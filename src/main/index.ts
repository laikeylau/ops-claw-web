import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { ServerManager } from './server-manager';
import { AIEngine } from './ai-engine';
import { DatabaseManager } from './database';
import { getLogPaths, initializeLogger, logError, logInfo, serializeError } from './logger';
import { SecurityAnalyzer } from './tools/SecurityAnalyzer';
import { ToolRegistry } from './tools/ToolRegistry';
import { ToolExecutor } from './tools/ToolExecutor';
import { SSHExecuteTool } from './tools/implementations/SSHExecuteTool';
import { SSHShellExecuteTool } from './tools/implementations/SSHShellExecuteTool';
import { AIGenerateTool } from './tools/implementations/AIGenerateTool';
import { TokenBudgetTracker } from './context/TokenBudget';
import { CompactEngine } from './context/CompactEngine';
import { SessionLogger } from './recovery/SessionLogger';
import { SessionRecovery } from './recovery/SessionRecovery';
import { PermissionManager } from './tools/PermissionManager';
import { AgentCoordinator } from './agents/AgentCoordinator';
import { initializeAgentSystem } from './agents';
import { CommandLearner } from './command-learner';
import { StreamingManager } from './streaming-manager';
import { MemoryManager } from './memory-manager';
import { RdpManager } from './rdp-manager';
import { registerRdpIpcHandlers } from './ipc/rdp-ipc';

// IPC Handler 模块（按领域拆分）
import { IpcDependencies } from './ipc/types';
import { registerSystemIpcHandlers } from './ipc/system-ipc';
import { registerServerIpcHandlers } from './ipc/server-ipc';
import { registerAiIpcHandlers } from './ipc/ai-ipc';
import { registerContextIpcHandlers } from './ipc/context-ipc';
import { registerAgentIpcHandlers } from './ipc/agent-ipc';
import { registerMemoryIpcHandlers } from './ipc/memory-ipc';
import { registerTemplateIpcHandlers } from './ipc/template-ipc';
import { registerExecutionHistoryIpcHandlers } from './ipc/history-ipc';

let mainWindow: BrowserWindow | null = null;
let serverManager: ServerManager;
let aiEngine: AIEngine;
let db: DatabaseManager;
let securityAnalyzer: SecurityAnalyzer;
let toolRegistry: ToolRegistry;
let toolExecutor: ToolExecutor;
let budgetTracker: TokenBudgetTracker;
let compactEngine: CompactEngine;
let sessionLogger: SessionLogger;
let sessionRecovery: SessionRecovery;
let permissionManager: PermissionManager;
let agentCoordinator: AgentCoordinator;
let commandLearner: CommandLearner;
let streamingManager: StreamingManager;
let memoryManager: MemoryManager;
let rdpManager: RdpManager;
let commandTemplates: CommandTemplateManager;
let executionHistory: ExecutionHistoryManager;

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 防止页面导航跳转（解决输入命令后页面变空白的问题）
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // 阻止新窗口打开
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 使用 app.isPackaged 检测开发/生产模式 (比 NODE_ENV 更可靠)
  // 开发模式: app.isPackaged = false
  // 生产模式: app.isPackaged = true (打包后)
  if (!app.isPackaged) {
    const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    mainWindow.loadURL(url);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'right' });
    });
  } else {
    // 生产模式: 加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  initializeLogger();
  logInfo('app', '应用启动');

  db = new DatabaseManager();
  serverManager = new ServerManager();
  aiEngine = new AIEngine();
  securityAnalyzer = new SecurityAnalyzer();

  // 初始化权限管理器
  permissionManager = new PermissionManager();

  // 初始化工具系统
  toolRegistry = new ToolRegistry();
  toolExecutor = new ToolExecutor(toolRegistry, securityAnalyzer, permissionManager);

  // 注册内置工具
  toolRegistry.register(new SSHExecuteTool(serverManager));
  toolRegistry.register(new SSHShellExecuteTool(serverManager));
  toolRegistry.register(new AIGenerateTool(aiEngine));

  // 初始化 Token 预算与压缩引擎
  budgetTracker = new TokenBudgetTracker();
  compactEngine = new CompactEngine(budgetTracker);

  // 初始化会话恢复
  sessionLogger = new SessionLogger();
  sessionRecovery = new SessionRecovery(sessionLogger);

  // 初始化 Agent 系统
  agentCoordinator = initializeAgentSystem(toolExecutor, toolRegistry, aiEngine);

  // 初始化命令学习器
  commandLearner = new CommandLearner();

  // 初始化流式响应管理器
  streamingManager = new StreamingManager();

  // 初始化内存管理器
  memoryManager = new MemoryManager(db);

  // 初始化 RDP 管理器
  rdpManager = new RdpManager();

  // 初始化命令模板管理器
  commandTemplates = new CommandTemplateManager();

  // 初始化执行历史管理器
  executionHistory = new ExecutionHistoryManager();

  createWindow();

  // 设置主窗口引用
  streamingManager.setMainWindow(mainWindow);

  // 注册 IPC Handlers（按领域拆分到独立模块）
  const deps: IpcDependencies = {
    mainWindow, serverManager, aiEngine, db, securityAnalyzer,
    toolRegistry, toolExecutor, budgetTracker, compactEngine,
    sessionLogger, sessionRecovery, permissionManager, agentCoordinator,
    commandLearner, streamingManager, memoryManager, rdpManager,
    commandTemplates,
    executionHistory,
  };
  registerSystemIpcHandlers(deps);
  registerServerIpcHandlers(deps);
  registerAiIpcHandlers(deps);
  registerContextIpcHandlers(deps);
  registerAgentIpcHandlers(deps);
  registerMemoryIpcHandlers(deps);
  registerRdpIpcHandlers(deps);
  registerTemplateIpcHandlers(deps);
  registerExecutionHistoryIpcHandlers(deps);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logInfo('app', '所有窗口已关闭');
  // 记录会话正常结束
  sessionLogger?.log('session_end', 'app', { reason: 'window_closed' });
  sessionLogger?.close();
  // 立即写入数据库（绕过 debounce，防止数据丢失）
  db?.flush();
  serverManager?.disconnectAll();
  rdpManager?.disconnectAll();
  // 清理管理器
  streamingManager?.destroy();
  memoryManager?.destroy();
  rdpManager?.cleanup();
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  logError('process', '未捕获异常', serializeError(error));
});

process.on('unhandledRejection', (reason) => {
  logError('process', '未处理的 Promise 拒绝', serializeError(reason));
});

