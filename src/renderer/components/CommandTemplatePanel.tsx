import React, { useState, useEffect } from 'react';
import { toast } from './Toast';

interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  command: string;
  category: string;
  variables: { name: string; placeholder: string; description?: string; required?: boolean }[];
  tags: string[];
  isSystem: boolean;
  usageCount: number;
}

interface CommandTemplatePanelProps {
  visible: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  system: '🖥️ 系统',
  docker: '🐳 Docker',
  network: '🌐 网络',
  disk: '💾 磁盘',
  process: '⚙️ 进程',
  service: '🔧 服务',
  security: '🔒 安全',
  git: '📦 Git',
  custom: '📝 自定义',
};

export const CommandTemplatePanel: React.FC<CommandTemplatePanelProps> = ({
  visible,
  onClose,
  onExecute,
}) => {
  const [templates, setTemplates] = useState<CommandTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CommandTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [previewCommand, setPreviewCommand] = useState('');

  // 加载模板列表
  useEffect(() => {
    if (visible) {
      loadTemplates();
      loadCategories();
    }
  }, [visible]);

  // 加载模板
  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.templateList(selectedCategory || undefined);
      setTemplates(data);
    } catch (error) {
      console.error('加载模板失败:', error);
    }
    setLoading(false);
  };

  // 加载分类
  const loadCategories = async () => {
    try {
      const data = await window.electronAPI.templateCategories();
      setCategories(data);
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };

  // 搜索模板
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadTemplates();
      return;
    }
    setLoading(true);
    try {
      const data = await window.electronAPI.templateSearch(searchQuery);
      setTemplates(data);
    } catch (error) {
      console.error('搜索失败:', error);
    }
    setLoading(false);
  };

  // 切换分类
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setSearchQuery('');
  };

  // 分类变化时重新加载
  useEffect(() => {
    if (visible) {
      loadTemplates();
    }
  }, [selectedCategory]);

  // 选择模板
  const handleSelectTemplate = (template: CommandTemplate) => {
    setSelectedTemplate(template);
    setVariableValues({});
    setPreviewCommand(template.command);
  };

  // 更新变量值
  const handleVariableChange = (varName: string, value: string) => {
    const newValues = { ...variableValues, [varName]: value };
    setVariableValues(newValues);

    // 更新预览命令
    if (selectedTemplate) {
      let cmd = selectedTemplate.command;
      for (const [key, val] of Object.entries(newValues)) {
        cmd = cmd.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      }
      setPreviewCommand(cmd);
    }
  };

  // 执行命令
  const handleExecute = async () => {
    if (!selectedTemplate) return;

    // 检查必填变量
    const missingVars = selectedTemplate.variables.filter(
      v => v.required && !variableValues[v.name]
    );
    if (missingVars.length > 0) {
      toast.error(`请填写必填参数: ${missingVars.map(v => v.placeholder).join(', ')}`);
      return;
    }

    // 记录使用
    try {
      await window.electronAPI.templateUse(selectedTemplate.id);
    } catch (error) {
      // 忽略错误
    }

    onExecute(previewCommand);
    onClose();
  };

  // 过滤模板
  const filteredTemplates = searchQuery
    ? templates
    : selectedCategory
      ? templates.filter(t => t.category === selectedCategory)
      : templates;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h3 className="font-bold text-lg text-gray-800">命令模板</h3>
            <span className="text-sm text-gray-500">({filteredTemplates.length} 个)</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 搜索和分类 */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="flex gap-3 mb-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索命令模板..."
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
          </div>

          {/* 分类标签 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleCategoryChange('')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
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
                onClick={() => handleCategoryChange(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧模板列表 */}
          <div className="w-[320px] border-r border-gray-100 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <span className="animate-spin mr-2">⏳</span> 加载中...
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                暂无模板
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredTemplates.map(template => (
                  <div
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedTemplate?.id === template.id
                        ? 'bg-green-50 border border-green-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-800">
                        {CATEGORY_LABELS[template.category]?.split(' ')[0]} {template.name}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {template.usageCount > 0 && `用了 ${template.usageCount} 次`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{template.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 flex flex-col">
            {selectedTemplate ? (
              <>
                <div className="flex-1 p-5 overflow-y-auto">
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">
                    {selectedTemplate.name}
                  </h4>
                  <p className="text-sm text-gray-600 mb-4">{selectedTemplate.description}</p>

                  {/* 命令预览 */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">命令预览</label>
                    <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-sm font-mono overflow-x-auto">
                      $ {previewCommand}
                    </pre>
                  </div>

                  {/* 变量输入 */}
                  {selectedTemplate.variables.length > 0 && (
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-gray-500">参数配置</label>
                      {selectedTemplate.variables.map(v => (
                        <div key={v.name}>
                          <label className="block text-xs text-gray-500 mb-1">
                            {v.placeholder}
                            {v.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          <input
                            type="text"
                            value={variableValues[v.name] || ''}
                            onChange={(e) => handleVariableChange(v.name, e.target.value)}
                            placeholder={v.description || v.placeholder}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-green-500"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 执行按钮 */}
                <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleExecute}
                    className="px-5 py-2 text-sm text-white bg-green-500 rounded-lg hover:bg-green-600"
                  >
                    执行命令
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                ← 选择一个模板查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
