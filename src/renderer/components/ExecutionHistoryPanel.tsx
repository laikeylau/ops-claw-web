import React, { useState, useEffect } from 'react';
import { toast } from './Toast';

interface ExecutionRecord {
  id: string;
  prompt: string;
  command: string;
  output: string;
  exitCode: number;
  analysis?: string;
  suggestions?: string[];
  nextCommand?: string;
  nextCommandReason?: string;
  serverName?: string;
  category?: string;
  tags?: string[];
  isFavorite: boolean;
  createdAt: string;
}

interface ExecutionHistoryPanelProps {
  visible: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  docker: '🐳',
  git: '📦',
  package: '📥',
  service: '🔧',
  database: '🗄️',
  network: '🌐',
  filesystem: '📁',
  monitoring: '📊',
  view: '👁️',
  other: '📋',
};

export const ExecutionHistoryPanel: React.FC<ExecutionHistoryPanelProps> = ({
  visible,
  onClose,
  onExecute,
}) => {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ExecutionRecord | null>(null);
  const [stats, setStats] = useState({ total: 0, favorites: 0, categories: 0, tags: 0 });

  // 加载数据
  useEffect(() => {
    if (visible) {
      loadData();
      loadCategories();
      loadTags();
      loadStats();
    }
  }, [visible]);

  // 过滤条件变化时重新加载
  useEffect(() => {
    if (visible) {
      loadRecords();
    }
  }, [selectedCategory, selectedTag, showFavoritesOnly]);

  const loadData = async () => {
    await loadRecords();
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const options: any = { limit: 50 };
      if (selectedCategory) options.category = selectedCategory;
      if (selectedTag) options.tag = selectedTag;
      if (searchQuery) options.search = searchQuery;
      if (showFavoritesOnly) options.favoritesOnly = true;

      const result = await window.electronAPI.historyList(options);
      setRecords(result.records);
      setTotal(result.total);
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
    setLoading(false);
  };

  const loadCategories = async () => {
    try {
      const data = await window.electronAPI.historyCategories();
      setCategories(data);
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };

  const loadTags = async () => {
    try {
      const data = await window.electronAPI.historyTags();
      setTags(data);
    } catch (error) {
      console.error('加载标签失败:', error);
    }
  };

  const loadStats = async () => {
    try {
      const data = await window.electronAPI.historyStats();
      setStats(data);
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  };

  // 搜索
  const handleSearch = () => {
    loadRecords();
  };

  // 切换收藏
  const handleToggleFavorite = async (id: string) => {
    try {
      const result = await window.electronAPI.historyToggleFavorite(id);
      // 更新列表中的记录
      setRecords(prev => prev.map(r =>
        r.id === id ? { ...r, isFavorite: result.isFavorite } : r
      ));
      if (selectedRecord?.id === id) {
        setSelectedRecord(prev => prev ? { ...prev, isFavorite: result.isFavorite } : null);
      }
      loadStats();
      toast.success(result.isFavorite ? '已收藏' : '已取消收藏');
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 删除记录
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    try {
      await window.electronAPI.historyDelete(id);
      setRecords(prev => prev.filter(r => r.id !== id));
      if (selectedRecord?.id === id) {
        setSelectedRecord(null);
      }
      loadStats();
      toast.success('已删除');
    } catch (error) {
      toast.error('删除失败');
    }
  };

  // 清空历史
  const handleClearHistory = async () => {
    const keepFavorites = confirm('是否保留收藏的记录？\n\n确定 = 保留收藏\n取消 = 全部清空');
    try {
      await window.electronAPI.historyClear(keepFavorites);
      loadRecords();
      loadStats();
      toast.success('历史记录已清空');
    } catch (error) {
      toast.error('清空失败');
    }
  };

  // 执行命令
  const handleExecute = (command: string) => {
    onExecute(command);
    onClose();
  };

  // 复制命令
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制到剪贴板');
    } catch (error) {
      toast.error('复制失败');
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 截断文本
  const truncate = (text: string, maxLen: number) => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-xl">📜</span>
            <h3 className="font-bold text-lg text-gray-800">执行历史</h3>
            <span className="text-sm text-gray-500">({stats.total} 条记录)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearHistory}
              className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              清空历史
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* 搜索和筛选 */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="flex gap-3 mb-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索命令、输出、分析..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-green-500"
              />
              <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600"
            >
              搜索
            </button>
            <button
              onClick={() => { setShowFavoritesOnly(!showFavoritesOnly); }}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                showFavoritesOnly
                  ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              ⭐ {stats.favorites > 0 && `(${stats.favorites})`}
            </button>
          </div>

          {/* 分类和标签 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory('')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !selectedCategory
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? '' : cat)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {CATEGORY_ICONS[cat] || '📋'} {cat}
              </button>
            ))}
            {tags.length > 0 && (
              <>
                <span className="text-gray-300">|</span>
                {tags.slice(0, 8).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      selectedTag === tag
                        ? 'bg-blue-500 text-white'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧记录列表 */}
          <div className="w-[380px] border-r border-gray-100 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <span className="animate-spin mr-2">⏳</span> 加载中...
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                暂无执行记录
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {records.map(record => (
                  <div
                    key={record.id}
                    onClick={() => setSelectedRecord(record)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedRecord?.id === record.id
                        ? 'bg-green-50 border border-green-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          record.exitCode === 0
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {record.exitCode === 0 ? '✓' : '✕'}
                        </span>
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {truncate(record.prompt, 30)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {record.isFavorite && <span className="text-yellow-500">⭐</span>}
                        <span className="text-[10px] text-gray-400">
                          {formatTime(record.createdAt)}
                        </span>
                      </div>
                    </div>
                    <pre className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded mt-1 truncate">
                      $ {truncate(record.command, 40)}
                    </pre>
                    {record.serverName && (
                      <span className="text-[10px] text-gray-400 mt-1 inline-block">
                        🖥️ {record.serverName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 flex flex-col">
            {selectedRecord ? (
              <>
                <div className="flex-1 p-5 overflow-y-auto space-y-4">
                  {/* 用户输入 */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">用户输入</label>
                    <div className="bg-blue-50 text-blue-800 px-3 py-2 rounded-lg text-sm">
                      {selectedRecord.prompt}
                    </div>
                  </div>

                  {/* 执行命令 */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">执行命令</label>
                      <button
                        onClick={() => handleCopy(selectedRecord.command)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        复制
                      </button>
                    </div>
                    <pre className="bg-gray-900 text-green-400 px-3 py-2 rounded-lg text-sm font-mono">
                      $ {selectedRecord.command}
                    </pre>
                  </div>

                  {/* 命令输出 */}
                  {selectedRecord.output && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-500">输出结果</label>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          selectedRecord.exitCode === 0
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          退出码: {selectedRecord.exitCode}
                        </span>
                      </div>
                      <pre className="bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-xs font-mono max-h-40 overflow-y-auto">
                        {selectedRecord.output}
                      </pre>
                    </div>
                  )}

                  {/* AI 分析 */}
                  {selectedRecord.analysis && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">AI 分析</label>
                      <div className="bg-purple-50 text-purple-800 px-3 py-2 rounded-lg text-sm">
                        {selectedRecord.analysis}
                      </div>
                    </div>
                  )}

                  {/* 建议 */}
                  {selectedRecord.suggestions && selectedRecord.suggestions.length > 0 && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">建议</label>
                      <ul className="space-y-1">
                        {selectedRecord.suggestions.map((s, i) => (
                          <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                            <span className="text-blue-500 shrink-0">{i + 1}.</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 下一步命令 */}
                  {selectedRecord.nextCommand && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">推荐下一步</label>
                      {selectedRecord.nextCommandReason && (
                        <p className="text-xs text-gray-500 mb-1">{selectedRecord.nextCommandReason}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <pre className="flex-1 bg-amber-50 text-amber-800 px-3 py-2 rounded-lg text-sm font-mono">
                          $ {selectedRecord.nextCommand}
                        </pre>
                        <button
                          onClick={() => handleExecute(selectedRecord.nextCommand!)}
                          className="px-3 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600"
                        >
                          执行
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 标签 */}
                  {selectedRecord.tags && selectedRecord.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRecord.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="px-5 py-4 border-t border-gray-100 flex justify-between">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleFavorite(selectedRecord.id)}
                      className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                        selectedRecord.isFavorite
                          ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {selectedRecord.isFavorite ? '⭐ 已收藏' : '☆ 收藏'}
                    </button>
                    <button
                      onClick={() => handleDelete(selectedRecord.id)}
                      className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopy(selectedRecord.command)}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      复制命令
                    </button>
                    <button
                      onClick={() => handleExecute(selectedRecord.command)}
                      className="px-5 py-2 text-sm text-white bg-green-500 rounded-md hover:bg-green-600"
                    >
                      重新执行
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                ← 选择一条记录查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
