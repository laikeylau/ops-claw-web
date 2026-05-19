import React, { useState, useEffect } from 'react';
import { toast } from './Toast';

interface AIConfigItem {
  id: number;
  name: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  isDefault?: boolean;
  createdAt?: string;
}

interface AIConfigDialogProps {
  onClose: () => void;
}

/** 预设 AI 提供商配置 */
interface ProviderPreset {
  name: string;
  endpoint: string;
  models: string[];
  description: string;
  icon: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: '小米 MiMo',
    endpoint: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: ['MiMo-V2.5-Pro', 'MiMo-V2.5', 'MiMo-V2-Pro', 'MiMo-V2-Omni', 'MiMo-V2.5-TTS', 'MiMo-V2.5-TTS-VoiceClone'],
    description: '小米 MiMo 大模型，兼容 OpenAI/Anthropic 接口，非高峰期 0.8x 系数',
    icon: '📱',
  },
  {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    description: 'GPT 系列模型',
    icon: '🤖',
  },
  {
    name: 'Claude (Anthropic)',
    endpoint: 'https://api.anthropic.com/v1',
    models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    description: 'Claude 系列模型',
    icon: '🧠',
  },
  {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    description: 'DeepSeek 模型',
    icon: '🔍',
  },
  {
    name: '智谱 AI (GLM)',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    description: 'GLM 系列模型',
    icon: '💡',
  },
  {
    name: '百度文心',
    endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1',
    models: ['ernie-4.0', 'ernie-3.5', 'ernie-speed'],
    description: '文心一言系列',
    icon: '🐻',
  },
  {
    name: '阿里通义',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    description: '通义千问系列',
    icon: '☁️',
  },
  {
    name: '月之暗面 (Kimi)',
    endpoint: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: 'Kimi 系列模型',
    icon: '🌙',
  },
  {
    name: 'Ollama (本地)',
    endpoint: 'http://localhost:11434/v1',
    models: ['llama2', 'mistral', 'qwen2', 'yi'],
    description: '本地部署模型',
    icon: '🏠',
  },
];

interface ConfirmDialogState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export const AIConfigDialog: React.FC<AIConfigDialogProps> = ({ onClose }) => {
  const [configs, setConfigs] = useState<AIConfigItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editingConfig, setEditingConfig] = useState<AIConfigItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', endpoint: '', apiKey: '', model: '' });
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // 加载配置列表
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const list = await window.electronAPI.aiListConfigs();
      setConfigs(list);
      const currentId = await window.electronAPI.aiGetActiveConfigId();
      setActiveId(currentId);
    } catch {
      // ignore
    }
  };

  const openAddForm = () => {
    setForm({ name: '', endpoint: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-3.5-turbo' });
    setSelectedProvider('');
    setEditingConfig(null);
    setShowForm(true);
  };

  /** 选择预设提供商 */
  const selectProvider = (providerName: string) => {
    const provider = PROVIDER_PRESETS.find(p => p.name === providerName);
    if (provider) {
      setForm({
        name: provider.name,
        endpoint: provider.endpoint,
        apiKey: '',
        model: provider.models[0],
      });
      setSelectedProvider(providerName);
    }
  };

  const openEditForm = async (config: AIConfigItem) => {
    try {
      const fullConfig = await window.electronAPI.aiGetConfig(config.id);
      setForm({
        name: fullConfig.name,
        endpoint: fullConfig.endpoint,
        apiKey: fullConfig.apiKey || '',
        model: fullConfig.model,
      });
      setEditingConfig(config);
      setShowForm(true);
    } catch {
      toast.error('获取配置失败');
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('请输入配置名称');
      return;
    }
    if (!form.endpoint.trim()) {
      toast.error('请输入 API 端点');
      return;
    }
    if (!form.model.trim()) {
      toast.error('请输入模型名称');
      return;
    }

    setLoading(true);
    try {
      if (editingConfig) {
        await window.electronAPI.aiUpdateConfig(editingConfig.id, {
          name: form.name,
          endpoint: form.endpoint,
          apiKey: form.apiKey,
          model: form.model,
        });
        toast.success('配置已更新');
      } else {
        await window.electronAPI.aiAddConfig({
          name: form.name,
          endpoint: form.endpoint,
          apiKey: form.apiKey,
          model: form.model,
        });
        toast.success('配置已添加');
      }
      await loadConfigs();
      setShowForm(false);
      setEditingConfig(null);
    } catch (e: any) {
      toast.error(`保存失败：${e.message}`);
    }
    setLoading(false);
  };

  const handleDelete = (id: number) => {
    const config = configs.find(c => c.id === id);
    if (!config) return;

    setConfirmDialog({
      show: true,
      title: '删除确认',
      message: `确定要删除配置 "${config.name}" 吗？此操作不可撤销。`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await window.electronAPI.aiDeleteConfig(id);
          toast.success('配置已删除');
          await loadConfigs();
        } catch (e: any) {
          toast.error(`删除失败：${e.message}`);
        }
      },
    });
  };

  const handleSetActive = async (id: number) => {
    try {
      await window.electronAPI.aiSetActiveConfig(id);
      setActiveId(id);
      toast.success('已切换到该配置');
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* 主对话框 */}
      <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50" onClick={onClose}>
        <div
          className="max-w-lg w-full mx-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 标题 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚙️</span>
              <h3 className="font-bold text-lg text-gray-800 dark:text-white">AI 配置管理</h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          {/* 内容区 */}
          <div className="p-5 overflow-y-auto max-h-[calc(80vh - 140px)]">
            {/* 配置列表 */}
            <div className="space-y-2 mb-4">
              {configs.length === 0 ? (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  暂无配置，点击下方"新增"添加
                </div>
              ) : (
                configs.map((config) => (
                  <div
                    key={config.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                      activeId === config.id
                        ? 'border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 hover:bg-gray-100 dark:hover:bg-gray-700/40'
                    }`}
                    onClick={() => handleSetActive(config.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-700 dark:text-gray-200">{config.name}</span>
                        {config.isDefault && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700">默认</span>
                        )}
                        {activeId === config.id && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-700">当前</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                        {config.endpoint} · {config.model}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(config); }}
                        className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                      >
                        编辑
                      </button>
                      {!config.isDefault && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(config.id); }}
                          className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 新增按钮 */}
            {!showForm && (
              <button
                onClick={openAddForm}
                className="w-full px-4 py-2.5 text-sm text-green-600 dark:text-green-400 border border-green-300 dark:border-green-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
              >
                + 新增配置
              </button>
            )}

            {/* 表单 */}
            {showForm && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50/50 dark:bg-gray-900/30">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-medium text-sm text-gray-700 dark:text-gray-300">{editingConfig ? '编辑配置' : '新增配置'}</span>
                  <button
                    onClick={() => { setShowForm(false); setEditingConfig(null); }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
                  >
                    取消
                  </button>
                </div>

                <div className="space-y-3">
                  {/* 提供商快速选择 */}
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-2">
                      快速选择提供商
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {PROVIDER_PRESETS.map((provider) => (
                        <button
                          key={provider.name}
                          type="button"
                          onClick={() => selectProvider(provider.name)}
                          className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors ${
                            selectedProvider === provider.name
                              ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                          }`
                        }
                        title={provider.description}
                      >
                        <span>{provider.icon}</span>
                        <span className="truncate">{provider.name}</span>
                      </button>
                      ))}
                    </div>
                  </div>

                  <label className="block text-xs text-gray-500 dark:text-gray-400">
                    配置名称
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="如：OpenAI、Claude、DeepSeek"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 outline-none focus:border-green-500 dark:focus:border-green-600 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-600 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </label>

                  <label className="block text-xs text-gray-500 dark:text-gray-400">
                    API 端点
                    <input
                      type="text"
                      value={form.endpoint}
                      onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 outline-none focus:border-green-500 dark:focus:border-green-600 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-600 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </label>

                  <label className="block text-xs text-gray-500 dark:text-gray-400">
                    API 密钥
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 outline-none focus:border-green-500 dark:focus:border-green-600 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-600 placeholder-gray-400 dark:placeholder-gray-500"
                    />
                  </label>

                  <label className="block text-xs text-gray-500 dark:text-gray-400">
                    模型
                    {selectedProvider ? (
                      <select
                        value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 outline-none focus:border-green-500 dark:focus:border-green-600 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-600"
                      >
                        {PROVIDER_PRESETS.find(p => p.name === selectedProvider)?.models.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                        <option value="custom">自定义...</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}
                        placeholder="gpt-4、claude-3-opus、deepseek-chat"
                        className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 outline-none focus:border-green-500 dark:focus:border-green-600 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-600 placeholder-gray-400 dark:placeholder-gray-500"
                      />
                    )}
                  </label>

                  {/* 提供商说明 */}
                  {selectedProvider && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                      💡 {PROVIDER_PRESETS.find(p => p.name === selectedProvider)?.description}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-4">
                  <button
                    onClick={() => { setShowForm(false); setEditingConfig(null); }}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="px-4 py-2 text-sm text-white bg-green-600 dark:bg-green-700 hover:bg-green-500 dark:hover:bg-green-600 rounded-md disabled:opacity-50 transition-colors"
                  >
                    {loading ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex justify-end px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* 确认对话框 */}
      {confirmDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-[60]" onClick={() => setConfirmDialog(null)}>
          <div
            className="max-w-sm w-full mx-4 p-6 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🗑️</span>
              <h3 className="font-bold text-lg text-gray-800 dark:text-white">{confirmDialog.title}</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-sm text-white bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:hover:bg-red-600 rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};