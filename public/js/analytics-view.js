/* ==========================================================================
   Switch Google — Analytics HUD, Theme-Aware Charts, Quotas & Activity Stream
   ========================================================================== */

(function () {
  let chartTimelineObj = null;
  let chartModelObj = null;
  let chartAccountObj = null;
  let lastSummaryData = null;

  function getChartColors() {
    return {
      grid: window.SG.getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.09)',
      tick: window.SG.getCssVar('--chart-tick') || '#8b97ab',
      legend: window.SG.getCssVar('--chart-legend') || '#e2e8f0',
      surface: window.SG.getCssVar('--bg-surface') || '#151a22',
      tooltipBg: window.SG.getCssVar('--chart-tooltip-bg') || '#0a0d12',
      tooltipText: window.SG.getCssVar('--chart-tooltip-text') || '#f8fafc',
      brand: window.SG.getCssVar('--brand') || '#14d4b6',
      live: window.SG.getCssVar('--status-live') || '#38bdf8'
    };
  }

  window.switchAnalyticsPeriod = function (period) {
    window.SG.currentAnalyticsPeriod = period;
    ['hour', 'day', 'week', 'month', 'year'].forEach((p) => {
      const btn = document.getElementById(`tf-btn-${p}`);
      if (btn) btn.classList.toggle('active', p === period);
    });
    // Đồng bộ lại realtime timeframe tương ứng
    if (period === 'hour') window.SG.currentTimeframe = '1h';
    else if (period === 'day') window.SG.currentTimeframe = '24h';
    else if (period === 'week') window.SG.currentTimeframe = 'week';
    else if (period === 'month') window.SG.currentTimeframe = 'month';
    else if (period === 'year') window.SG.currentTimeframe = 'year';
    else window.SG.currentTimeframe = '24h';

    window.fetchAnalyticsData();
  };

  window.fetchAnalyticsData = async function () {
    try {
      const res = await fetch(
        `/api/usage/realtime?timeframe=${encodeURIComponent(window.SG.selectedTimeframe)}`
      );
      if (!res.ok) return;
      const data = await res.json();

      const tpsEl = document.getElementById('hud-tps');
      if (tpsEl) {
        tpsEl.innerHTML = `${Number(data.tokensPerSecond || 0).toLocaleString()} <span class="metric-tile-unit">tok/s</span>`;
      }

      const latEl = document.getElementById('hud-latency');
      if (latEl) {
        latEl.innerHTML = `${Number(data.avgLatencyMs || 0).toLocaleString()} <span class="metric-tile-unit">ms</span>`;
      }

      const ioEl = document.getElementById('hud-io-ratio');
      if (ioEl) {
        ioEl.textContent = `${window.SG.formatTokens(data.totalPromptTokens || 0)} / ${window.SG.formatTokens(data.totalCompletionTokens || 0)}`;
      }

      const topAccEl = document.getElementById('hud-top-account');
      const topAccTokEl = document.getElementById('hud-top-account-tokens');
      if (topAccEl && topAccTokEl) {
        const entries = Object.entries(data.tokensByAccount || {}).sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
          topAccEl.textContent = entries[0][0];
          topAccEl.title = entries[0][0];
          topAccTokEl.textContent = `${Number(entries[0][1]).toLocaleString()} tokens gánh tải`;
        } else {
          topAccEl.textContent = 'Chưa có lưu lượng';
          topAccTokEl.textContent = '0 tokens gánh tải';
        }
      }

      await window.loadDetailedAnalytics();
    } catch (_) {}
  };

  window.loadDetailedAnalytics = async function () {
    try {
      const res = await fetch(
        `/api/analytics/summary?period=${encodeURIComponent(window.SG.currentAnalyticsPeriod || 'day')}`
      );
      if (!res.ok) return;
      const data = await res.json();
      lastSummaryData = data;

      // Cập nhật Thẻ Chi Phí Token VNĐ
      const costEl = document.getElementById('hud-total-cost-vnd');
      const costTokEl = document.getElementById('hud-total-cost-tokens');
      if (costEl && costTokEl) {
        const totalTok = data.totalAllTokens || 0;
        const totalVnd = data.totalCostVnd || Math.round((totalTok / 1_000_000) * 9000);
        costEl.textContent = `${totalVnd.toLocaleString('vi-VN')} đ`;
        costTokEl.textContent = `${window.SG.formatTokens(totalTok)} tokens đã dùng`;
      }

      drawTimelineChartSummary(data.timeline || []);
      drawModelBarChart(data.modelDistribution || {});
      drawAccountDonutChart(data.accountDistribution || {});
      renderQuotasCards(data.quotas || []);
    } catch (err) {
      console.error('Lỗi tải analytics summary:', err);
    }
  };

  window.redrawChartsForTheme = function () {
    if (!lastSummaryData) return;
    drawTimelineChartSummary(lastSummaryData.timeline || []);
    drawModelBarChart(lastSummaryData.modelDistribution || {});
    drawAccountDonutChart(lastSummaryData.accountDistribution || {});
  };

  function drawTimelineChartSummary(timeline) {
    const canvas = document.getElementById('canvas-timeline-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (chartTimelineObj) chartTimelineObj.destroy();

    const c = getChartColors();
    const labels = timeline.map((t) => t.label);
    const promptValues = timeline.map((t) => t.prompt);
    const completionValues = timeline.map((t) => t.completion);

    chartTimelineObj = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Chưa có dữ liệu'],
        datasets: [
          {
            label: 'Prompt Tokens (Input)',
            data: promptValues.length ? promptValues : [0],
            borderColor: c.live,
            backgroundColor: 'rgba(56, 189, 248, 0.14)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: c.live
          },
          {
            label: 'Completion Tokens (Output)',
            data: completionValues.length ? completionValues : [0],
            borderColor: c.brand,
            backgroundColor: 'rgba(20, 212, 182, 0.14)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: c.brand
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: c.legend,
              font: { family: "'Plus Jakarta Sans', sans-serif", weight: '600', size: 12 },
              usePointStyle: true,
              boxWidth: 8
            }
          },
          tooltip: {
            backgroundColor: c.tooltipBg,
            titleColor: c.tooltipText,
            bodyColor: c.tooltipText,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { color: c.grid },
            ticks: { color: c.tick, font: { family: "'JetBrains Mono', monospace", size: 11 } }
          },
          y: {
            grid: { color: c.grid },
            ticks: {
              color: c.tick,
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => window.SG.formatTokens(v)
            }
          }
        }
      }
    });
  }

  function drawModelBarChart(modelDist) {
    const canvas = document.getElementById('canvas-model-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (chartModelObj) chartModelObj.destroy();

    const c = getChartColors();
    const labels = Object.keys(modelDist);
    const values = Object.values(modelDist);
    const badgeTotal = document.getElementById('badge-total-models');
    if (badgeTotal) badgeTotal.textContent = `${labels.length} Models`;

    chartModelObj = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Trống'],
        datasets: [
          {
            label: 'Tổng Tokens',
            data: values.length ? values : [0],
            backgroundColor: ['#14d4b6', '#38bdf8', '#818cf8', '#f59e0b', '#10b981', '#f43f5e'],
            borderRadius: 6,
            maxBarThickness: 42
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: c.tick, font: { family: "'JetBrains Mono', monospace", size: 11 } }
          },
          y: {
            grid: { color: c.grid },
            ticks: {
              color: c.tick,
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => window.SG.formatTokens(v)
            }
          }
        }
      }
    });
  }

  function drawAccountDonutChart(accDist) {
    const canvas = document.getElementById('canvas-account-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (chartAccountObj) chartAccountObj.destroy();

    const c = getChartColors();
    const labels = Object.keys(accDist).map((l) => (l.length > 22 ? l.slice(0, 20) + '...' : l));
    const values = Object.values(accDist);
    const badgeAcc = document.getElementById('badge-total-accounts');
    if (badgeAcc) badgeAcc.textContent = `${labels.length} Cổng`;

    chartAccountObj = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Chưa có dữ liệu'],
        datasets: [
          {
            data: values.length ? values : [1],
            backgroundColor: ['#14d4b6', '#38bdf8', '#818cf8', '#f59e0b', '#10b981', '#f43f5e'],
            borderWidth: 2,
            borderColor: c.surface
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: c.legend,
              font: { family: "'Plus Jakarta Sans', sans-serif", weight: '600', size: 12 },
              usePointStyle: true,
              boxWidth: 8
            }
          }
        }
      }
    });
  }

  /* --- Dynamic Model Quotas --- */
  window.toggleQuotaAccounts = function (btn) {
    const section = btn.closest('.quota-accounts-section');
    if (!section) return;
    const list = section.querySelector('.quota-accounts-list');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'flex' : 'none';
    btn.textContent = isHidden ? 'Thu gọn' : 'Xem chi tiết';
  };

  let allCachedQuotas = [];

  window.filterQuotaCards = function (keyword) {
    if (!allCachedQuotas || allCachedQuotas.length === 0) return;
    const term = (keyword || '').toLowerCase().trim();
    if (!term) {
      renderQuotasCards(allCachedQuotas);
      return;
    }
    const filtered = allCachedQuotas.filter((q) => {
      return (q.name || '').toLowerCase().includes(term) || (q.id || '').toLowerCase().includes(term) || (q.badge || '').toLowerCase().includes(term);
    });
    renderQuotasCards(filtered);
  };

  function renderQuotasCards(quotas) {
    const container = document.getElementById('quotas-cards-container');
    if (!container) return;

    allCachedQuotas = quotas || [];

    // Update KPI Summary Strip
    try {
      const totalPoolDaily = (quotas || []).reduce((acc, q) => acc + Number(q.dailyLimit || 0), 0);
      const totalUsedToday = (quotas || []).reduce((acc, q) => acc + Number(q.usedToday || 0), 0);
      const maxRpm = Math.max(0, ...(quotas || []).map((q) => Number(q.rpmLimit || 0)));
      const costVnd = Math.round((totalUsedToday / 1_000_000) * 9000);

      const elTotalPool = document.getElementById('kpi-quota-total-pool');
      const elMaxRpm = document.getElementById('kpi-quota-max-rpm');
      const elUsedTokens = document.getElementById('kpi-quota-used-tokens');
      const elCostVnd = document.getElementById('kpi-quota-cost-vnd');
      const elModelsCount = document.getElementById('kpi-quota-models-count');

      if (elTotalPool) elTotalPool.textContent = (totalPoolDaily / 1_000_000).toLocaleString() + ' M tok/ngày';
      if (elMaxRpm) elMaxRpm.textContent = maxRpm.toLocaleString() + ' RPM';
      if (elUsedTokens) elUsedTokens.textContent = window.SG.formatTokens(totalUsedToday) + ' tok';
      if (elCostVnd) elCostVnd.textContent = '≈ ' + costVnd.toLocaleString('vi-VN') + ' VNĐ';
      if (elModelsCount) elModelsCount.textContent = (quotas || []).length + ' Models';
    } catch (_) {}

    if (!quotas || quotas.length === 0) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">Không tìm thấy model nào phù hợp.</div>`;
      return;
    }

    const esc = window.SG.escapeHtml;
    const fmt = window.SG.formatTokens;

    container.innerHTML = quotas
      .map((q) => {
        const dailyLimit = Math.max(1, Number(q.dailyLimit || 1));
        const used = Number(q.usedToday || 0);
        const remaining = Math.max(0, dailyLimit - used);
        const pct = Math.max(0, Math.min(100, 100 - Math.round((used / dailyLimit) * 100)));
        const accentColor = q.color || 'var(--brand)';
        const accounts = q.accounts || [];
        const modelCostVnd = Math.round((used / 1_000_000) * 9000);

        const accountsHtml = accounts.map((acc) => {
          let badgeClass = 'badge-success';
          let statusText = 'UP';
          if (acc.linkStatus === 'cooldown') {
            badgeClass = 'badge-warning';
            statusText = `WAIT ${acc.cooldownRemainingSeconds}s`;
          } else if (acc.linkStatus === 'banned') {
            badgeClass = 'badge-danger';
            statusText = 'BANNED';
          } else if (acc.linkStatus === 'down') {
            badgeClass = 'badge-neutral';
            statusText = 'DOWN';
          }

          return `
            <div class="quota-account-row">
              <div class="quota-acc-left">
                <span class="quota-acc-port">P0${acc.portNumber}</span>
                <div class="quota-acc-info">
                  <span class="quota-acc-email" title="${esc(acc.email || acc.profile)}">${esc(acc.email || acc.profile)}</span>
                  <span class="quota-acc-type">${esc(acc.type)}</span>
                </div>
              </div>
              <div class="quota-acc-center">
                <div class="quota-acc-bar-wrap">
                  <div class="quota-acc-bar-track">
                    <div class="quota-acc-bar-fill" style="width: ${acc.pctRemaining}%; background: ${esc(accentColor)};"></div>
                  </div>
                  <span class="quota-acc-pct">${acc.pctRemaining}%</span>
                </div>
                <div class="quota-acc-usage-text">
                  <span>Dùng: <strong>${fmt(acc.usedTokens)}</strong> / ${fmt(acc.limitTokens)}</span>
                  <span class="quota-acc-reqs">${acc.requests} reqs</span>
                </div>
              </div>
              <div class="quota-acc-right">
                <span class="badge ${badgeClass}" style="font-size: 0.62rem; padding: 2px 6px;">${statusText}</span>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="quota-card" style="border-top-color: ${esc(accentColor)};">
            <div class="quota-head">
              <div>
                <h3 class="quota-name">${esc(q.name || q.id)}</h3>
                <div class="quota-desc">Model ID: <span class="mono-num">${esc(q.id)}</span></div>
              </div>
              <span class="badge badge-neutral" style="border-left: 3px solid ${esc(accentColor)};">${esc(q.badge || 'ACTIVE')}</span>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-weight: 700;">
                <span style="color: var(--text-secondary);">Hạn mức Pool còn lại trong ngày</span>
                <span class="mono-num" style="color: ${esc(accentColor)};">${pct}% (${fmt(remaining)} tok)</span>
              </div>
              <div class="progress-track" style="margin-top: 6px;">
                <div class="progress-fill" style="width: ${pct}%; background: ${esc(accentColor)};"></div>
              </div>
            </div>

            <div class="quota-stats-row" style="grid-template-columns: repeat(4, 1fr); gap: 8px;">
              <div class="quota-stat-box">
                <div class="quota-stat-lbl">Tốc độ tối đa</div>
                <div class="quota-stat-val">${Number(q.rpmLimit || 0).toLocaleString()} RPM</div>
              </div>
              <div class="quota-stat-box">
                <div class="quota-stat-lbl">TPM Giới hạn</div>
                <div class="quota-stat-val">${fmt(q.tpmLimit || 0)}/m</div>
              </div>
              <div class="quota-stat-box">
                <div class="quota-stat-lbl">Context Window</div>
                <div class="quota-stat-val" style="font-size: 0.75rem;">${esc(q.contextWindow || '1M tokens')}</div>
              </div>
              <div class="quota-stat-box">
                <div class="quota-stat-lbl">Đã Dùng (VNĐ)</div>
                <div class="quota-stat-val" style="color: var(--brand); font-size: 0.78rem;">≈ ${modelCostVnd.toLocaleString('vi-VN')} đ</div>
              </div>
            </div>

            <div class="quota-accounts-section">
              <div class="quota-accounts-header">
                <span class="quota-accounts-title">Chi Tiết Từng Tài Khoản (${accounts.length} Cổng • ${Number(q.availableAccounts || 0)} UP)</span>
                <button class="btn btn-xs btn-ghost" onclick="toggleQuotaAccounts(this)">Thu gọn</button>
              </div>
              <div class="quota-accounts-list">
                ${accountsHtml}
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  /* --- Audit Logs, Live Activity Stream & Mini Sparkline --- */
  window.fetchAuditLogs = async function () {
    try {
      const res = await fetch('/api/usage/logs?limit=150');
      if (!res.ok) return;
      const data = await res.json();
      window.SG.cachedLogsData = data.logs || [];

      const countBadge = document.getElementById('badge-log-count-tab2');
      if (countBadge) countBadge.textContent = window.SG.cachedLogsData.length;

      updateSparkline(window.SG.cachedLogsData);
      applyLogFilters();
      window.refreshPortInspectorIfOpen?.();
    } catch (_) {}
  };

  function updateSparkline(logs) {
    const sparkEl = document.getElementById('sg-sparkline');
    if (!sparkEl) return;
    const recent = (logs || []).slice(0, 12).reverse();
    if (recent.length === 0) {
      sparkEl.innerHTML = Array.from({ length: 10 }, () => `<span class="spark-bar" style="height: 4px; opacity: 0.25;"></span>`).join('');
      return;
    }
    const maxTok = Math.max(100, ...recent.map((l) => Number(l.totalTokens || 0)));
    sparkEl.innerHTML = recent
      .map((l) => {
        const ratio = Math.max(0.15, Number(l.totalTokens || 0) / maxTok);
        const h = Math.round(ratio * 22);
        return `<span class="spark-bar" style="height: ${h}px;" title="${window.SG.formatTokens(l.totalTokens || 0)} tok"></span>`;
      })
      .join('');
  }

  function getModelColor(model) {
    if (!model) return 'var(--brand)';
    const m = model.toLowerCase();
    if (m.includes('claude')) return '#c084fc'; // Purple for Claude
    if (m.includes('flash')) return '#38bdf8'; // Blue for Flash
    if (m.includes('argon') || m.includes('pro')) return '#fbbf24'; // Amber for Argon/Pro
    if (m.includes('gpt')) return '#34d399'; // Emerald for GPT
    if (m.includes('deepseek')) return '#818cf8'; // Indigo for DeepSeek
    return 'var(--brand)';
  }

  function renderActivityStream(logs) {
    const streamEl = document.getElementById('tab1-activity-stream');
    if (!streamEl) return;

    const subset = (logs || []).slice(0, 12);
    if (subset.length === 0) {
      streamEl.innerHTML = `<div style="padding: 28px 12px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">Chưa có giao dịch API nào gần đây.</div>`;
      return;
    }

    const esc = window.SG.escapeHtml;
    const fmt = window.SG.formatTokens;
    streamEl.innerHTML = subset
      .map((l) => {
        const is200 = Number(l.statusCode) === 200;
        const dotColor = is200 ? 'var(--status-up)' : 'var(--status-err)';
        const lat = l.latencyMs ? `${(l.latencyMs / 1000).toFixed(1)}s` : '--';
        const timeStr = new Date(l.timestamp).toLocaleTimeString();
        const acct = (l.email || l.profile || '').split('@')[0];
        const mColor = getModelColor(l.model);

        return `
          <div class="activity-row">
            <div class="activity-left">
              <span class="activity-dot" style="background: ${dotColor};"></span>
              <div class="activity-main">
                <div class="activity-model" style="color: ${mColor}; font-weight: 700;">${esc(l.model)}</div>
                <div class="activity-sub">${esc(acct)} · ${esc(timeStr)}</div>
              </div>
            </div>
            <div class="activity-right">
              <div style="font-weight: 700; color: var(--text-primary);">${fmt(l.totalTokens || 0)} tok</div>
              <div style="color: ${is200 ? 'var(--text-muted)' : 'var(--status-err)'};">${esc(lat)} · ${esc(l.statusCode)}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function buildAuditRowsHtml(logs) {
    if (!logs || logs.length === 0) {
      return `<tr><td colspan="9" class="table-empty">Chưa có giao dịch API nào được ghi nhận.</td></tr>`;
    }

    const esc = window.SG.escapeHtml;
    return logs
      .map((l) => {
        const dt = new Date(l.timestamp);
        const time = dt.toLocaleTimeString();
        const date = dt.toLocaleDateString();
        const lat = l.latencyMs ? `${(l.latencyMs / 1000).toFixed(2)}s` : '--';
        const latColor =
          !l.latencyMs
            ? 'var(--text-muted)'
            : l.latencyMs < 5000
              ? 'var(--status-up)'
              : l.latencyMs < 12000
                ? 'var(--status-warn)'
                : 'var(--status-err)';
        const is200 = Number(l.statusCode) === 200;
        const mColor = getModelColor(l.model);

        return `
          <tr>
            <td>
              <div class="mono-num" style="font-weight: 700; font-size: 0.78rem;">${esc(time)}</div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">${esc(date)}</div>
            </td>
            <td>
              <div style="font-weight: 600; color: var(--text-primary);">${esc(l.email || l.profile)}</div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">${l.virtualKey ? `Key: ${esc(l.virtualKey)}` : 'Direct Client'}</div>
            </td>
            <td><span class="badge" style="background: ${mColor}22; color: ${mColor}; border: 1px solid ${mColor}44; font-weight: 700;">${esc(l.model)}</span></td>
            <td class="mono-num" style="color: var(--text-secondary);">${Number(l.promptTokens || 0).toLocaleString()}</td>
            <td class="mono-num" style="color: var(--status-up);">${Number(l.completionTokens || 0).toLocaleString()}</td>
            <td class="mono-num" style="font-weight: 700;">${Number(l.totalTokens || 0).toLocaleString()}</td>
            <td class="mono-num" style="color: ${latColor}; font-weight: 600;">${esc(lat)}</td>
            <td><span class="badge ${is200 ? 'badge-success' : 'badge-danger'}">${esc(l.statusCode)}</span></td>
            <td><span class="mono-num" style="font-size: 0.72rem; color: var(--text-muted);">${l.stream ? 'SSE' : 'Sync'}</span></td>
          </tr>
        `;
      })
      .join('');
  }

  function filterLogsByQuery(logs, query) {
    if (!query) return logs;
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        (l.model && l.model.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.profile && l.profile.toLowerCase().includes(q))
    );
  }

  function applyLogFilters() {
    const q1 = document.getElementById('tab1-log-search-field')?.value || '';
    const q2 = document.getElementById('tab2-log-search-field')?.value || '';

    renderActivityStream(filterLogsByQuery(window.SG.cachedLogsData, q1));

    const tb2 = document.getElementById('tab2-logs-grid-body');
    if (tb2) {
      tb2.innerHTML = buildAuditRowsHtml(filterLogsByQuery(window.SG.cachedLogsData, q2));
    }
  }

  window.onSearchTab1Logs = applyLogFilters;
  window.onSearchTab2Logs = applyLogFilters;

  window.confirmClearLogs = async function () {
    if (!confirm('Xóa toàn bộ nhật ký sử dụng token?')) return;
    try {
      const res = await fetch('/api/usage/logs', { method: 'DELETE' });
      if (res.ok) {
        window.SG.toast('Đã xóa sạch nhật ký giao dịch');
        window.fetchAuditLogs();
        window.fetchAnalyticsData();
      }
    } catch (_) {}
  };
})();
