/* ==========================================================================
   Switch Google — UniFi OS Studio Core State, Theme, Command Palette & Routing
   ========================================================================== */

(function () {
  const DEFAULT_GATEWAY =
    window.location.origin && window.location.origin.startsWith('http')
      ? `${window.location.origin}/v1`
      : 'http://localhost:1909/v1';

  const TAB_TITLES = {
    switch: 'Switch & Định Tuyến',
    analytics: 'Phân Tích Token',
    quotas: 'Quota Model',
    combos: 'Model Combos',
    keys: 'Virtual API Keys',
    providers: 'Dịch Vụ AI (Multi-Providers)',
    subscriptions: 'Gói Đăng Ký & Thời Hạn',
    integration: 'Tích Hợp & Direct Link',
    system: 'Hệ Thống & Sao Lưu'
  };

  window.SG = {
    gatewayBaseUrl: DEFAULT_GATEWAY,
    currentTab: 'switch',
    activeStrategy: 'least-traffic',
    selectedTimeframe: '24h',
    currentAnalyticsPeriod: 'day',
    rotationConfigLoaded: false,
    cachedPorts: [],
    cachedActiveProfile: null,
    inspectedProfile: null,
    liveTrafficData: null,
    realHealthResults: {},
    cachedLogsData: [],
    cachedCombosList: [],
    currentEditingCombo: null,
    currentUpgradeProfile: null,
    currentSystemInfo: null,
    mitmInfo: { running: false, dnsEnabled: false, trustCommand: '', enableDnsCommand: '', portForwardCommand: '', disablePortForwardCommand: '', port: 443 },

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    encodeArg(str) {
      return encodeURIComponent(String(str ?? '')).replace(/'/g, '%27');
    },

    formatTokens(num) {
      const n = Number(num || 0);
      if (!n) return '0';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return n.toLocaleString();
    },

    toast(message, type = 'info', duration = 3200) {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const item = document.createElement('div');
      item.className = `toast-item${type === 'error' ? ' toast-error' : ''}`;
      item.setAttribute('role', 'status');
      item.textContent = message;
      container.appendChild(item);
      setTimeout(() => {
        item.style.opacity = '0';
        item.style.transition = 'opacity 0.2s ease';
        setTimeout(() => item.remove(), 220);
      }, duration);
    },

    copyText(text, successMsg = 'Đã sao chép vào Clipboard') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => window.SG.toast(successMsg))
          .catch(() => window.SG.toast('Không thể truy cập Clipboard', 'error'));
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        window.SG.toast(successMsg);
      }
    },

    getCssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
  };

  /* --- Theme System (Dark Studio Default + macOS Light Mode) --- */
  function applyTheme(theme) {
    const resolved = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('switch_google_studio_theme', resolved);

    const sunIcon = document.getElementById('icon-theme-sun');
    const moonIcon = document.getElementById('icon-theme-moon');
    const btn = document.getElementById('btn-theme-toggle');
    if (sunIcon && moonIcon) {
      sunIcon.style.display = resolved === 'dark' ? 'block' : 'none';
      moonIcon.style.display = resolved === 'dark' ? 'none' : 'block';
    }
    if (btn) {
      const tip = resolved === 'dark' ? 'Chuyển Light Mode' : 'Chuyển Dark Mode';
      btn.setAttribute('data-tooltip', tip);
      btn.setAttribute('aria-label', tip);
    }

    if (typeof window.redrawChartsForTheme === 'function') {
      window.redrawChartsForTheme();
    }
    if (typeof window.drawSvgCables === 'function' && window.SG.cachedPorts.length > 0) {
      setTimeout(() => window.drawSvgCables(window.SG.cachedPorts, window.SG.cachedActiveProfile), 50);
    }
  }

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  /* --- Mobile Rail Drawer --- */
  window.openMobileSidebar = function () {
    document.getElementById('app-rail')?.classList.add('open');
    document.getElementById('sidebar-overlay')?.classList.add('open');
  };

  window.closeMobileSidebar = function () {
    document.getElementById('app-rail')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');
  };

  /* --- Tab Navigation --- */
  window.navigateTab = function (tabKey) {
    if (!TAB_TITLES[tabKey]) return;
    window.SG.currentTab = tabKey;

    document.querySelectorAll('.rail-btn[data-tab]').forEach((btn) => {
      const isMatch = btn.getAttribute('data-tab') === tabKey;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    document.querySelectorAll('.view-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.id === `pane-${tabKey}`);
    });

    const titleEl = document.getElementById('topbar-page-title');
    if (titleEl) titleEl.textContent = TAB_TITLES[tabKey];

    window.closeMobileSidebar();

    if (tabKey === 'switch') {
      setTimeout(() => {
        if (window.SG.cachedPorts.length > 0 && typeof window.drawSvgCables === 'function') {
          window.drawSvgCables(window.SG.cachedPorts, window.SG.cachedActiveProfile);
        }
      }, 60);
      window.fetchAuditLogs?.();
    } else if (tabKey === 'analytics') {
      window.fetchAnalyticsData?.();
      window.fetchAuditLogs?.();
    } else if (tabKey === 'quotas') {
      window.loadDetailedAnalytics?.();
    } else if (tabKey === 'combos') {
      window.fetchCombos?.();
    } else if (tabKey === 'keys') {
      window.fetchApiKeys?.();
    } else if (tabKey === 'providers') {
      window.fetchProviders?.();
    } else if (tabKey === 'subscriptions') {
      window.fetchSubscriptionsList?.();
    } else if (tabKey === 'integration') {
      window.checkMitmStatus?.();
      window.fetchNetworkStatus?.();
    } else if (tabKey === 'system') {
      window.checkSystemVersion?.();
    }
  };

  /* --- Command Palette (Cmd+K / Ctrl+K) --- */
  let cmdSelectedIndex = 0;
  let currentCmdActions = [];

  function buildCommandActions() {
    const actions = [
      { label: 'Chuyển đến: Switch & Định Tuyến', sub: 'View', keywords: 'switch routing port rack topology home', run: () => window.navigateTab('switch') },
      { label: 'Chuyển đến: Phân Tích Token', sub: 'View', keywords: 'analytics chart stats token logs usage', run: () => window.navigateTab('analytics') },
      { label: 'Chuyển đến: Quota Model', sub: 'View', keywords: 'quotas limits rpm tpm models', run: () => window.navigateTab('quotas') },
      { label: 'Chuyển đến: Model Combos', sub: 'View', keywords: 'combos fallback preset models', run: () => window.navigateTab('combos') },
      { label: 'Chuyển đến: Virtual API Keys', sub: 'View', keywords: 'api keys virtual token secret', run: () => window.navigateTab('keys') },
      { label: 'Chuyển đến: Dịch Vụ AI', sub: 'View', keywords: 'providers ai models failover external', run: () => window.navigateTab('providers') },
      { label: 'Chuyển đến: Gói Đăng Ký & Thời Hạn', sub: 'View', keywords: 'subscriptions plans expire package account', run: () => window.navigateTab('subscriptions') },
      { label: 'Chuyển đến: Tích Hợp & Direct Link', sub: 'View', keywords: 'integration mitm direct link cursor cline curl', run: () => window.navigateTab('integration') },
      { label: 'Chuyển đến: Hệ Thống & Sao Lưu', sub: 'View', keywords: 'system backup sqlite json update daemon restart', run: () => window.navigateTab('system') },
      { label: 'Thêm cổng tài khoản mới', sub: 'Action', keywords: 'add port account oauth web cookie key', run: () => window.openAddModal?.() },
      { label: 'Ping kiểm tra tất cả cổng Google', sub: 'Action', keywords: 'ping health latency test network', run: () => window.runPingAllPorts?.() },
      { label: 'Sao chép Base URL Gateway', sub: 'Copy', keywords: 'copy base url gateway endpoint v1', run: () => window.copyGatewayBaseUrl() },
      { label: 'Chuyển đổi giao diện Sáng / Tối', sub: 'Theme', keywords: 'theme dark light mode appearance', run: () => window.toggleTheme() },
      { label: 'Chiến lược: Least-Traffic', sub: 'Route', keywords: 'strategy least traffic load balance', run: () => window.selectStrategyMode?.('least-traffic') },
      { label: 'Chiến lược: Round-Robin', sub: 'Route', keywords: 'strategy round robin rotate', run: () => window.selectStrategyMode?.('round-robin') },
      { label: 'Chiến lược: Fallback', sub: 'Route', keywords: 'strategy fallback priority', run: () => window.selectStrategyMode?.('fallback') },
      { label: 'Chiến lược: Fixed', sub: 'Route', keywords: 'strategy fixed single default', run: () => window.selectStrategyMode?.('fixed') }
    ];

    (window.SG.cachedPorts || []).forEach((p) => {
      const code = String(p.portNumber).padStart(2, '0');
      actions.push({
        label: `Kiểm tra cổng P${code}: ${p.email || p.profile}`,
        sub: p.type.toUpperCase(),
        keywords: `port p${code} inspector account ${p.email || ''} ${p.profile || ''}`,
        run: () => {
          window.navigateTab('switch');
          window.openPortInspector?.(p.profile);
        }
      });
    });

    return actions;
  }

  window.openCmdPalette = function () {
    const input = document.getElementById('cmd-search-input');
    if (input) input.value = '';
    cmdSelectedIndex = 0;
    window.filterCmdPalette('');
    window.openModalById('modal-cmd-palette');
  };

  window.closeCmdPalette = function () {
    window.closeModalById('modal-cmd-palette');
  };

  window.filterCmdPalette = function (query) {
    const listEl = document.getElementById('cmd-results-list');
    if (!listEl) return;
    const q = (query || '').trim().toLowerCase();
    const all = buildCommandActions();
    currentCmdActions = q
      ? all.filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.sub.toLowerCase().includes(q) ||
          (a.keywords && a.keywords.toLowerCase().includes(q))
      )
      : all;

    if (cmdSelectedIndex >= currentCmdActions.length) cmdSelectedIndex = 0;

    if (currentCmdActions.length === 0) {
      listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">Không tìm thấy lệnh phù hợp.</div>`;
      return;
    }

    listEl.innerHTML = currentCmdActions
      .map(
        (item, idx) => `
        <button class="cmd-item ${idx === cmdSelectedIndex ? 'selected' : ''}" onclick="executeCmdAction(${idx})">
          <span>${window.SG.escapeHtml(item.label)}</span>
          <span class="cmd-item-sub">${window.SG.escapeHtml(item.sub)}</span>
        </button>
      `
      )
      .join('');
  };

  window.executeCmdAction = function (idx) {
    const item = currentCmdActions[idx];
    window.closeCmdPalette();
    if (item && typeof item.run === 'function') item.run();
  };

  window.onCmdKeyDown = function (e) {
    if (!currentCmdActions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdSelectedIndex = (cmdSelectedIndex + 1) % currentCmdActions.length;
      window.filterCmdPalette(document.getElementById('cmd-search-input')?.value || '');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdSelectedIndex = (cmdSelectedIndex - 1 + currentCmdActions.length) % currentCmdActions.length;
      window.filterCmdPalette(document.getElementById('cmd-search-input')?.value || '');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      window.executeCmdAction(cmdSelectedIndex);
    }
  };

  /* --- Copy Helpers --- */
  window.copyGatewayBaseUrl = function () {
    window.SG.copyText(
      window.SG.gatewayBaseUrl,
      `Đã sao chép Base URL: ${window.SG.gatewayBaseUrl}`
    );
  };

  window.copyPlain = function (text) {
    window.SG.copyText(text, 'Đã sao chép vào Clipboard');
  };

  window.copySnippet = function (text) {
    window.SG.copyText(text, 'Đã sao chép cấu hình vào Clipboard');
  };

  /* --- Modals & Keyboard Shortcuts --- */
  window.openModalById = function (modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('open');
    const focusable = el.querySelector('input, button, select, textarea');
    if (focusable) setTimeout(() => focusable.focus(), 40);
  };

  window.closeModalById = function (modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('open');
  };

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const modal = document.getElementById('modal-cmd-palette');
      if (modal && modal.classList.contains('open')) {
        window.closeCmdPalette();
      } else {
        window.openCmdPalette();
      }
      return;
    }

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
      window.closePortInspector?.();
      window.closeMobileSidebar();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.classList.remove('open');
    }
  });

  /* --- Bootstrap Application --- */
  function initApp() {
    const savedTheme = localStorage.getItem('switch_google_studio_theme') || 'dark';
    applyTheme(savedTheme);

    const topUrlEl = document.getElementById('topbar-gateway-url');
    if (topUrlEl) topUrlEl.textContent = window.SG.gatewayBaseUrl;

    window.initRackScrollEvents?.();
    window.fetchSwitchStatus?.();
    window.fetchAuditLogs?.();
    window.fetchApiKeys?.();
    window.checkSystemVersion?.();

    setInterval(() => {
      window.fetchSwitchStatus?.();
    }, 2500);

    setInterval(() => {
      if (window.SG.currentTab === 'switch' || window.SG.currentTab === 'analytics') {
        window.fetchAuditLogs?.();
      }
      if (window.SG.currentTab === 'analytics') {
        window.fetchAnalyticsData?.();
      }
    }, 2000);

    setInterval(() => {
      window.checkSystemVersion?.();
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
