import { create } from 'zustand';
import { useMemo } from 'react';

interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  type: 'linux' | 'windows';
}

interface Tab {
  id: string;
  serverId: number;
  serverName: string;
  serverType: 'linux' | 'windows';
  messages: Message[];
  isConnected: boolean;
  connectionId?: string;
  shellSessionId?: string;
  shellStatus?: 'idle' | 'creating' | 'ready' | 'closed' | 'error';
}

/**
 * 优化的选择器 hooks - 避免不必要的重渲染
 * 只有当真正使用的状态变化时才触发重渲染
 */
export function useActiveTab() {
  const activeTabId = useAppStore(state => state.activeTabId);
  const tabs = useAppStore(state => state.tabs);
  return useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);
}

export function useActiveTabMessages() {
  const activeTab = useActiveTab();
  return activeTab?.messages || [];
}

export function useIsConnected() {
  const activeTab = useActiveTab();
  return activeTab?.isConnected || false;
}

export function useShellStatus() {
  const activeTab = useActiveTab();
  return activeTab?.shellStatus || 'idle';
}

export function useMode() {
  return useAppStore(state => state.mode);
}

export function useServers() {
  return useAppStore(state => state.servers);
}

export function useTabs() {
  return useAppStore(state => state.tabs);
}

export function useActiveTabId() {
  return useAppStore(state => state.activeTabId);
}

export function useInputValue() {
  return useAppStore(state => state.inputValue);
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  command?: string;
  output?: string;
  exitCode?: number;
  timestamp: Date;
  analysis?: string;
  suggestions?: string[];
  nextCommand?: string;
  nextCommandReason?: string;
  agentResult?: any;
}

interface AppState {
  servers: ServerConfig[];
  tabs: Tab[];
  activeTabId: string | null;
  inputValue: string;
  mode: 'manual' | 'ai';

  // Actions
  setServers: (servers: ServerConfig[]) => void;
  addTab: (tab: Tab) => void;
  setTabs: (tabs: Tab[]) => void;
  removeTab: (tabId: string) => void;
  clearTabs: () => void;
  setActiveTab: (tabId: string | null) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  clearMessages: (tabId: string) => void;
  addMessage: (tabId: string, message: Message) => void;
  updateLastMessage: (tabId: string, updates: Partial<Message>) => void;
  updateMessageById: (tabId: string, messageId: string, updates: Partial<Message>) => void;
  setInputValue: (value: string) => void;
  setMode: (mode: 'manual' | 'ai') => void;
}

export const useAppStore = create<AppState>((set) => ({
  servers: [],
  tabs: [],
  activeTabId: null,
  inputValue: '',
  mode: 'manual',

  setServers: (servers) => set({ servers }),
  addTab: (tab) => set((state) => ({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id
  })),
  setTabs: (tabs) => set({ tabs }),
  removeTab: (tabId) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== tabId);
    return {
      tabs: newTabs,
      activeTabId: state.activeTabId === tabId
        ? (newTabs.length > 0 ? newTabs[0].id : null)
        : state.activeTabId
    };
  }),
  clearTabs: () => set({ tabs: [], activeTabId: null }),
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  updateTab: (tabId, updates) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } : tab
    )
  })),
  clearMessages: (tabId) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, messages: [] } : tab
    )
  })),
  addMessage: (tabId, message) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId
        ? { ...tab, messages: [...tab.messages, message] }
        : tab
    )
  })),
  updateLastMessage: (tabId: string, updates) => set((state) => ({
    tabs: state.tabs.map(tab => {
      if (tab.id !== tabId || tab.messages.length === 0) return tab;
      const newMessages = [...tab.messages];
      const lastMessage = newMessages[newMessages.length - 1];
      newMessages[newMessages.length - 1] = { ...lastMessage, ...updates };
      return { ...tab, messages: newMessages };
    })
  })),
  updateMessageById: (tabId: string, messageId: string, updates) => set((state) => ({
    tabs: state.tabs.map(tab => {
      if (tab.id !== tabId) return tab;
      return {
        ...tab,
        messages: tab.messages.map(msg =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        )
      };
    })
  })),
  setInputValue: (value) => set({ inputValue: value }),
  setMode: (mode) => set({ mode }),
}));
