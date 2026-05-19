import { useState, useCallback, useMemo } from 'react';

/**
 * 命令自动补全 Hook
 * 
 * 功能：
 * 1. 基于历史命令补全
 * 2. 基于常用命令补全
 * 3. 路径补全
 * 4. 智能排序
 */

interface CommandCompletionOptions {
  historyCommands?: string[];
  maxSuggestions?: number;
  enablePathCompletion?: boolean;
}

// 常用命令列表
const COMMON_COMMANDS = [
  // 文件操作
  'ls', 'ls -la', 'ls -lh', 'cd', 'pwd', 'mkdir', 'rmdir', 'rm', 'rm -rf',
  'cp', 'mv', 'ln', 'touch', 'cat', 'less', 'head', 'tail', 'grep', 'find',
  'chmod', 'chown', 'chgrp', 'du', 'df',
  
  // 系统信息
  'uname -a', 'uptime', 'whoami', 'id', 'date', 'cal',
  'free -h', 'top', 'htop', 'ps aux', 'ps aux | grep',
  
  // 网络
  'ping', 'traceroute', 'netstat', 'ss', 'ip addr', 'ifconfig',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  
  // Docker
  'docker ps', 'docker ps -a', 'docker images', 'docker logs',
  'docker exec -it', 'docker run', 'docker stop', 'docker rm',
  'docker-compose up', 'docker-compose down', 'docker-compose logs',
  
  // 系统服务
  'systemctl status', 'systemctl start', 'systemctl stop', 'systemctl restart',
  'systemctl enable', 'systemctl disable', 'journalctl',
  
  // 包管理
  'apt update', 'apt upgrade', 'apt install', 'apt remove',
  'yum update', 'yum install', 'yum remove',
  'pip install', 'npm install', 'yarn add',
  
  // Git
  'git status', 'git add', 'git commit', 'git push', 'git pull',
  'git log', 'git diff', 'git branch', 'git checkout', 'git merge',
  
  // 压缩
  'tar -czf', 'tar -xzf', 'tar -xjf', 'zip', 'unzip', 'gzip', 'gunzip',
  
  // 文本处理
  'awk', 'sed', 'sort', 'uniq', 'wc', 'cut', 'tr',
];

export function useCommandCompletion(options: CommandCompletionOptions = {}) {
  const {
    historyCommands = [],
    maxSuggestions = 10,
    enablePathCompletion = true,
  } = options;

  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 合并历史命令和常用命令
  const allCommands = useMemo(() => {
    const commandSet = new Set<string>();
    
    // 历史命令优先
    for (const cmd of historyCommands) {
      commandSet.add(cmd.trim());
    }
    
    // 常用命令
    for (const cmd of COMMON_COMMANDS) {
      commandSet.add(cmd);
    }
    
    return Array.from(commandSet);
  }, [historyCommands]);

  // 计算建议
  const suggestions = useMemo(() => {
    if (!inputValue.trim()) {
      return [];
    }

    const input = inputValue.trim().toLowerCase();
    const words = inputValue.split(' ');
    const currentWord = words[words.length - 1] || '';

    // 如果是第一个词，补全命令
    if (words.length <= 1) {
      return allCommands
        .filter(cmd => cmd.toLowerCase().startsWith(input))
        .slice(0, maxSuggestions)
        .map(cmd => ({
          value: cmd,
          label: cmd,
          type: 'command' as const,
        }));
    }

    // 如果是后续词，尝试路径补全
    if (enablePathCompletion && currentWord.startsWith('/') || currentWord.startsWith('./') || currentWord.startsWith('~/')) {
      // 路径补全需要后端支持，这里返回空
      return [];
    }

    // 基于上下文的补全
    const baseCommand = words[0];
    return allCommands
      .filter(cmd => cmd.startsWith(baseCommand) && cmd !== baseCommand)
      .map(cmd => cmd.slice(baseCommand.length).trim())
      .filter(part => part.toLowerCase().includes(currentWord.toLowerCase()))
      .slice(0, maxSuggestions)
      .map(part => ({
        value: `${baseCommand} ${part}`,
        label: `${baseCommand} ${part}`,
        type: 'argument' as const,
      }));
  }, [inputValue, allCommands, maxSuggestions, enablePathCompletion]);

  // 选择建议
  const selectSuggestion = useCallback((index: number) => {
    if (index >= 0 && index < suggestions.length) {
      setInputValue(suggestions[index].value);
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  }, [suggestions]);

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
        
      case 'Tab':
      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault();
          selectSuggestion(selectedIndex);
        }
        break;
        
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  }, [showSuggestions, suggestions, selectedIndex, selectSuggestion]);

  // 输入变化
  const handleChange = useCallback((value: string) => {
    setInputValue(value);
    setShowSuggestions(value.trim().length > 0);
    setSelectedIndex(-1);
  }, []);

  return {
    inputValue,
    suggestions,
    selectedIndex,
    showSuggestions,
    handleChange,
    handleKeyDown,
    selectSuggestion,
    setShowSuggestions,
  };
}

/**
 * 命令历史导航 Hook
 */
export function useCommandHistory(history: string[]) {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentInput, setCurrentInput] = useState('');

  const navigateUp = useCallback((currentValue: string) => {
    if (history.length === 0) return currentValue;

    // 保存当前输入
    if (historyIndex === -1) {
      setCurrentInput(currentValue);
    }

    const newIndex = historyIndex < history.length - 1 
      ? historyIndex + 1 
      : history.length - 1;
    
    setHistoryIndex(newIndex);
    return history[history.length - 1 - newIndex];
  }, [history, historyIndex]);

  const navigateDown = useCallback(() => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      return currentInput;
    }

    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    return history[history.length - 1 - newIndex];
  }, [history, historyIndex, currentInput]);

  const reset = useCallback(() => {
    setHistoryIndex(-1);
    setCurrentInput('');
  }, []);

  return {
    navigateUp,
    navigateDown,
    reset,
    historyIndex,
  };
}
