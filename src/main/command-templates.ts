import fs from 'fs';
import path from 'path';

/**
 * 命令模板管理器
 * 
 * 功能：
 * 1. 预设常用运维命令模板
 * 2. 用户自定义模板
 * 3. 模板变量替换
 * 4. 模板分类和搜索
 */

export interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  command: string;
  category: string;
  variables: TemplateVariable[];
  tags: string[];
  isSystem: boolean;  // 系统预设 vs 用户自定义
  createdAt: string;
  usageCount: number;
}

export interface TemplateVariable {
  name: string;
  placeholder: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface TemplateCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
}

// 预设模板分类
const SYSTEM_CATEGORIES: TemplateCategory[] = [
  { id: 'system', name: '系统信息', icon: '💻', description: '查看系统信息' },
  { id: 'docker', name: 'Docker', icon: '🐳', description: 'Docker 容器管理' },
  { id: 'network', name: '网络', icon: '🌐', description: '网络诊断和配置' },
  { id: 'disk', name: '磁盘', icon: '💾', description: '磁盘和存储管理' },
  { id: 'process', name: '进程', icon: '⚙️', description: '进程管理' },
  { id: 'service', name: '服务', icon: '🔧', description: '系统服务管理' },
  { id: 'security', name: '安全', icon: '🔒', description: '安全检查和加固' },
  { id: 'backup', name: '备份', icon: '📦', description: '数据备份和恢复' },
  { id: 'monitor', name: '监控', icon: '📊', description: '系统监控' },
  { id: 'custom', name: '自定义', icon: '✏️', description: '用户自定义模板' },
];

// 预设命令模板
const SYSTEM_TEMPLATES: CommandTemplate[] = [
  // 系统信息
  {
    id: 'sys_info',
    name: '系统信息',
    description: '查看完整系统信息',
    command: 'uname -a && cat /etc/os-release',
    category: 'system',
    variables: [],
    tags: ['系统', '信息'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'sys_uptime',
    name: '系统运行时间',
    description: '查看系统运行时间和负载',
    command: 'uptime',
    category: 'system',
    variables: [],
    tags: ['系统', '运行时间'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'sys_users',
    name: '在线用户',
    description: '查看当前登录的用户',
    command: 'who && w',
    category: 'system',
    variables: [],
    tags: ['用户', '登录'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // Docker
  {
    id: 'docker_ps',
    name: '容器列表',
    description: '查看所有 Docker 容器',
    command: 'docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    category: 'docker',
    variables: [],
    tags: ['docker', '容器'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'docker_logs',
    name: '容器日志',
    description: '查看指定容器的日志',
    command: 'docker logs --tail 100 -f {{container_name}}',
    category: 'docker',
    variables: [
      { name: 'container_name', placeholder: '容器名称', description: '要查看日志的容器名', required: true }
    ],
    tags: ['docker', '日志'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'docker_restart',
    name: '重启容器',
    description: '重启指定容器',
    command: 'docker restart {{container_name}}',
    category: 'docker',
    variables: [
      { name: 'container_name', placeholder: '容器名称', required: true }
    ],
    tags: ['docker', '重启'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'docker_cleanup',
    name: '清理 Docker',
    description: '清理未使用的镜像、容器和卷',
    command: 'docker system prune -af && docker volume prune -f',
    category: 'docker',
    variables: [],
    tags: ['docker', '清理'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 网络
  {
    id: 'net_ports',
    name: '监听端口',
    description: '查看所有监听的端口',
    command: 'netstat -tlnp 2>/dev/null || ss -tlnp',
    category: 'network',
    variables: [],
    tags: ['网络', '端口'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'net_connections',
    name: '连接状态',
    description: '查看网络连接状态统计',
    command: 'ss -s',
    category: 'network',
    variables: [],
    tags: ['网络', '连接'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'net_ping',
    name: 'Ping 测试',
    description: '测试网络连通性',
    command: 'ping -c 4 {{host}}',
    category: 'network',
    variables: [
      { name: 'host', placeholder: '目标地址', description: '要 ping 的主机名或 IP', required: true }
    ],
    tags: ['网络', 'ping'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'net_trace',
    name: '路由追踪',
    description: '追踪网络路由',
    command: 'traceroute {{host}}',
    category: 'network',
    variables: [
      { name: 'host', placeholder: '目标地址', required: true }
    ],
    tags: ['网络', '路由'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 磁盘
  {
    id: 'disk_usage',
    name: '磁盘使用',
    description: '查看磁盘使用情况',
    command: 'df -h',
    category: 'disk',
    variables: [],
    tags: ['磁盘', '空间'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'disk_large_files',
    name: '大文件查找',
    description: '查找指定大小以上的文件',
    command: 'find {{path}} -type f -size +{{size}} -exec ls -lh {} \\; 2>/dev/null | head -20',
    category: 'disk',
    variables: [
      { name: 'path', placeholder: '搜索路径', defaultValue: '/' },
      { name: 'size', placeholder: '文件大小', description: '如 100M, 1G', defaultValue: '100M' }
    ],
    tags: ['磁盘', '文件'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'disk_inode',
    name: 'Inode 使用',
    description: '查看 inode 使用情况',
    command: 'df -i',
    category: 'disk',
    variables: [],
    tags: ['磁盘', 'inode'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 进程
  {
    id: 'proc_top',
    name: '资源占用 Top 10',
    description: '查看 CPU 占用最高的进程',
    command: 'ps aux --sort=-%cpu | head -11',
    category: 'process',
    variables: [],
    tags: ['进程', 'CPU'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'proc_memory',
    name: '内存占用 Top 10',
    description: '查看内存占用最高的进程',
    command: 'ps aux --sort=-%mem | head -11',
    category: 'process',
    variables: [],
    tags: ['进程', '内存'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'proc_kill',
    name: '终止进程',
    description: '终止指定进程',
    command: 'kill -9 {{pid}}',
    category: 'process',
    variables: [
      { name: 'pid', placeholder: '进程 ID', required: true }
    ],
    tags: ['进程', '终止'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 服务
  {
    id: 'svc_list',
    name: '服务列表',
    description: '查看所有运行中的服务',
    command: 'systemctl list-units --type=service --state=running',
    category: 'service',
    variables: [],
    tags: ['服务', '列表'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'svc_restart',
    name: '重启服务',
    description: '重启指定服务',
    command: 'systemctl restart {{service_name}}',
    category: 'service',
    variables: [
      { name: 'service_name', placeholder: '服务名称', required: true }
    ],
    tags: ['服务', '重启'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'svc_status',
    name: '服务状态',
    description: '查看服务状态',
    command: 'systemctl status {{service_name}}',
    category: 'service',
    variables: [
      { name: 'service_name', placeholder: '服务名称', required: true }
    ],
    tags: ['服务', '状态'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 安全
  {
    id: 'sec_failed_logins',
    name: '失败登录',
    description: '查看失败的登录尝试',
    command: 'lastb | head -20',
    category: 'security',
    variables: [],
    tags: ['安全', '登录'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'sec_ssh_config',
    name: 'SSH 配置检查',
    description: '检查 SSH 安全配置',
    command: 'grep -E "^(PermitRootLogin|PasswordAuthentication|Port)" /etc/ssh/sshd_config',
    category: 'security',
    variables: [],
    tags: ['安全', 'SSH'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'sec_firewall',
    name: '防火墙规则',
    description: '查看防火墙规则',
    command: 'iptables -L -n 2>/dev/null || ufw status verbose 2>/dev/null || firewall-cmd --list-all 2>/dev/null',
    category: 'security',
    variables: [],
    tags: ['安全', '防火墙'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 备份
  {
    id: 'backup_dir',
    name: '目录备份',
    description: '备份指定目录',
    command: 'tar -czf {{backup_name}}.tar.gz {{source_dir}}',
    category: 'backup',
    variables: [
      { name: 'source_dir', placeholder: '源目录', required: true },
      { name: 'backup_name', placeholder: '备份文件名', defaultValue: 'backup_$(date +%Y%m%d)' }
    ],
    tags: ['备份', '压缩'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'backup_db',
    name: '数据库备份',
    description: '备份 MySQL 数据库',
    command: 'mysqldump -u {{db_user}} -p {{db_name}} > {{db_name}}_$(date +%Y%m%d).sql',
    category: 'backup',
    variables: [
      { name: 'db_user', placeholder: '数据库用户', defaultValue: 'root' },
      { name: 'db_name', placeholder: '数据库名', required: true }
    ],
    tags: ['备份', '数据库'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  
  // 监控
  {
    id: 'monitor_io',
    name: '磁盘 IO',
    description: '查看磁盘 IO 状态',
    command: 'iostat -xz 1 3',
    category: 'monitor',
    variables: [],
    tags: ['监控', 'IO'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
  {
    id: 'monitor_network',
    name: '网络流量',
    description: '查看网络接口流量',
    command: 'iftop -t -s 10 2>/dev/null || sar -n DEV 1 3 2>/dev/null || cat /proc/net/dev',
    category: 'monitor',
    variables: [],
    tags: ['监控', '网络'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  },
];

export class CommandTemplateManager {
  private templates: CommandTemplate[] = [];
  private categories: TemplateCategory[] = [];
  private dataPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir?: string) {
    const baseDir = dataDir || (typeof process !== 'undefined' && process.env.APPDATA) 
      ? path.join(process.env.APPDATA, 'ops-claw')
      : path.join(process.cwd(), 'data');
    
    this.dataPath = path.join(baseDir, 'command-templates.json');
    
    // 初始化系统模板和分类
    this.categories = [...SYSTEM_CATEGORIES];
    this.templates = [...SYSTEM_TEMPLATES];
    
    // 加载用户自定义模板
    this.loadUserTemplates();
  }

  private loadUserTemplates(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const userTemplates: CommandTemplate[] = JSON.parse(raw);
        // 合并用户模板（覆盖同 ID 的系统模板）
        for (const template of userTemplates) {
          const existingIndex = this.templates.findIndex(t => t.id === template.id);
          if (existingIndex >= 0) {
            this.templates[existingIndex] = template;
          } else {
            this.templates.push(template);
          }
        }
      }
    } catch {
      // 加载失败使用默认模板
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        // 只保存用户自定义模板
        const userTemplates = this.templates.filter(t => !t.isSystem);
        fs.writeFileSync(this.dataPath, JSON.stringify(userTemplates, null, 2), 'utf-8');
      } catch {
        // 保存失败不影响主流程
      }
    }, 1000);
  }

  /**
   * 获取所有分类
   */
  getCategories(): TemplateCategory[] {
    return this.categories;
  }

  /**
   * 获取所有模板
   */
  getTemplates(category?: string): CommandTemplate[] {
    if (category) {
      return this.templates.filter(t => t.category === category);
    }
    return this.templates;
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): CommandTemplate[] {
    const lower = query.toLowerCase();
    return this.templates.filter(t => 
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.tags.some(tag => tag.toLowerCase().includes(lower))
    );
  }

  /**
   * 获取单个模板
   */
  getTemplate(id: string): CommandTemplate | undefined {
    return this.templates.find(t => t.id === id);
  }

  /**
   * 渲染模板（替换变量）
   */
  renderTemplate(id: string, variables: Record<string, string>): string | null {
    const template = this.getTemplate(id);
    if (!template) return null;

    let command = template.command;
    
    // 替换变量
    for (const [key, value] of Object.entries(variables)) {
      command = command.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    // 替换未提供值的变量为默认值
    for (const v of template.variables) {
      if (v.defaultValue) {
        command = command.replace(new RegExp(`\\{\\{${v.name}\\}\\}`, 'g'), v.defaultValue);
      }
    }

    return command;
  }

  /**
   * 添加用户自定义模板
   */
  addTemplate(template: Omit<CommandTemplate, 'id' | 'isSystem' | 'createdAt' | 'usageCount'>): CommandTemplate {
    const newTemplate: CommandTemplate = {
      ...template,
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      isSystem: false,
      createdAt: new Date().toISOString(),
      usageCount: 0,
    };
    
    this.templates.push(newTemplate);
    this.scheduleSave();
    
    return newTemplate;
  }

  /**
   * 更新模板
   */
  updateTemplate(id: string, updates: Partial<CommandTemplate>): boolean {
    const index = this.templates.findIndex(t => t.id === id);
    if (index < 0) return false;
    
    // 系统模板只能更新使用次数
    if (this.templates[index].isSystem) {
      if (updates.usageCount !== undefined) {
        this.templates[index].usageCount = updates.usageCount;
      }
      return true;
    }
    
    this.templates[index] = { ...this.templates[index], ...updates };
    this.scheduleSave();
    
    return true;
  }

  /**
   * 删除模板
   */
  deleteTemplate(id: string): boolean {
    const index = this.templates.findIndex(t => t.id === id);
    if (index < 0 || this.templates[index].isSystem) return false;
    
    this.templates.splice(index, 1);
    this.scheduleSave();
    
    return true;
  }

  /**
   * 记录模板使用
   */
  recordUsage(id: string): void {
    const template = this.templates.find(t => t.id === id);
    if (template) {
      template.usageCount++;
      this.scheduleSave();
    }
  }

  /**
   * 获取热门模板
   */
  getPopularTemplates(limit: number = 10): CommandTemplate[] {
    return [...this.templates]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * 获取最近使用的模板
   */
  getRecentTemplates(limit: number = 10): CommandTemplate[] {
    return [...this.templates]
      .filter(t => t.usageCount > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}
