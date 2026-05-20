export const WEB_BRIDGE_SCRIPT = `/**
 * Web Bridge Script — 浏览器端注入脚本
 *
 * 在浏览器中提供 window.electronAPI，使同一份 React 前端代码
 * 可以在 Electron 和 Web 两种模式下运行。
 */
(function () {
  if (window.electronAPI) return; // Electron 模式，跳过

  // ===== 全局错误处理 - 防止页面白屏 =====
  window.addEventListener('error', function (event) {
    console.error('[WebBridge] 全局错误:', event.error || event.message);
    // 阻止错误导致页面崩溃
    event.preventDefault();
  });
  window.addEventListener('unhandledrejection', function (event) {
    console.error('[WebBridge] 未处理的 Promise 拒绝:', event.reason);
    // 阻止未处理的 Promise 拒绝导致页面崩溃
    event.preventDefault();
  });

  var API_BASE = window.location.origin + '/api';
  var authToken = localStorage.getItem('opsclaw_token') || '';
  var socket = null;
  var socketReady = null; // Promise<socket>

  // ===== SSH Shell 事件监听器 =====
  var shellListeners = {
    'ssh:shell:data': [],
    'ssh:shell:close': [],
    'ssh:shell:error': [],
    'agent:progress': []
  };

  function addShellListener(event, cb) {
    shellListeners[event].push(cb);
    return function () {
      var idx = shellListeners[event].indexOf(cb);
      if (idx >= 0) shellListeners[event].splice(idx, 1);
    };
  }

  function emitToListeners(event, payload) {
    for (var i = 0; i < shellListeners[event].length; i++) {
      try { shellListeners[event][i](payload); } catch (e) { console.error('[WebBridge]', e); }
    }
  }

  // ===== HTTP 工具 =====
  function apiFetch(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    return fetch(API_BASE + path, Object.assign({}, options, { headers: headers }))
      .then(function (response) {
        if (response.status === 401) {
          localStorage.removeItem('opsclaw_token');
          authToken = '';
          showLogin();
          return Promise.reject(new Error('认证已过期'));
        }
        return response.json();
      });
  }

  function apiGet(path) { return apiFetch(path); }
  function apiPost(path, body) {
    return apiFetch(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
  }
  function apiPut(path, body) {
    return apiFetch(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined });
  }
  function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }

  // ===== Socket.io（懒加载）=====
  function getSocket() {
    if (socketReady) return socketReady;
    socketReady = new Promise(function (resolve) {
      if (socket && socket.connected) { resolve(socket); return; }
      var script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = function () {
        socket = window.io(window.location.origin, {
          auth: { token: authToken },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 2000,
          reconnectionAttempts: 10,
        });
        socket.on('ssh:shell:data', function (p) { emitToListeners('ssh:shell:data', p); });
        socket.on('ssh:shell:close', function (p) { emitToListeners('ssh:shell:close', p); });
        socket.on('ssh:shell:error', function (p) { emitToListeners('ssh:shell:error', p); });
        socket.on('agent:progress', function (p) { emitToListeners('agent:progress', p); });
        socket.on('connect', function () { console.log('[WebBridge] Socket.io 已连接'); });
        socket.on('disconnect', function () {
          console.log('[WebBridge] Socket.io 已断开，尝试重连...');
          socketReady = null; // 重置，下次重连
        });
        resolve(socket);
      };
      script.onerror = function () { console.error('[WebBridge] Socket.io 加载失败'); socketReady = null; };
      document.head.appendChild(script);
    });
    return socketReady;
  }

  // ===== 立即设置 window.electronAPI =====
  window.electronAPI = {
    // 服务器管理
    serverList: function () { return apiGet('/servers'); },
    serverAdd: function (config) { return apiPost('/servers', config); },
    serverDelete: function (id) { return apiDelete('/servers/' + id); },
    serverUpdate: function (id, config) { return apiPut('/servers/' + id, config); },

    // SSH 连接
    sshConnect: function (serverId) { return apiPost('/ssh/connect', { serverId: serverId }); },
    sshExecute: function (connectionId, command) { return apiPost('/ssh/execute', { connectionId: connectionId, command: command }); },
    sshDisconnect: function (connectionId) { return apiPost('/ssh/disconnect', { connectionId: connectionId }); },

    // SSH 监控
    sshMonitor: function (connectionId) { return apiPost('/ssh/monitor', { connectionId: connectionId }); },
    sshGeoip: function (connectionId) { return apiPost('/ssh/geoip', { connectionId: connectionId }); },

    // SSH Shell（通过 Socket.io 懒加载）
    sshShellCreate: function (connectionId, cols, rows) {
      return getSocket().then(function (sock) {
        return new Promise(function (resolve) {
          sock.once('ssh:shell:created', function (result) { resolve(result); });
          sock.emit('ssh:shell:create', { connectionId: connectionId, cols: cols, rows: rows });
        });
      });
    },
    sshShellWrite: function (sessionId, data) {
      return getSocket().then(function (sock) { sock.emit('ssh:shell:write', { sessionId: sessionId, data: data }); });
    },
    sshShellResize: function (sessionId, cols, rows) {
      return getSocket().then(function (sock) { sock.emit('ssh:shell:resize', { sessionId: sessionId, cols: cols, rows: rows }); });
    },
    sshShellClose: function (sessionId) {
      return getSocket().then(function (sock) { sock.emit('ssh:shell:close', { sessionId: sessionId }); });
    },

    // SSH Shell 事件
    onSshShellData: function (cb) { return addShellListener('ssh:shell:data', cb); },
    onSshShellClose: function (cb) { return addShellListener('ssh:shell:close', cb); },
    onSshShellError: function (cb) { return addShellListener('ssh:shell:error', cb); },

    // 日志
    logWrite: function (level, scope, message, meta) { return apiPost('/log', { level: level, scope: scope, message: message, meta: meta }); },
    logPaths: function () { return Promise.resolve({}); },

    // 命令安全分析
    commandAnalyze: function (command) { return apiPost('/command/analyze', { command: command }); },

    // 工具系统
    toolExecute: function (request) { return apiPost('/tools/execute', request); },
    toolList: function () { return apiGet('/tools/list'); },

    // AI 功能
    aiGenerate: function (tabId, prompt, context) { return apiPost('/ai/generate', { tabId: tabId, prompt: prompt, context: context }); },
    aiAnalyze: function (tabId, userPrompt, command, output, exitCode, context) {
      return apiPost('/ai/analyze', { tabId: tabId, userPrompt: userPrompt, command: command, output: output, exitCode: exitCode, context: context });
    },

    // AI 配置管理
    aiListConfigs: function () { return apiGet('/ai/configs'); },
    aiGetConfig: function (id) { return apiGet('/ai/configs/' + id); },
    aiGetActiveConfig: function () { return apiGet('/ai/configs/active'); },
    aiAddConfig: function (config) { return apiPost('/ai/configs', config); },
    aiUpdateConfig: function (id, config) { return apiPut('/ai/configs/' + id, config); },
    aiDeleteConfig: function (id) { return apiDelete('/ai/configs/' + id); },
    aiSetActiveConfig: function (id) { return apiPost('/ai/configs/' + id + '/activate'); },
    aiGetActiveConfigId: function () { return apiGet('/ai/configs/active-id'); },

    // 上下文管理
    contextGet: function (tabId) { return apiGet('/context/' + tabId); },
    contextUpdate: function (tabId, updates) { return apiPut('/context/' + tabId, updates); },
    contextClear: function (tabId) { return apiDelete('/context/' + tabId); },
    contextSummary: function (tabId) { return apiGet('/context/' + tabId + '/summary'); },
    contextAddTaskStep: function (tabId, step) { return apiPost('/context/' + tabId + '/task-step', step); },
    contextAddCommand: function (tabId, command) { return apiPost('/context/' + tabId + '/command', command); },

    // 聊天消息
    messageList: function (tabId) { return apiGet('/messages/' + tabId); },
    messageSave: function (tabId, message) { return apiPost('/messages/' + tabId, message); },
    messageClear: function (tabId) { return apiDelete('/messages/' + tabId); },

    // Token 预算
    budgetState: function () { return apiGet('/budget'); },
    budgetReset: function () { return apiPost('/budget/reset'); },
    budgetCompact: function (tabId) { return apiPost('/budget/compact', { tabId: tabId }); },

    // 会话恢复
    recoveryCheck: function () { return apiGet('/recovery/check'); },
    recoveryGetData: function (tabId) { return apiGet('/recovery/' + tabId); },
    recoveryConfirm: function () { return apiPost('/recovery/confirm'); },
    recoveryDismiss: function () { return apiPost('/recovery/dismiss'); },

    // 权限管理
    permissionGetConfig: function () { return apiGet('/permissions'); },
    permissionSetMode: function (mode) { return apiPut('/permissions/mode', { mode: mode }); },
    permissionAddRule: function (rule) { return apiPost('/permissions/rules', rule); },
    permissionRemoveRule: function (id) { return apiDelete('/permissions/rules/' + id); },

    // Agent 系统
    agentList: function () { return apiGet('/agents'); },
    agentDecompose: function (prompt, context) { return apiPost('/agents/decompose', { prompt: prompt, context: context }); },
    agentExecute: function (agentName, subTasks, context, userPrompt) {
      return apiPost('/agents/execute', { agentName: agentName, subTasks: subTasks, context: context, userPrompt: userPrompt });
    },
    agentConfirm: function (tabId, taskId, isConfirmed) {
      return apiPost('/agents/confirm', { tabId: tabId, taskId: taskId, isConfirmed: isConfirmed });
    },
    onAgentProgress: function (cb) { return addShellListener('agent:progress', cb); },

    // ===== RDP 远程桌面 =====
    rdpIsAvailable: function () { return apiGet('/rdp/available'); },
    rdpConnect: function (serverId, config) { return apiPost('/rdp/connect', { serverId: serverId, config: config }); },
    rdpDisconnect: function (sessionId) { return apiPost('/rdp/disconnect', { sessionId: sessionId }); },
    rdpDisconnectAll: function () { return apiPost('/rdp/disconnect-all'); },
    rdpSessionStatus: function (sessionId) { return apiGet('/rdp/sessions/' + sessionId); },
    rdpAllSessions: function () { return apiGet('/rdp/sessions'); },
    rdpExportFile: function (serverId) { return apiGet('/rdp/export/' + serverId); },
    rdpOpenExternal: function (serverId) { return apiPost('/rdp/open-external', { serverId: serverId }); },

    // ===== 服务器监控 =====
    monitorSummary: function () { return apiGet('/monitor/summary'); },
    monitorMetrics: function (serverId, hours) { return apiGet('/monitor/metrics/' + serverId + (hours ? '?hours=' + hours : '')); },
    monitorLatest: function (serverId) { return apiGet('/monitor/latest/' + serverId); },
    monitorAlerts: function (serverId, level) {
      var params = [];
      if (serverId) params.push('serverId=' + serverId);
      if (level) params.push('level=' + level);
      return apiGet('/monitor/alerts' + (params.length ? '?' + params.join('&') : ''));
    },
    monitorClearAlerts: function (serverId) { return apiDelete('/monitor/alerts' + (serverId ? '?serverId=' + serverId : '')); },
    monitorGetConfig: function () { return apiGet('/monitor/config'); },
    monitorUpdateConfig: function (config) { return apiPut('/monitor/config', config); },

    // ===== 通知系统 =====
    notificationList: function (options) {
      var params = [];
      if (options?.type) params.push('type=' + options.type);
      if (options?.source) params.push('source=' + options.source);
      if (options?.unreadOnly) params.push('unreadOnly=true');
      if (options?.limit) params.push('limit=' + options.limit);
      if (options?.offset) params.push('offset=' + options.offset);
      return apiGet('/notifications' + (params.length ? '?' + params.join('&') : ''));
    },
    notificationUnreadCount: function () { return apiGet('/notifications/unread-count'); },
    notificationMarkRead: function (id) { return apiPost('/notifications/' + id + '/read'); },
    notificationMarkAllRead: function () { return apiPost('/notifications/read-all'); },
    notificationDelete: function (id) { return apiDelete('/notifications/' + id); },
    notificationClear: function () { return apiDelete('/notifications'); },
    notificationGetConfig: function () { return apiGet('/notifications/config'); },
    notificationUpdateConfig: function (config) { return apiPut('/notifications/config', config); },

    // ===== 备份系统 =====
    backupList: function () { return apiGet('/backups'); },
    backupCreate: function (type, description) { return apiPost('/backups', { type: type, description: description }); },
    backupRestore: function (id) { return apiPost('/backups/' + id + '/restore'); },
    backupDelete: function (id) { return apiDelete('/backups/' + id); },
    backupGetConfig: function () { return apiGet('/backups/config'); },
    backupUpdateConfig: function (config) { return apiPut('/backups/config', config); },

    // ===== 会话录制 =====
    recordingList: function () { return apiGet('/recordings'); },
    recordingGet: function (id) { return apiGet('/recordings/' + id); },
    recordingExport: function (id, format) { return apiGet('/recordings/' + id + '/export?format=' + (format || 'text')); },
    recordingDelete: function (id) { return apiDelete('/recordings/' + id); },
    recordingGetConfig: function () { return apiGet('/recordings/config'); },
    recordingUpdateConfig: function (config) { return apiPut('/recordings/config', config); },

    // ===== 命令学习 =====
    aiRecommendCommands: function (prompt) { return apiGet('/command-learning/recommend?prompt=' + encodeURIComponent(prompt)); },
    aiFrequentCommands: function (limit) { return apiGet('/command-learning/frequent' + (limit ? '?limit=' + limit : '')); },
    aiRecentCommands: function (limit) { return apiGet('/command-learning/recent' + (limit ? '?limit=' + limit : '')); },

    // ===== 命令模板 =====
    templateList: function (category) { return apiGet('/templates' + (category ? '?category=' + category : '')); },
    templateCategories: function () { return apiGet('/templates/categories'); },
    templateSearch: function (query) { return apiGet('/templates/search?q=' + encodeURIComponent(query)); },
    templatePopular: function (limit) { return apiGet('/templates/popular' + (limit ? '?limit=' + limit : '')); },
    templateCreate: function (template) { return apiPost('/templates', template); },
    templateUpdate: function (id, template) { return apiPut('/templates/' + id, template); },
    templateDelete: function (id) { return apiDelete('/templates/' + id); },
    templateUse: function (id) { return apiPost('/templates/' + id + '/use'); },
    templateRender: function (templateId, variables) { return apiPost('/templates/render', { templateId: templateId, variables: variables }); },

    // ===== 执行历史 =====
    historyList: function (options) {
      var params = [];
      if (options && options.category) params.push('category=' + options.category);
      if (options && options.tag) params.push('tag=' + options.tag);
      if (options && options.search) params.push('search=' + encodeURIComponent(options.search));
      if (options && options.favoritesOnly) params.push('favoritesOnly=true');
      if (options && options.limit) params.push('limit=' + options.limit);
      if (options && options.offset) params.push('offset=' + options.offset);
      return apiGet('/history' + (params.length ? '?' + params.join('&') : ''));
    },
    historyGet: function (id) { return apiGet('/history/' + id); },
    historyAdd: function (record) { return apiPost('/history', record); },
    historyToggleFavorite: function (id) { return apiPost('/history/' + id + '/favorite'); },
    historyDelete: function (id) { return apiDelete('/history/' + id); },
    historyClear: function (keepFavorites) { return apiPost('/history/clear', { keepFavorites: keepFavorites }); },
    historyCategories: function () { return apiGet('/history/categories'); },
    historyTags: function () { return apiGet('/history/tags'); },
    historyStats: function () { return apiGet('/history/stats'); },

    // ===== 内存管理 =====
    memoryStats: function () { return apiGet('/memory/stats'); },
    memoryCleanup: function () { return apiPost('/memory/cleanup'); },
    memoryGetConfig: function () { return apiGet('/memory/config'); },
    memoryUpdateConfig: function (config) { return apiPut('/memory/config', config); },
  };

  // ===== 登录遮罩层 =====
  function showLogin() {
    if (document.getElementById('opsclaw-login-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'opsclaw-login-overlay';
    overlay.innerHTML =
      '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#1e1e2e;display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,system-ui,sans-serif">' +
        '<div style="background:#313244;border-radius:16px;padding:40px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.4)">' +
          '<div style="text-align:center;margin-bottom:24px">' +
            '<div style="font-size:48px;margin-bottom:8px">🐾</div>' +
            '<h1 style="color:#cdd6f4;font-size:24px;margin:0">Ops Claw</h1>' +
            '<p style="color:#6c7086;font-size:14px;margin:8px 0 0">AI 驱动的远程运维平台</p>' +
          '</div>' +
          '<div id="opsclaw-login-error" style="color:#f38ba8;font-size:13px;text-align:center;margin-bottom:12px;display:none"></div>' +
          '<input id="opsclaw-pwd" type="password" placeholder="请输入管理密码" ' +
            'style="width:100%;padding:12px 16px;border:1px solid #45475a;border-radius:8px;background:#1e1e2e;color:#cdd6f4;font-size:15px;outline:none;box-sizing:border-box;margin-bottom:16px">' +
          '<button id="opsclaw-login-btn" ' +
            'style="width:100%;padding:12px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.2s">登 录</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var pwd = document.getElementById('opsclaw-pwd');
    var btn = document.getElementById('opsclaw-login-btn');
    var err = document.getElementById('opsclaw-login-error');

    function doLogin() {
      var password = pwd.value;
      if (!password) return;
      btn.textContent = '登录中...'; btn.disabled = true; err.style.display = 'none';
      fetch(API_BASE + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password }),
      }).then(function (r) { return r.json(); }).then(function (result) {
        if (result.success && result.token) {
          authToken = result.token;
          localStorage.setItem('opsclaw_token', result.token);
          overlay.remove();
          // 预连接 socket.io
          getSocket();
        } else {
          err.textContent = result.error || '密码错误'; err.style.display = 'block';
          btn.textContent = '登 录'; btn.disabled = false; pwd.value = ''; pwd.focus();
        }
      }).catch(function () {
        err.textContent = '网络错误'; err.style.display = 'block';
        btn.textContent = '登 录'; btn.disabled = false;
      });
    }

    btn.addEventListener('click', doLogin);
    pwd.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    setTimeout(function () { pwd.focus(); }, 100);
  }

  // ===== 全局 API =====
  window.__opsclaw_logout = function () {
    authToken = ''; localStorage.removeItem('opsclaw_token');
    if (socket) { socket.disconnect(); socket = null; socketReady = null; }
    window.location.reload();
  };

  // ===== 启动流程 =====
  if (!authToken) {
    // 无 token，显示登录
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showLogin);
    } else {
      showLogin();
    }
  } else {
    // 有 token，验证有效性并预连接 socket.io
    apiGet('/health').then(function () {
      getSocket();
    }).catch(function () {
      localStorage.removeItem('opsclaw_token');
      authToken = '';
      showLogin();
    });
  }

  console.log('[WebBridge] window.electronAPI 已初始化（Web 模式）');
})();
`;
