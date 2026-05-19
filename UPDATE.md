# Ops Claw 更新日志

## v2.0.0 - 2026-05-19

### 🚀 重大更新

#### Token 优化 (节省 71%)
- ✅ 简单命令缓存 (59条常见命令直接返回，0 token)
- ✅ 前端简单任务检测 (17种任务跳过 AI 分解)
- ✅ 跳过简单命令分析 (成功执行的简单命令不调用 AI)
- ✅ 精简 System Prompt (减少约 60% token)
- ✅ 命令学习推荐系统 (学习用户习惯)

#### AI 提供商支持 (9个)
- 🆕 **小米 MiMo** - MiMo-V2.5-Pro, MiMo-V2.5, MiMo-V2-Pro
- 🆕 **智谱 AI (GLM)** - glm-4, glm-4-flash, glm-3-turbo
- 🆕 **百度文心** - ernie-4.0, ernie-3.5, ernie-speed
- 🆕 **阿里通义** - qwen-turbo, qwen-plus, qwen-max
- 🆕 **月之暗面 (Kimi)** - moonshot-v1-8k, moonshot-v1-32k
- ✅ OpenAI - gpt-4, gpt-4-turbo, gpt-3.5-turbo
- ✅ Claude (Anthropic) - claude-3-opus, claude-3-sonnet
- ✅ DeepSeek - deepseek-chat, deepseek-coder
- ✅ Ollama (本地) - llama2, mistral, qwen2

#### RDP 远程桌面
- 🆕 支持 Windows Server 远程桌面连接
- 🆕 多平台客户端支持 (Windows/Linux/macOS)
- 🆕 分辨率、安全层、重定向可配置
- 🆕 导出 .rdp 文件

#### 服务器监控系统
- 🆕 CPU/内存/磁盘/网络实时监控
- 🆕 可配置告警阈值 (CPU 80%/95%, 内存 85%/95%)
- 🆕 历史数据查询
- 🆕 监控摘要面板

#### 通知系统
- 🆕 系统级通知 (Electron Notification)
- 🆕 应用内通知
- 🆕 静默时间设置
- 🆕 通知历史记录

#### 备份恢复
- 🆕 自动定时备份 (默认每24小时)
- 🆕 配置/数据/完整备份
- 🆕 备份恢复功能
- 🆕 导入导出功能

#### 会话录制
- 🆕 SSH 会话录制
- 🆕 导出为文本/HTML
- 🆕 回放功能

#### 命令模板库
- 🆕 30+ 预设运维模板
- 🆕 分类和搜索
- 🆕 变量替换
- 🆕 使用统计

#### 前端优化
- 🆕 流式文本效果 (打字机)
- 🆕 虚拟滚动列表 (长对话流畅)
- 🆕 错误边界组件 (防止白屏)
- 🆕 快捷键支持 (Ctrl+L/T/W/M)
- 🆕 命令自动补全 (Tab 键)
- 🆕 Web Worker 安全分析 (UI 不卡顿)

#### 性能优化
- 🆕 并行任务执行 (多任务提速 2-3x)
- 🆕 AI 配置缓存 (查询提速)
- 🆕 状态选择器 (减少重渲染)
- 🆕 智能输出截取 (节省 60% 内存)
- 🆕 内存自动管理

#### Web 版本增强
- 🆕 97个 API 路由
- 🆕 所有新功能同步支持
- 🆕 Socket.io 实时通信

### 📁 新增文件 (25个)

#### 后端模块
- `src/main/rdp-manager.ts` - RDP 连接管理
- `src/main/server-monitor.ts` - 服务器监控
- `src/main/notification-manager.ts` - 通知管理
- `src/main/backup-manager.ts` - 备份管理
- `src/main/session-recorder.ts` - 会话录制
- `src/main/command-learner.ts` - 命令学习
- `src/main/command-templates.ts` - 命令模板
- `src/main/sftp-manager.ts` - SFTP 文件传输
- `src/main/batch-executor.ts` - 批量执行
- `src/main/audit-logger.ts` - 审计日志
- `src/main/streaming-manager.ts` - 流式响应
- `src/main/memory-manager.ts` - 内存管理
- `src/main/ipc/rdp-ipc.ts` - RDP IPC
- `src/main/ipc/memory-ipc.ts` - 内存 IPC

#### 前端组件
- `src/renderer/components/RdpView.tsx` - RDP 视图
- `src/renderer/components/VirtualList.tsx` - 虚拟滚动
- `src/renderer/components/ErrorBoundary.tsx` - 错误边界

#### 前端 Hooks
- `src/renderer/hooks/useStreamingText.ts` - 流式文本
- `src/renderer/hooks/useKeyboardShortcuts.ts` - 快捷键
- `src/renderer/hooks/useCommandCompletion.ts` - 命令补全

#### Web Worker
- `src/renderer/workers/security.worker.ts` - 安全分析
- `src/renderer/workers/useSecurityWorker.ts` - Worker Hook

### 📊 代码统计

- 新增代码: 8,412 行
- 修改文件: 17 个
- 新增文件: 28 个
- 总代码量: 17,790 行

### 🐳 Docker 部署

```bash
# 拉取更新
git pull origin master

# Docker Compose 重新构建
docker compose down
docker compose build --no-cache
docker compose up -d

# 查看日志
docker compose logs -f
```

### 📝 配置说明

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| ADMIN_PASSWORD | opsclaw2024 | 登录密码 |
| SESSION_SECRET | change-me-to-random-string | JWT 密钥 |

#### AI 配置

支持 9 个 AI 提供商，在应用内 "AI 设置" 中配置：

| 提供商 | 端点 | 推荐模型 |
|--------|------|---------|
| 小米 MiMo | https://token-plan-cn.xiaomimimo.com/v1 | MiMo-V2.5-Pro |
| OpenAI | https://api.openai.com/v1 | gpt-4-turbo |
| DeepSeek | https://api.deepseek.com/v1 | deepseek-chat |

### 🔧 API 文档

完整 API 文档请参考 [UPDATE.md](UPDATE.md)

---

## v1.0.0 - 初始版本

- SSH 连接管理
- AI 命令生成
- 安全分析系统
- Agent 任务分解
- Token 预算追踪
- 会话恢复机制
