/* ==========================================================================
   Switch Google — UniFi Etherlighting Switch, Slide-Out Inspector & Topology
   ========================================================================== */

(function () {
  const STRATEGY_EXPLANATIONS = {
    'least-traffic':
      'Least-Traffic: tự động chọn cổng có lượng token thấp nhất để san tải đồng đều và cách ly lỗi 429.',
    'round-robin':
      'Round-Robin: xoay vòng tuần tự qua các cổng đang sẵn sàng theo định mức req và token mỗi lượt.',
    fallback:
      'Fallback: dồn tải vào cổng ưu tiên số 1, chỉ chuyển mạch sang cổng dự phòng khi gặp 429/hết quota.',
    fixed:
      'Fixed: ghim toàn bộ lưu lượng vào duy nhất một cổng mặc định đang chọn.'
  };

  let currentRackViewMode = localStorage.getItem('switch_ports_view_mode') || 'single';
  let lastPortsSignature = '';
  let lastTopoSignature = '';

  const LCM_MODE_LABELS = {
    'least-traffic': 'BALANCED',
    'round-robin': 'ROUND-ROBIN',
    fallback: 'FALLBACK',
    fixed: 'FIXED'
  };

  /* --- Strategy & Rotation Controls --- */
  function applyStrategyVisual(strat) {
    const resolved = STRATEGY_EXPLANATIONS[strat] ? strat : 'round-robin';
    window.SG.activeStrategy = resolved;

    document.querySelectorAll('.strategy-pill[data-strategy]').forEach((btn) => {
      const active = btn.getAttribute('data-strategy') === resolved;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const lcmMode = document.getElementById('lcm-mode-tag');
    if (lcmMode) lcmMode.textContent = LCM_MODE_LABELS[resolved] || resolved.toUpperCase();

    const explEl = document.getElementById('strategy-explanation');
    if (explEl) explEl.textContent = STRATEGY_EXPLANATIONS[resolved];
  }

  window.selectStrategyMode = async function (strat) {
    applyStrategyVisual(strat);
    await window.saveRotationConfig();
  };

  window.saveRotationConfig = async function () {
    const strategy = window.SG.activeStrategy || 'least-traffic';
    const requestsPerTurn =
      parseInt(document.getElementById('config-requests-per-turn')?.value, 10) || 1;
    const tokensPerTurn =
      parseInt(document.getElementById('config-tokens-per-turn')?.value, 10) || 50000;

    try {
      const res = await fetch('/api/rotation/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, requestsPerTurn, tokensPerTurn })
      });
      if (res.ok) {
        window.SG.toast(`Đã lưu chiến lược ${strategy.toUpperCase()}`);
        window.fetchSwitchStatus();
      } else {
        window.SG.toast('Không thể lưu cấu hình luân phiên', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi lưu cấu hình: ${err.message}`, 'error');
    }
  };

  /* --- Switch Status Polling & Single Pane of Glass Telemetry --- */
  window.fetchSwitchStatus = async function () {
    try {
      const res = await fetch(`/api/status?timeframe=${encodeURIComponent(window.SG.selectedTimeframe)}`);
      if (!res.ok) return;
      const data = await res.json();

      window.SG.liveTrafficData = data.liveTraffic || null;
      applyStrategyVisual(data.strategy);

      if (!window.SG.rotationConfigLoaded && data.rotationConfig) {
        const reqEl = document.getElementById('config-requests-per-turn');
        const tokEl = document.getElementById('config-tokens-per-turn');
        if (reqEl) reqEl.value = data.rotationConfig.requestsPerTurn;
        if (tokEl) tokEl.value = data.rotationConfig.tokensPerTurn;
        window.SG.rotationConfigLoaded = true;
      }

      const ports = data.ports || [];
      window.SG.cachedPorts = ports;

      updateTelemetryStrip(ports, data.usageStats || {}, data.uplink || {});
      renderEtherlightingSwitch(ports, data.serving, data.latestModel);
      renderAiTopology(ports, data.serving);

      if (data.autoModelFallback !== undefined) {
        updateAutoFallbackUI(data.autoModelFallback);
      }

      if (window.SG.inspectedProfile) {
        renderPortInspector();
      }
    } catch (_) {}
  };

  function updateTelemetryStrip(ports, usageStats, uplink) {
    const upCount = ports.filter((p) => !p.isDisabled && p.linkStatus === 'up').length;
    const cooldownCount = ports.filter((p) => !p.isDisabled && p.linkStatus === 'cooldown').length;

    const healthVal = document.getElementById('sg-health-val');
    const healthSub = document.getElementById('sg-health-sub');
    if (healthVal) healthVal.innerHTML = `${upCount} <span class="metric-tile-unit">/ ${ports.length} cổng UP</span>`;
    if (healthSub) {
      healthSub.textContent =
        cooldownCount > 0 ? `${cooldownCount} cổng đang cooldown` : 'Tất cả cổng sẵn sàng';
    }

    const tpsVal = document.getElementById('sg-tps-val');
    if (tpsVal) {
      tpsVal.innerHTML = `${Number(usageStats.tokensPerSecond || 0).toLocaleString()} <span class="metric-tile-unit">tok/s</span>`;
    }

    const avgLat = Number(usageStats.avgLatencyMs || 0);
    const latVal = document.getElementById('sg-latency-val');
    const latBadge = document.getElementById('sg-latency-badge');
    if (latVal) latVal.innerHTML = `${avgLat.toLocaleString()} <span class="metric-tile-unit">ms</span>`;
    if (latBadge) {
      if (!avgLat) {
        latBadge.className = 'badge badge-neutral';
        latBadge.textContent = 'IDLE';
      } else if (avgLat < 4000) {
        latBadge.className = 'badge badge-success';
        latBadge.textContent = 'FAST';
      } else {
        latBadge.className = 'badge badge-warning';
        latBadge.textContent = 'MODERATE';
      }
    }

    const volVal = document.getElementById('sg-volume-val');
    const volSub = document.getElementById('sg-volume-sub');
    const totalTok = uplink.totalTokens || usageStats.totalTokens || 0;
    const totalReq = uplink.totalRequests || usageStats.totalRequests || 0;
    if (volVal) volVal.textContent = window.SG.formatTokens(totalTok);
    if (volSub) volSub.textContent = `${Number(totalReq).toLocaleString()} requests (24h)`;
  }

  /* --- Render UniFi Pro Max Etherlighting Switch --- */
  function renderEtherlightingSwitch(ports, serving, latestModel) {
    const container = document.getElementById('rack-ports-container');
    const countBadge = document.getElementById('badge-port-count');
    const rackCountPill = document.getElementById('port-counter-text');
    const sfpVal = document.getElementById('sfp-token-val');
    const lcmPortEl = document.getElementById('lcm-port-num');
    const lcmModelEl = document.getElementById('lcm-model-name');

    if (countBadge) countBadge.textContent = ports.length;
    if (rackCountPill) {
      const upCount = ports.filter((p) => !p.isDisabled && p.linkStatus === 'up').length;
      rackCountPill.textContent = `${upCount}/${ports.length} UP`;
    }

    if (sfpVal) {
      const sumTok = ports.reduce((acc, p) => acc + (p.totalTokens || 0), 0);
      sfpVal.textContent = window.SG.formatTokens(sumTok);
    }

    const activeMatch =
      ports.find((p) => p.isServingNow) ||
      (serving?.account ? ports.find((p) => p.profile === serving.account) : null) ||
      ports[0];

    if (lcmPortEl) {
      lcmPortEl.textContent = activeMatch
        ? `PORT ${String(activeMatch.portNumber).padStart(2, '0')}`
        : 'NO PORT';
    }
    if (lcmModelEl) {
      lcmModelEl.textContent = latestModel || 'gemini-3.8-flash';
    }

    const topoModelBadge = document.getElementById('topo-active-model-badge');
    if (topoModelBadge) topoModelBadge.textContent = latestModel || 'gemini-3.8-flash';

    if (!container) return;

    const nextSig = JSON.stringify({
      selected: window.SG.inspectedProfile || '',
      ports: ports.map((p) => [
        p.profile,
        p.portNumber,
        p.type,
        p.email,
        p.isServingNow,
        p.isDisabled,
        p.isBlockedAntigravity,
        p.linkStatus,
        p.totalTokens,
        p.totalRequests
      ])
    });
    if (nextSig === lastPortsSignature) {
      return;
    }
    lastPortsSignature = nextSig;

    if (!ports || ports.length === 0) {
      container.innerHTML = `
        <div class="port-empty-state">
          <div style="font-size: 0.85rem; font-weight: 700;">Chưa có cổng tài khoản nào được kết nối</div>
          <button class="btn btn-primary btn-sm" onclick="openAddModal()">+ Thêm Cổng Đầu Tiên</button>
        </div>
      `;
      updateRackScrollButtons();
      return;
    }

    const esc = window.SG.escapeHtml;
    const fmt = window.SG.formatTokens;

    container.innerHTML = ports
      .map((p) => {
        const isLive = Boolean(p.isServingNow);
        const isBlocked = p.isBlockedAntigravity && p.type === 'oauth';
        const isSelected = window.SG.inspectedProfile === p.profile;
        const portCode = String(p.portNumber).padStart(2, '0');
        const shortName = esc((p.email || p.profile).split('@')[0]);

        let etherClass = 'ether-up';
        let leftLedClass = 'led-up';
        if (p.isDisabled) {
          etherClass = 'state-down';
          leftLedClass = '';
        } else if (isBlocked || p.linkStatus === 'banned') {
          etherClass = 'ether-err';
          leftLedClass = 'led-err';
        } else if (p.linkStatus === 'cooldown') {
          etherClass = 'ether-warn';
          leftLedClass = 'led-warn';
        } else if (isLive) {
          etherClass = 'ether-live';
          leftLedClass = 'led-up';
        }

        const safeProfile = window.SG.encodeArg(p.profile);

        return `
          <button
            type="button"
            class="ether-port ${etherClass} ${isSelected ? 'selected' : ''}"
            onclick="openPortInspector(decodeURIComponent('${safeProfile}'))"
            title="Bấm để xem chi tiết & điều khiển cổng ${esc(p.email || p.profile)}"
          >
            <div class="ether-port-top">
              <span>P${portCode}</span>
              <span class="ether-proto">${esc(p.type === 'web_session' ? 'WEB' : p.type)}</span>
            </div>

            <div class="ether-jack" aria-hidden="true">
              <span class="ether-led left ${leftLedClass}"></span>
              <span class="ether-led right ${isLive ? 'led-live' : ''}"></span>
              <div class="ether-pins"></div>
            </div>

            <div class="ether-name">${shortName}</div>

            <div class="ether-tok">
              <span>${fmt(p.totalTokens || 0)}</span>
              <span>${Number(p.totalRequests || 0)}r</span>
            </div>

            <div class="ether-glow-bar" aria-hidden="true"></div>
          </button>
        `;
      })
      .join('');

    setTimeout(updateRackScrollButtons, 40);
  }

  /* --- Slide-Out Port Inspector Drawer --- */
  window.openPortInspector = function (profile) {
    window.SG.inspectedProfile = profile;
    document.getElementById('inspector-backdrop')?.classList.add('open');
    const drawer = document.getElementById('port-inspector');
    if (drawer) {
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    }
    renderEtherlightingSwitch(window.SG.cachedPorts, null, document.getElementById('lcm-model-name')?.textContent);
    renderPortInspector();
  };

  window.closePortInspector = function () {
    window.SG.inspectedProfile = null;
    document.getElementById('inspector-backdrop')?.classList.remove('open');
    const drawer = document.getElementById('port-inspector');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (window.SG.cachedPorts.length > 0) {
      renderEtherlightingSwitch(window.SG.cachedPorts, null, document.getElementById('lcm-model-name')?.textContent);
    }
  };

  function renderPortInspector() {
    const profile = window.SG.inspectedProfile;
    if (!profile) return;
    const p = (window.SG.cachedPorts || []).find((item) => item.profile === profile);
    const titleEl = document.getElementById('inspector-port-title');
    const subEl = document.getElementById('inspector-port-sub');
    const bodyEl = document.getElementById('inspector-body');
    if (!bodyEl) return;

    if (!p) {
      window.closePortInspector();
      return;
    }

    const esc = window.SG.escapeHtml;
    const code = String(p.portNumber).padStart(2, '0');
    const health = window.SG.realHealthResults[p.profile];
    const safeProfile = window.SG.encodeArg(p.profile);

    if (titleEl) titleEl.textContent = `Port ${code} · ${(p.email || p.profile).split('@')[0]}`;
    if (subEl) subEl.textContent = p.email || p.profile;

    let statusBadge = `<span class="badge badge-success">Sẵn sàng (UP)</span>`;
    if (p.isDisabled) statusBadge = `<span class="badge badge-neutral">Đã rút cáp (OFF)</span>`;
    else if (p.isBlockedAntigravity && p.type === 'oauth') statusBadge = `<span class="badge badge-danger">Bị chặn Antigravity</span>`;
    else if (p.linkStatus === 'banned') statusBadge = `<span class="badge badge-danger">Banned (TOS)</span>`;
    else if (p.linkStatus === 'cooldown') statusBadge = `<span class="badge badge-warning">Cooldown (${p.cooldownRemainingSeconds}s)</span>`;
    else if (p.isServingNow) statusBadge = `<span class="badge badge-live">Đang phục vụ Live</span>`;

    const pingDisplay = health
      ? health.ok
        ? `${health.latencyMs} ms (OK)`
        : `Lỗi (${health.message || 'Fail'})`
      : 'Chưa kiểm tra';

    const portLogs = (window.SG.cachedLogsData || [])
      .filter((l) => l.profile === p.profile || (p.email && l.email === p.email))
      .slice(0, 6);

    bodyEl.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        ${statusBadge}
        <span class="badge badge-neutral">${esc(p.type)}</span>
      </div>

      <div class="inspector-kpis">
        <div class="inspector-kpi">
          <div class="inspector-kpi-lbl">Tổng Tokens</div>
          <div class="inspector-kpi-val">${Number(p.totalTokens || 0).toLocaleString()}</div>
        </div>
        <div class="inspector-kpi">
          <div class="inspector-kpi-lbl">Requests</div>
          <div class="inspector-kpi-val">${Number(p.totalRequests || 0).toLocaleString()}</div>
        </div>
        <div class="inspector-kpi">
          <div class="inspector-kpi-lbl">Độ trễ Ping</div>
          <div class="inspector-kpi-val" style="font-size: 0.82rem;">${esc(pingDisplay)}</div>
        </div>
        <div class="inspector-kpi">
          <div class="inspector-kpi-lbl">Mặc định</div>
          <div class="inspector-kpi-val" style="font-size: 0.82rem;">${p.isActiveDefault ? 'Đang chọn' : 'Không'}</div>
        </div>
      </div>

      <div class="inspector-section-title">Điều khiển cổng</div>
      <div class="inspector-actions">
        ${
          p.isBlockedAntigravity && p.type === 'oauth'
            ? `<button class="btn btn-primary" onclick="upgradeToWebMode(decodeURIComponent('${safeProfile}'))">Chuyển sang Gemini Web Mode</button>`
            : ''
        }
        <button class="btn btn-primary" onclick="switchActiveProfile(decodeURIComponent('${safeProfile}'))">Đặt làm cổng mặc định</button>
        <button class="btn" onclick="runPingSingle(decodeURIComponent('${safeProfile}'))">Ping kiểm tra kết nối thực tế</button>
        <button class="btn" onclick="toggleSwitchPort(decodeURIComponent('${safeProfile}'), ${!p.isDisabled})">
          ${p.isDisabled ? 'Cắm lại cáp (Kích hoạt)' : 'Rút cáp (Tạm ngắt cổng)'}
        </button>
        <button class="btn btn-danger" onclick="deleteAccount(decodeURIComponent('${safeProfile}'))">Xóa tài khoản khỏi Switch</button>
      </div>

      <div class="inspector-section-title">Giao dịch gần đây của cổng</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${
          portLogs.length === 0
            ? `<div style="font-size: 0.78rem; color: var(--text-muted);">Chưa ghi nhận giao dịch nào cho cổng này.</div>`
            : portLogs
                .map(
                  (l) => `
                <div class="activity-row">
                  <div class="activity-main">
                    <div class="activity-model">${esc(l.model)}</div>
                    <div class="activity-sub">${esc(new Date(l.timestamp).toLocaleTimeString())}</div>
                  </div>
                  <div class="activity-right">
                    <div style="font-weight: 700;">${window.SG.formatTokens(l.totalTokens || 0)} tok</div>
                    <div style="color: ${Number(l.statusCode) === 200 ? 'var(--status-up)' : 'var(--status-err)'};">${esc(l.statusCode)}</div>
                  </div>
                </div>
              `
                )
                .join('')
        }
      </div>
    `;
  }

  window.refreshPortInspectorIfOpen = function () {
    if (window.SG.inspectedProfile) renderPortInspector();
  };

  /* --- Rack Controls (Single / Dual Tier & Scroll) --- */
  function applyRackViewMode() {
    const deck = document.getElementById('rack-ports-container');
    const label = document.getElementById('rack-view-mode-label');
    if (!deck) return;

    if (currentRackViewMode === 'dual') {
      deck.classList.add('dual-tier-matrix');
      if (label) label.textContent = '2 Hàng';
    } else {
      deck.classList.remove('dual-tier-matrix');
      if (label) label.textContent = '1 Hàng';
    }
    setTimeout(updateRackScrollButtons, 60);
  }

  window.toggleRackViewMode = function () {
    currentRackViewMode = currentRackViewMode === 'single' ? 'dual' : 'single';
    localStorage.setItem('switch_ports_view_mode', currentRackViewMode);
    applyRackViewMode();
  };

  window.scrollRackPorts = function (direction) {
    const deck = document.getElementById('rack-ports-container');
    if (!deck) return;
    const amount = Math.max(320, Math.floor(deck.clientWidth * 0.75));
    deck.scrollBy({ left: direction * amount, behavior: 'smooth' });
    setTimeout(updateRackScrollButtons, 320);
  };

  function updateRackScrollButtons() {
    const deck = document.getElementById('rack-ports-container');
    const btnLeft = document.getElementById('rack-scroll-left');
    const btnRight = document.getElementById('rack-scroll-right');
    if (!deck || !btnLeft || !btnRight) return;

    const maxScroll = deck.scrollWidth - deck.clientWidth;
    if (maxScroll <= 4) {
      btnLeft.classList.add('disabled');
      btnRight.classList.add('disabled');
    } else {
      btnLeft.classList.toggle('disabled', deck.scrollLeft <= 5);
      btnRight.classList.toggle('disabled', deck.scrollLeft >= maxScroll - 5);
    }
  }

  window.jumpToActivePort = function () {
    const deck = document.getElementById('rack-ports-container');
    if (!deck) return;
    const target =
      deck.querySelector('.ether-port.ether-live') ||
      deck.querySelector('.ether-port:not(.state-down)');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    setTimeout(updateRackScrollButtons, 320);
  };

  window.initRackScrollEvents = function () {
    const deck = document.getElementById('rack-ports-container');
    if (!deck) return;
    deck.addEventListener('scroll', updateRackScrollButtons, { passive: true });
    deck.addEventListener(
      'wheel',
      (e) => {
        if (deck.scrollWidth > deck.clientWidth && e.deltaY !== 0 && e.deltaX === 0) {
          e.preventDefault();
          deck.scrollLeft += e.deltaY;
          updateRackScrollButtons();
        }
      },
      { passive: false }
    );
    window.addEventListener('resize', () => {
      updateRackScrollButtons();
      if (window.SG.cachedPorts.length > 0) {
        window.drawSvgCables(window.SG.cachedPorts, window.SG.cachedActiveProfile);
      }
    });
    applyRackViewMode();
  };

  /* --- Live Account-to-AI Topology Map --- */
  function renderAiTopology(ports, servingData) {
    const container = document.getElementById('topo-accounts-list');
    const pathsGroup = document.getElementById('svg-paths-group');
    if (!container || !pathsGroup) return;

    if (!ports || ports.length === 0) {
      container.innerHTML = `<div style="padding: 16px; font-size: 0.78rem; color: var(--text-muted);">Chưa có tài khoản định tuyến.</div>`;
      pathsGroup.innerHTML = '';
      return;
    }

    const activePort =
      ports.find((p) => p.isServingNow) ||
      (servingData?.account ? ports.find((p) => p.profile === servingData.account) : null) ||
      ports.find((p) => p.isActiveDefault) ||
      ports[0];

    const activeProfile = activePort ? activePort.profile : null;
    window.SG.cachedActiveProfile = activeProfile;

    const topoSig = JSON.stringify({
      activeProfile,
      ports: ports.map((p) => [
        p.profile,
        p.portNumber,
        p.email,
        p.isDisabled,
        p.linkStatus,
        p.cooldownRemainingSeconds,
        p.totalTokens,
        window.SG.realHealthResults[p.profile]?.latencyMs ?? null,
        window.SG.realHealthResults[p.profile]?.ok ?? null
      ])
    });

    if (topoSig !== lastTopoSignature) {
      lastTopoSignature = topoSig;
      const esc = window.SG.escapeHtml;
      const fmt = window.SG.formatTokens;

      container.innerHTML = ports
        .map((p, idx) => {
          const isActive = p.profile === activeProfile;
          const isDown = p.isDisabled;
          const health = window.SG.realHealthResults[p.profile];
          const safeProfile = window.SG.encodeArg(p.profile);
          const portCode = String(p.portNumber).padStart(2, '0');
          const shortName = esc((p.email || p.profile).split('@')[0]);

          let healthText = 'Chưa ping';
          let healthColor = 'var(--text-muted)';
          if (health) {
            healthText = health.ok ? `${health.latencyMs}ms` : 'Lỗi';
            healthColor = health.ok ? 'var(--status-up)' : 'var(--status-err)';
          }

          const nodeClass = isActive ? 'active-routing' : isDown ? 'node-disabled' : '';
          const statusBadgeClass = isDown
            ? 'badge-neutral'
            : p.linkStatus === 'banned'
              ? 'badge-danger'
              : p.linkStatus === 'cooldown'
                ? 'badge-warning'
                : isActive
                  ? 'badge-primary'
                  : 'badge-neutral';
          const statusBadgeText = isDown
            ? 'OFF'
            : p.linkStatus === 'banned'
              ? 'BANNED'
              : p.linkStatus === 'cooldown'
                ? `COOL ${p.cooldownRemainingSeconds}s`
                : isActive
                  ? 'ACTIVE'
                  : 'READY';

          return `
            <div class="topo-node ${nodeClass}" id="topo-node-${idx}" onclick="openPortInspector(decodeURIComponent('${safeProfile}'))">
              <div class="topo-node-left">
                <div class="topo-node-title" title="${esc(p.email || p.profile)}">P${portCode}: ${shortName}</div>
                <div class="topo-node-meta">
                  <span>${fmt(p.totalTokens || 0)} tok</span>
                  <span>·</span>
                  <span style="color: ${healthColor}; font-weight: 700;">${esc(healthText)}</span>
                </div>
              </div>
              <span class="badge ${statusBadgeClass}">${statusBadgeText}</span>
              <div class="topo-pin ${isActive ? 'active' : ''}" id="topo-pin-${idx}"></div>
            </div>
          `;
        })
        .join('');
    }

    const activeNameEl = document.getElementById('topo-active-account-name');
    if (activeNameEl && activePort) {
      const code = String(activePort.portNumber).padStart(2, '0');
      const short = (activePort.email || activePort.profile).split('@')[0];
      activeNameEl.textContent = `P${code}: ${short}`;
      activeNameEl.title = activePort.email || activePort.profile;
    }

    const totalTokens = ports.reduce((acc, p) => acc + (p.totalTokens || 0), 0);
    const totalEl = document.getElementById('topo-total-ai-tokens');
    if (totalEl) totalEl.textContent = `${window.SG.formatTokens(totalTokens)} tok`;

    setTimeout(() => window.drawSvgCables(ports, activeProfile), 50);
  }

  window.drawSvgCables = function (ports) {
    const wrap = document.getElementById('topo-cable-wrap');
    const pathsGroup = document.getElementById('svg-paths-group');
    if (!wrap || !pathsGroup) return;

    const wrapRect = wrap.getBoundingClientRect();
    if (wrapRect.width === 0 || wrapRect.height === 0) return;

    const W = wrapRect.width;
    const H = wrapRect.height;
    const targetY = H / 2;

    let pathsHtml = '';
    let badgesHtml = '';
    const live = window.SG.liveTrafficData;

    ports.forEach((p, idx) => {
      const pinEl = document.getElementById(`topo-pin-${idx}`);
      if (!pinEl) return;
      const pinRect = pinEl.getBoundingClientRect();
      const startY = pinRect.top + pinRect.height / 2 - wrapRect.top;
      const cp1x = W * 0.45;
      const cp2x = W * 0.55;
      const d = `M 0,${startY} C ${cp1x},${startY} ${cp2x},${targetY} ${W},${targetY}`;

      const isDown = p.isDisabled;
      const health = window.SG.realHealthResults[p.profile];
      const isError = health && !health.ok;
      const isTransmitting =
        live &&
        live.isTransmitting &&
        (live.account === p.profile || live.account === p.email);

      if (isTransmitting) {
        const tokVal = live.tokens || 100;
        const strokeWidth = Math.min(6.5, Math.max(2.5, 2 + Math.log10(tokVal) * 1.1)).toFixed(1);
        const animDuration = Math.max(0.35, Math.min(0.75, 1.1 - Math.log10(tokVal) * 0.18)).toFixed(2);
        pathsHtml += `<path d="${d}" class="cable-transmitting" stroke="url(#grad-laser-flow)" stroke-width="${strokeWidth}" style="animation-duration: ${animDuration}s;" />`;

        const midX = W * 0.5;
        const midY = (startY + targetY) / 2;
        const badgeText = `+${window.SG.formatTokens(tokVal)} tok`;
        const badgeWidth = Math.max(88, badgeText.length * 7.2);

        badgesHtml += `
          <g transform="translate(${midX - badgeWidth / 2}, ${midY - 12})">
            <rect width="${badgeWidth}" height="24" class="laser-badge-rect" />
            <text x="${badgeWidth / 2}" y="12" class="laser-badge-text">${window.SG.escapeHtml(badgeText)}</text>
          </g>
        `;
      } else if (isDown) {
        pathsHtml += `<path d="${d}" class="cable-disabled" />`;
      } else if (isError) {
        pathsHtml += `<path d="${d}" class="cable-error" />`;
      } else {
        pathsHtml += `<path d="${d}" class="cable-idle" />`;
      }
    });

    pathsGroup.innerHTML = pathsHtml + badgesHtml;
  };

  /* --- Port & Account Actions --- */
  window.runPingAllPorts = async function () {
    const btn = document.getElementById('btn-ping-all');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang Ping...';
    }
    window.SG.toast('Đang gửi tín hiệu kiểm tra kết nối tới Google API...');

    try {
      const res = await fetch('/api/ports/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.results) {
        window.SG.realHealthResults = data.results;
        window.SG.toast('Đã cập nhật trạng thái kết nối thực tế');
        if (window.SG.cachedPorts.length > 0) {
          renderAiTopology(window.SG.cachedPorts, null);
          window.refreshPortInspectorIfOpen();
        }
      }
    } catch (err) {
      window.SG.toast(`Lỗi khi ping: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ping Kiểm Tra';
      }
    }
  };

  window.runPingSingle = async function (profile) {
    window.SG.toast(`Đang ping cổng [${profile}]...`);
    try {
      const res = await fetch('/api/ports/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile })
      });
      const data = await res.json();
      if (data.results && data.results[profile]) {
        const info = data.results[profile];
        window.SG.realHealthResults[profile] = info;
        window.SG.toast(
          `${info.ok ? 'OK' : 'Lỗi'} [${profile}]: ${info.message} (${info.latencyMs}ms)`,
          info.ok ? 'info' : 'error'
        );
        if (window.SG.cachedPorts.length > 0) {
          renderAiTopology(window.SG.cachedPorts, null);
          window.refreshPortInspectorIfOpen();
        }
      }
    } catch (err) {
      window.SG.toast(`Lỗi ping: ${err.message}`, 'error');
    }
  };

  window.switchActiveProfile = async function (profile) {
    try {
      const res = await fetch('/api/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile })
      });
      if (res.ok) {
        window.SG.toast(`Đã đặt cổng mặc định [${profile}]`);
        window.fetchSwitchStatus();
      }
    } catch (_) {}
  };

  window.toggleSwitchPort = async function (profile, newDisabledState) {
    try {
      const res = await fetch('/api/ports/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, disabled: newDisabledState })
      });
      if (res.ok) {
        window.SG.toast(`Đã ${newDisabledState ? 'rút cáp' : 'cắm lại cáp'} cổng [${profile}]`);
        window.fetchSwitchStatus();
      }
    } catch (_) {}
  };

  window.deleteAccount = async function (profile) {
    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản [${profile}] khỏi Switch Google?`)) return;
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profile)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(`Đã xóa tài khoản [${profile}]`);
        delete window.SG.realHealthResults[profile];
        if (window.SG.inspectedProfile === profile) {
          window.closePortInspector();
        }
        window.fetchSwitchStatus();
      } else {
        window.SG.toast(data.error || 'Không thể xóa tài khoản', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  /* --- Modal: Add Port --- */
  window.openAddModal = function () {
    window.openModalById('modal-add-port');
  };

  window.closeAddModal = function () {
    window.closeModalById('modal-add-port');
  };

  window.switchModalTab = function (tabId) {
    ['oauth', 'web', 'key', 'cookie', 'token'].forEach((t) => {
      const pane = document.getElementById(`m-pane-${t}`);
      const btn = document.getElementById(`tab-modal-${t}`);
      if (pane) pane.style.display = t === tabId ? 'flex' : 'none';
      if (btn) btn.classList.toggle('active', t === tabId);
    });
  };

  window.executeAddOAuth = async function () {
    window.SG.toast('Đang mở trình duyệt đăng nhập Google OAuth...', 'info', 4500);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        if (data.isBlockedAntigravity) {
          window.SG.toast(
            `Tài khoản [${data.email}] bị chặn Antigravity — bấm vào cổng trên Switch để chuyển Web Mode.`,
            'error',
            7000
          );
        } else {
          window.SG.toast(`Đăng nhập thành công cổng [${data.email}]`);
        }
        window.closeAddModal();
        window.fetchSwitchStatus();
      } else {
        window.SG.toast(`Lỗi OAuth: ${data.error || 'Không xác định'}`, 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ khi đăng nhập OAuth', 'error');
    }
  };

  window.executeAddWebAuto = async function () {
    const btn = document.getElementById('btn-web-login');
    const statusDiv = document.getElementById('web-login-status');
    if (btn) btn.disabled = true;
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.textContent = 'Đang mở Chrome... Hãy đăng nhập Google trên cửa sổ trình duyệt vừa mở.';
    }
    window.SG.toast('Đang khởi chạy xác thực Google Web Mode...');

    try {
      const res = await fetch('/api/login/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(`${data.message || 'Đăng nhập Web Mode thành công'} (${data.email})`);
        window.closeAddModal();
        window.fetchSwitchStatus();
      } else {
        window.SG.toast(data.error || 'Xác thực Web Mode thất bại', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối server khi đăng nhập Web Mode', 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (statusDiv) statusDiv.style.display = 'none';
    }
  };

  window.executeAddApiKey = async function () {
    const nameEl = document.getElementById('m-key-name');
    const keyEl = document.getElementById('m-key-value');
    const name = nameEl?.value.trim();
    const key = keyEl?.value.trim();
    if (!name || !key) return window.SG.toast('Vui lòng nhập đầy đủ tên cổng và API Key', 'error');

    try {
      const res = await fetch('/api/profiles/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: name, apiKey: key })
      });
      if (res.ok) {
        window.SG.toast(`Đã thêm cổng API Key [${name}]`);
        if (nameEl) nameEl.value = '';
        if (keyEl) keyEl.value = '';
        window.closeAddModal();
        window.fetchSwitchStatus();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể lưu API Key', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ', 'error');
    }
  };

  window.executeAddCookie = async function () {
    const nameEl = document.getElementById('m-cookie-name');
    const emailEl = document.getElementById('m-cookie-email');
    const valEl = document.getElementById('m-cookie-value');
    const profile = nameEl?.value.trim();
    const email = emailEl?.value.trim();
    const cookies = valEl?.value.trim();
    if (!profile || !cookies) {
      return window.SG.toast('Vui lòng nhập tên cổng và chuỗi Cookie', 'error');
    }

    try {
      const res = await fetch('/api/profiles/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, email, cookies })
      });
      if (res.ok) {
        window.SG.toast(`Đã thêm cổng Web Cookie [${profile}]`);
        if (nameEl) nameEl.value = '';
        if (emailEl) emailEl.value = '';
        if (valEl) valEl.value = '';
        window.closeAddModal();
        window.fetchSwitchStatus();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể lưu Cookie', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ', 'error');
    }
  };

  window.executeAddToken = async function () {
    const nameEl = document.getElementById('m-tok-name');
    const emailEl = document.getElementById('m-tok-email');
    const accessEl = document.getElementById('m-tok-access');
    const refreshEl = document.getElementById('m-tok-refresh');
    const profile = nameEl?.value.trim();
    const email = emailEl?.value.trim();
    const accessToken = accessEl?.value.trim();
    const refreshToken = refreshEl?.value.trim();

    if (!profile || !accessToken) {
      return window.SG.toast('Vui lòng nhập tên cổng và Access Token', 'error');
    }

    try {
      const res = await fetch('/api/profiles/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, email, accessToken, refreshToken })
      });
      if (res.ok) {
        window.SG.toast(`Đã lưu cổng Token [${profile}]`);
        if (nameEl) nameEl.value = '';
        if (emailEl) emailEl.value = '';
        if (accessEl) accessEl.value = '';
        if (refreshEl) refreshEl.value = '';
        window.closeAddModal();
        window.fetchSwitchStatus();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể lưu Token', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ', 'error');
    }
  };

  /* --- Modal: Upgrade Blocked OAuth to Gemini Web Mode --- */
  window.upgradeToWebMode = function (profile) {
    window.SG.currentUpgradeProfile = profile;
    const titleEl = document.getElementById('web-upgrade-account-title');
    if (titleEl) titleEl.textContent = `Tài khoản: ${profile}`;
    const progress = document.getElementById('auto-web-progress');
    if (progress) progress.style.display = 'none';
    const btn = document.getElementById('btn-start-auto-web');
    if (btn) btn.disabled = false;
    const input = document.getElementById('manual-web-cookie');
    if (input) input.value = '';
    window.openModalById('modal-web-upgrade');
  };

  window.closeWebUpgradeModal = function () {
    window.closeModalById('modal-web-upgrade');
    window.SG.currentUpgradeProfile = null;
  };

  window.startAutoWebCapture = async function () {
    const profile = window.SG.currentUpgradeProfile;
    if (!profile) return;
    const btn = document.getElementById('btn-start-auto-web');
    const progress = document.getElementById('auto-web-progress');
    const statusText = document.getElementById('auto-web-status-text');
    if (btn) btn.disabled = true;
    if (progress) progress.style.display = 'flex';
    if (statusText) {
      statusText.textContent = 'Đang mở Chrome... Hãy đăng nhập và mở gemini.google.com trên cửa sổ vừa xuất hiện.';
    }

    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profile)}/upgrade-web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(data.message || 'Đã chuyển sang Web Mode thành công');
        window.closeWebUpgradeModal();
        window.fetchSwitchStatus();
        window.runPingSingle(profile);
      } else {
        if (statusText) statusText.textContent = `Lỗi: ${data.error || 'Không thể chuyển đổi'}`;
        if (btn) btn.disabled = false;
        window.SG.toast(data.error || 'Không thể chuyển đổi Web Mode', 'error');
      }
    } catch (err) {
      if (statusText) statusText.textContent = `Lỗi kết nối: ${err.message}`;
      if (btn) btn.disabled = false;
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  window.submitManualWebCookie = async function () {
    const profile = window.SG.currentUpgradeProfile;
    if (!profile) return;
    const cookieVal = document.getElementById('manual-web-cookie')?.value.trim();
    if (!cookieVal) {
      return window.SG.toast('Vui lòng dán chuỗi Cookie hoặc __Secure-1PSID', 'error');
    }

    window.SG.toast('Đang kiểm tra Cookie và kích hoạt Web Mode...');
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profile)}/set-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieVal })
      });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(data.message || 'Đã kích hoạt Web Mode thành công');
        window.closeWebUpgradeModal();
        window.fetchSwitchStatus();
        window.runPingSingle(profile);
      } else {
        window.SG.toast(data.error || 'Cookie không hợp lệ', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  /* --- Reset All Banned Ports & Clear Cooldowns --- */
  window.resetAllBannedPorts = async function () {
    const btn = document.getElementById('btn-reset-bans');
    if (btn) btn.disabled = true;
    try {
      window.SG.toast('Đang khôi phục tất cả cổng...');
      const res = await fetch('/api/rotator/reset-bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(`✓ Đã khôi phục thành công ${data.unbanned?.length || 0} cổng!`);
        await window.fetchSwitchStatus();
      } else {
        window.SG.toast(`Lỗi: ${data.error || 'Không thể khôi phục cổng'}`, 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /* --- Auto-Model Fallback on 429 Quota Exhaustion --- */
  window.toggleAutoFallback = async function () {
    const btn = document.getElementById('btn-auto-fallback');
    const isCurrentlyOn = btn ? btn.textContent.includes('BẬT') : true;
    const nextState = !isCurrentlyOn;
    try {
      const res = await fetch('/api/settings/fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      if (res.ok) {
        window.SG.toast(`Đã ${nextState ? 'BẬT' : 'TẮT'} tự động chuyển Model khi hết Quota`);
        updateAutoFallbackUI(nextState);
      }
    } catch (err) {
      window.SG.toast(`Lỗi: ${err.message}`, 'error');
    }
  };

  function updateAutoFallbackUI(enabled) {
    const btn = document.getElementById('btn-auto-fallback');
    if (!btn) return;
    if (enabled) {
      btn.innerHTML = `<span id="badge-auto-fallback-dot" style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981; margin-right:4px;"></span>Auto-Fallback: BẬT`;
      btn.classList.remove('btn-ghost');
    } else {
      btn.innerHTML = `<span id="badge-auto-fallback-dot" style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#ef4444; margin-right:4px;"></span>Auto-Fallback: TẮT`;
      btn.classList.add('btn-ghost');
    }
  }
})();
