import { useEffect, useCallback, useRef } from 'react';

/**
 * 快捷键配置
 */
export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  action: () => void;
  preventDefault?: boolean;
}

/**
 * 快捷键管理 Hook
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    // 忽略输入框中的快捷键（除非是全局快捷键）
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    for (const shortcut of shortcutsRef.current) {
      const ctrlMatch = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const altMatch = shortcut.alt ? event.altKey : !event.altKey;
      const metaMatch = shortcut.meta ? event.metaKey : true;

      if (
        event.key.toLowerCase() === shortcut.key.toLowerCase() &&
        ctrlMatch &&
        shiftMatch &&
        altMatch &&
        metaMatch
      ) {
        // 如果在输入框中，只处理 Ctrl/Cmd 开头的快捷键
        if (isInput && !shortcut.ctrl && !shortcut.meta) {
          continue;
        }

        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.action();
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * 预设快捷键配置
 */
export const DEFAULT_SHORTCUTS = {
  // 终端操作
  CLEAR_TERMINAL: {
    key: 'l',
    ctrl: true,
    description: '清屏',
  },
  COPY_SELECTION: {
    key: 'c',
    ctrl: true,
    description: '复制选中文本',
  },
  PASTE: {
    key: 'v',
    ctrl: true,
    description: '粘贴',
  },
  
  // 标签页操作
  NEW_TAB: {
    key: 't',
    ctrl: true,
    description: '新建标签页',
  },
  CLOSE_TAB: {
    key: 'w',
    ctrl: true,
    description: '关闭标签页',
  },
  NEXT_TAB: {
    key: 'Tab',
    ctrl: true,
    description: '下一个标签页',
  },
  PREV_TAB: {
    key: 'Tab',
    ctrl: true,
    shift: true,
    description: '上一个标签页',
  },
  
  // 模式切换
  TOGGLE_MODE: {
    key: 'm',
    ctrl: true,
    description: '切换 AI/人工模式',
  },
  
  // AI 操作
  SEND_MESSAGE: {
    key: 'Enter',
    description: '发送消息',
  },
  NEW_LINE: {
    key: 'Enter',
    shift: true,
    description: '换行',
  },
  
  // 界面操作
  TOGGLE_SIDEBAR: {
    key: 'b',
    ctrl: true,
    description: '切换侧边栏',
  },
  TOGGLE_THEME: {
    key: 'd',
    ctrl: true,
    description: '切换主题',
  },
  FOCUS_INPUT: {
    key: '/',
    description: '聚焦输入框',
  },
  
  // 历史操作
  COMMAND_HISTORY_UP: {
    key: 'ArrowUp',
    description: '上一条历史命令',
  },
  COMMAND_HISTORY_DOWN: {
    key: 'ArrowDown',
    description: '下一条历史命令',
  },
};

/**
 * 快捷键提示组件
 */
interface ShortcutHintProps {
  shortcut: KeyboardShortcut;
  className?: string;
}

export function ShortcutHint({ shortcut, className = '' }: ShortcutHintProps) {
  const parts: string[] = [];
  
  if (shortcut.ctrl || shortcut.meta) {
    parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push('Shift');
  }
  if (shortcut.alt) {
    parts.push('Alt');
  }
  
  // 格式化按键名称
  const keyName = shortcut.key
    .replace('Enter', '↵')
    .replace('Tab', '⇥')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Escape', 'Esc')
    .replace(' ', 'Space');
  
  parts.push(keyName);

  return (
    <kbd className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded ${className}`}>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="text-gray-400 mx-0.5">+</span>}
          {part}
        </span>
      ))}
    </kbd>
  );
}

/**
 * 快捷键帮助面板
 */
interface ShortcutHelpPanelProps {
  shortcuts: Array<KeyboardShortcut & { category?: string }>;
  onClose: () => void;
}

export function ShortcutHelpPanel({ shortcuts, onClose }: ShortcutHelpPanelProps) {
  // 按分类分组
  const grouped = shortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category || '其他';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">⌨️ 键盘快捷键</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-6">
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">{category}</h4>
              <div className="space-y-2">
                {items.map((shortcut, index) => (
                  <div key={index} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{shortcut.description}</span>
                    <ShortcutHint shortcut={shortcut} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            提示：在输入框中，只有 Ctrl/Cmd 组合键才会生效
          </p>
        </div>
      </div>
    </div>
  );
}
