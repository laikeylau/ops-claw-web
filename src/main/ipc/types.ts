import { BrowserWindow } from 'electron';
import { ServerManager } from '../server-manager';
import { AIEngine, AIContext } from '../ai-engine';
import { DatabaseManager } from '../database';
import { SecurityAnalyzer } from '../tools/SecurityAnalyzer';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutor } from '../tools/ToolExecutor';
import { TokenBudgetTracker } from '../context/TokenBudget';
import { CompactEngine } from '../context/CompactEngine';
import { SessionLogger } from '../recovery/SessionLogger';
import { SessionRecovery } from '../recovery/SessionRecovery';
import { PermissionManager } from '../tools/PermissionManager';
import { AgentCoordinator } from '../agents/AgentCoordinator';
import { SubTask } from '../agents/Agent';
import { ToolUseContext } from '../types/tool-context';
import { CommandLearner } from '../command-learner';
import { StreamingManager } from '../streaming-manager';
import { MemoryManager } from '../memory-manager';
import { RdpManager } from '../rdp-manager';

/**
 * IPC Handler 依赖注入接口
 * 所有 IPC 模块共享同一组依赖实例
 */
export interface IpcDependencies {
  mainWindow: BrowserWindow | null;
  serverManager: ServerManager;
  aiEngine: AIEngine;
  db: DatabaseManager;
  securityAnalyzer: SecurityAnalyzer;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  budgetTracker: TokenBudgetTracker;
  compactEngine: CompactEngine;
  sessionLogger: SessionLogger;
  sessionRecovery: SessionRecovery;
  permissionManager: PermissionManager;
  agentCoordinator: AgentCoordinator;
  commandLearner: CommandLearner;
  streamingManager: StreamingManager;
  memoryManager: MemoryManager;
  rdpManager: RdpManager;
}
