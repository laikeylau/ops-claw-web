import { useRef, useCallback, useEffect } from 'react';

/**
 * 安全分析 Worker Hook
 * 
 * 将安全分析任务移到 Web Worker，避免阻塞 UI
 */

interface AnalysisResult {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation: boolean;
  blocked: boolean;
  reason: string;
  warnings: string[];
  matchedPattern?: string;
}

interface PendingRequest {
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export function useSecurityWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const idRef = useRef(0);

  // 初始化 Worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL('./security.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (e: MessageEvent) => {
        const { type, id, result, results, message } = e.data;
        const pending = pendingRef.current.get(id);

        if (!pending) return;

        clearTimeout(pending.timeout);
        pendingRef.current.delete(id);

        if (type === 'result') {
          pending.resolve(result);
        } else if (type === 'batchResult') {
          pending.resolve(results);
        } else if (type === 'error') {
          pending.reject(new Error(message));
        }
      };

      workerRef.current.onerror = (e) => {
        console.error('Security worker error:', e);
        // 拒绝所有待处理的请求
        for (const [id, pending] of pendingRef.current) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Worker error'));
        }
        pendingRef.current.clear();
      };
    } catch (error) {
      console.error('Failed to create security worker:', error);
    }

    return () => {
      workerRef.current?.terminate();
      // 清理待处理的请求
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timeout);
      }
      pendingRef.current.clear();
    };
  }, []);

  // 分析单个命令
  const analyzeCommand = useCallback((command: string, timeout = 5000): Promise<AnalysisResult> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        // Worker 不可用时回退到主线程分析
        return fallbackAnalyze(command, resolve);
      }

      const id = `cmd_${++idRef.current}`;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        // 超时时回退到主线程分析
        fallbackAnalyze(command, resolve);
      }, timeout);

      pendingRef.current.set(id, { resolve, reject, timeout: timer });

      workerRef.current.postMessage({
        type: 'analyze',
        payload: { id, command },
      });
    });
  }, []);

  // 批量分析命令
  const analyzeBatch = useCallback((commands: string[], timeout = 10000): Promise<AnalysisResult[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        // Worker 不可用时回退到主线程分析
        return fallbackAnalyzeBatch(commands, resolve);
      }

      const id = `batch_${++idRef.current}`;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        fallbackAnalyzeBatch(commands, resolve);
      }, timeout);

      pendingRef.current.set(id, { 
        resolve: resolve as any, 
        reject, 
        timeout: timer 
      });

      workerRef.current.postMessage({
        type: 'analyzeBatch',
        payload: { id, commands },
      });
    });
  }, []);

  return {
    analyzeCommand,
    analyzeBatch,
  };
}

// 主线程回退分析（简单版本）
function fallbackAnalyze(command: string, resolve: (result: AnalysisResult) => void) {
  const dangerousPatterns = [
    { pattern: /\brm\s+(-[rf]+\s+)*\//i, level: 'critical', reason: '删除根目录' },
    { pattern: /\bmkfs\b/i, level: 'critical', reason: '格式化文件系统' },
    { pattern: /\brm\s+-rf\b/i, level: 'high', reason: '递归强制删除' },
    { pattern: /\bchmod\s+777\b/i, level: 'high', reason: '危险权限设置' },
    { pattern: /\bshutdown\b/i, level: 'medium', reason: '关机' },
    { pattern: /\breboot\b/i, level: 'medium', reason: '重启' },
  ];

  const safePatterns = [
    /^ls/, /^pwd/, /^whoami/, /^cat/, /^grep/, /^find/,
    /^docker\s+ps/, /^git\s+status/,
  ];

  const trimmed = command.trim();

  // 检查安全命令
  for (const pattern of safePatterns) {
    if (pattern.test(trimmed)) {
      resolve({
        level: 'safe',
        requiresConfirmation: false,
        blocked: false,
        reason: '安全命令',
        warnings: [],
      });
      return;
    }
  }

  // 检查危险模式
  for (const { pattern, level, reason } of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      resolve({
        level: level as any,
        requiresConfirmation: level === 'medium' || level === 'high',
        blocked: level === 'critical',
        reason,
        warnings: [reason],
        matchedPattern: pattern.source,
      });
      return;
    }
  }

  // 默认
  resolve({
    level: 'low',
    requiresConfirmation: false,
    blocked: false,
    reason: '未识别的命令',
    warnings: [],
  });
}

function fallbackAnalyzeBatch(commands: string[], resolve: (results: AnalysisResult[]) => void) {
  const results: AnalysisResult[] = [];
  let processed = 0;

  for (const command of commands) {
    fallbackAnalyze(command, (result) => {
      results.push(result);
      processed++;
      if (processed === commands.length) {
        resolve(results);
      }
    });
  }
}
