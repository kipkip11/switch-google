/* ==========================================================================
   Switch Google — Model Combos, Virtual API Keys, MITM Integration & System
   ========================================================================== */

(function () {
  const AVAILABLE_MODELS = [
    {
      group: 'Google Gemini & Argon (CloudCode)',
      models: [
        { id: 'gemini-4-argon-high', label: 'gemini-4-argon-high (Argon High - Tư duy sâu)' },
        { id: 'gemini-4-argon', label: 'gemini-4-argon (Argon Pro)' },
        { id: 'gemini-3.8-flash-high', label: 'gemini-3.8-flash-high (Flash High)' },
        { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (Siêu Tốc)' },
        { id: 'gemini-3.8-pro', label: 'gemini-3.8-pro (Tư duy sâu)' },
        { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
        { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
        { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
        { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash' }
      ]
    },
    {
      group: 'Anthropic Claude',
      models: [
        { id: 'claude-sonnet-5-5-high', label: 'claude-sonnet-5-5-high (Sonnet 5.5 High)' },
        { id: 'claude-3-7-sonnet', label: 'claude-3-7-sonnet (Claude 3.7 Pro)' },
        { id: 'claude-3-7-sonnet-thinking', label: 'claude-3-7-sonnet-thinking' },
        { id: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet' }
      ]
    },
    {
      group: 'OpenAI & DeepSeek',
      models: [
        { id: 'gpt-4o', label: 'gpt-4o' },
        { id: 'deepseek-r1', label: 'deepseek-r1 (Reasoning)' },
        { id: 'deepseek-v3', label: 'deepseek-v3' }
      ]
    }
  ];

  function getModelPickerOptionsHtml(placeholder = '-- Chọn model thêm vào --') {
    const esc = window.SG.escapeHtml;
    let html = `<option value="">${esc(placeholder)}</option>`;
    AVAILABLE_MODELS.forEach((grp) => {
      html += `<optgroup label="${esc(grp.group)}">`;
      grp.models.forEach((m) => {
        html += `<option value="${esc(m.id)}">${esc(m.label)}</option>`;
      });
      html += `</optgroup>`;
    });
    html += `<option value="__custom__">+ Nhập model tùy chỉnh...</option>`;
    return html;
  }

  /* ========================================================================
     MODEL COMBOS
     ======================================================================== */
  window.fetchCombos = async function () {
    try {
      const res = await fetch('/api/combos');
      if (!res.ok) return;
      const data = await res.json();
      window.SG.cachedCombosList = data.combos || [];
      renderCombosDeck(window.SG.cachedCombosList);
    } catch (_) { }
  };

  function getModelTagColor(model) {
    if (!model) return 'var(--brand)';
    const m = model.toLowerCase();
    if (m.includes('claude')) return '#c084fc';
    if (m.includes('flash')) return '#38bdf8';
    if (m.includes('argon') || m.includes('pro')) return '#fbbf24';
    if (m.includes('gpt')) return '#34d399';
    if (m.includes('deepseek')) return '#818cf8';
    return 'var(--brand)';
  }

  function renderCombosDeck(combos) {
    const deck = document.getElementById('combos-grid-deck');
    if (!deck) return;
    if (!combos || combos.length === 0) {
      deck.innerHTML = `<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-default); border-radius: var(--radius-md);">Chưa có Model Combo nào. Dùng khối tạo nhanh phía trên hoặc chọn một Preset.</div>`;
      return;
    }

    const esc = window.SG.escapeHtml;
    deck.innerHTML = combos
      .map((c) => {
        const safeId = window.SG.encodeArg(c.id);
        const safeName = window.SG.encodeArg(c.name);
        const isSystemActive = Boolean(c.isActive);
        const activeModelName = c.activeModel || (c.models && c.models.length > 0 ? c.models[0] : null);

        const modelsHtml = (c.models || [])
          .map((m) => {
            const isSelected = m === activeModelName;
            const safeM = window.SG.encodeArg(m);
            const mColor = getModelTagColor(m);

            return `
              <div class="combo-model-row ${isSelected ? 'active-model-row' : ''}" onclick="selectModelInCombo(decodeURIComponent('${safeId}'), decodeURIComponent('${safeM}'))" title="Bấm để chọn sử dụng model này">
                <div class="combo-model-meta">
                  <span class="combo-radio-indicator ${isSelected ? 'checked' : ''}"></span>
                  <span class="combo-model-name" style="color: ${isSelected ? mColor : 'var(--text-primary)'}; font-weight: ${isSelected ? '700' : '500'};">${esc(m)}</span>
                  ${isSelected ? `<span class="badge badge-success" style="font-size: 0.65rem; padding: 2px 6px;">✓ ĐANG DÙNG</span>` : `<span class="combo-select-prompt">Bấm chọn</span>`}
                </div>
                <button class="model-chip-remove" onclick="event.stopPropagation(); removeModelFromCombo(decodeURIComponent('${safeId}'), decodeURIComponent('${safeM}'))" aria-label="Xóa ${esc(m)}" title="Xóa model khỏi combo">×</button>
              </div>
            `;
          })
          .join('');

        return `
          <div class="combo-card ${isSystemActive ? 'active-system-combo' : ''}">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
              <div>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <strong style="font-size: 1rem; color: var(--text-primary);">${esc(c.name)}</strong>
                  ${isSystemActive ? `<span class="badge badge-success" style="font-weight: 700;">⚡ HỆ THỐNG ĐANG DÙNG</span>` : ''}
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">
                  Model đang chọn: <strong style="color: ${getModelTagColor(activeModelName)}; font-family: var(--font-mono);">${esc(activeModelName || 'Chưa chọn')}</strong>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="badge ${c.strategy === 'smart-routing' ? 'badge-primary' : 'badge-neutral'}">${esc((c.strategy || 'fallback').toUpperCase())}</span>
                <button class="btn btn-xs" onclick="openEditComboModal(decodeURIComponent('${safeId}'))">Sửa</button>
              </div>
            </div>

            <div class="combo-models-section">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">Model Trong Combo (${(c.models || []).length}):</span>
                <span style="font-size: 0.7rem; color: var(--text-muted);">Bấm model để chọn dùng</span>
              </div>
              <div class="combo-model-list">
                ${modelsHtml || '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.75rem;">Chưa có model nào. Thêm model bên dưới.</div>'}
              </div>
            </div>

            <div style="display: flex; gap: 6px; align-items: center;">
              <select id="select-add-model-${esc(c.id)}" class="input-control input-sm" style="flex: 1;" onchange="handleComboModelSelectChange(decodeURIComponent('${safeId}'), this)">
                ${getModelPickerOptionsHtml()}
              </select>
              <button class="btn btn-primary btn-sm" onclick="submitAddModelFromSelect(decodeURIComponent('${safeId}'))">Thêm</button>
            </div>

            <div id="custom-model-row-${esc(c.id)}" style="display: none; gap: 6px; align-items: center;">
              <input type="text" id="input-custom-model-${esc(c.id)}" class="input-control input-sm" placeholder="Nhập tên model tùy chỉnh..." style="flex: 1;" onkeydown="if(event.key==='Enter') submitCustomModel(decodeURIComponent('${safeId}'))" />
              <button class="btn btn-sm" onclick="submitCustomModel(decodeURIComponent('${safeId}'))">Lưu</button>
            </div>

            <div style="display: flex; gap: 8px; padding-top: 10px; margin-top: auto; border-top: 1px solid var(--border-subtle); align-items: center;">
              <button class="btn ${isSystemActive ? 'btn-ghost' : 'btn-primary'} btn-sm" style="flex: 1.2;" onclick="toggleActivateCombo(decodeURIComponent('${safeId}'), ${!isSystemActive})">
                ${isSystemActive ? 'Tắt Kích Hoạt' : '⚡ Kích Hoạt Hệ Thống'}
              </button>
              <button class="btn btn-sm" onclick="copyPlain(decodeURIComponent('${safeName}'))" title="Sao chép tên combo">Copy tên</button>
              <button class="btn btn-danger btn-sm" onclick="removeCombo(decodeURIComponent('${safeId}'))">Xóa</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  window.selectModelInCombo = async function (comboId, model) {
    try {
      const res = await fetch(`/api/combos/${encodeURIComponent(comboId)}/select-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      if (res.ok) {
        window.SG.toast(`✓ Đã chọn sử dụng model [${model}]`);
        window.fetchCombos();
        // Đồng bộ ngay nhãn model trên Switch LCM & Topology Hub
        const lcmModelEl = document.getElementById('lcm-model-name');
        const topoModelBadge = document.getElementById('topo-active-model-badge');
        if (lcmModelEl) lcmModelEl.textContent = model;
        if (topoModelBadge) topoModelBadge.textContent = model;
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể chọn model', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  window.toggleActivateCombo = async function (comboId, active) {
    try {
      const res = await fetch(`/api/combos/${encodeURIComponent(comboId)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
      });
      if (res.ok) {
        window.SG.toast(active ? '⚡ Đã kích hoạt Combo cho Antigravity IDE & Gateway!' : 'Đã tắt kích hoạt Combo');
        window.fetchCombos();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể đổi trạng thái combo', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  window.toggleModelChip = function (chipEl) {
    const cb = chipEl.querySelector('.combo-box');
    if (!cb) return;
    cb.checked = !cb.checked;
    chipEl.classList.toggle('active', cb.checked);
  };

  window.applySmartPreset = function (presetKey) {
    const titleInput = document.getElementById('combo-title');
    const chips = document.querySelectorAll('.model-toggle-chip');
    chips.forEach((chip) => {
      const cb = chip.querySelector('.combo-box');
      if (cb) cb.checked = false;
      chip.classList.remove('active');
    });

    let targetModels = [];
    if (presetKey === 'smart-pro') {
      if (titleInput) titleInput.value = 'AI';
      targetModels = ['gemini-3.8-flash', 'gemini-3.8-pro', 'claude-3-7-sonnet'];
    } else if (presetKey === 'fast-pro') {
      if (titleInput) titleInput.value = 'pro-fast';
      targetModels = ['gemini-3.8-flash', 'gemini-2.5-flash'];
    } else if (presetKey === 'claude') {
      if (titleInput) titleInput.value = 'claude-chain';
      targetModels = ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'gemini-3.8-flash'];
    }

    chips.forEach((chip) => {
      const cb = chip.querySelector('.combo-box');
      if (cb && targetModels.includes(cb.value)) {
        cb.checked = true;
        chip.classList.add('active');
      }
    });
    window.SG.toast(`Đã áp dụng Preset: ${titleInput?.value || presetKey}`);
  };

  window.submitCreateCombo = async function () {
    const nameEl = document.getElementById('combo-title');
    const modeEl = document.getElementById('combo-mode');
    const name = nameEl?.value.trim();
    const strategy = modeEl?.value || 'fallback';
    const checked = Array.from(document.querySelectorAll('.combo-box:checked')).map((el) => el.value);

    if (!name || checked.length === 0) {
      return window.SG.toast('Vui lòng nhập tên Combo và chọn ít nhất 1 model', 'error');
    }

    try {
      const res = await fetch('/api/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, strategy, models: checked })
      });
      if (res.ok) {
        window.SG.toast(`Đã lưu Model Combo [${name}]`);
        if (nameEl) nameEl.value = '';
        window.fetchCombos();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể tạo combo', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ', 'error');
    }
  };

  window.handleComboModelSelectChange = function (comboId, selectEl) {
    const customRow = document.getElementById(`custom-model-row-${comboId}`);
    if (!customRow) return;
    if (selectEl.value === '__custom__') {
      customRow.style.display = 'flex';
      document.getElementById(`input-custom-model-${comboId}`)?.focus();
    } else {
      customRow.style.display = 'none';
    }
  };

  window.submitAddModelFromSelect = async function (comboId) {
    const select = document.getElementById(`select-add-model-${comboId}`);
    if (!select) return;
    const model = select.value.trim();
    if (!model) return window.SG.toast('Vui lòng chọn một model', 'error');
    if (model === '__custom__') return window.submitCustomModel(comboId);
    await executeAddModelApi(comboId, model);
    select.value = '';
  };

  window.submitCustomModel = async function (comboId) {
    const input = document.getElementById(`input-custom-model-${comboId}`);
    const model = input?.value.trim();
    if (!model) return window.SG.toast('Vui lòng nhập tên model tùy chỉnh', 'error');
    await executeAddModelApi(comboId, model);
    if (input) input.value = '';
    const customRow = document.getElementById(`custom-model-row-${comboId}`);
    if (customRow) customRow.style.display = 'none';
    const select = document.getElementById(`select-add-model-${comboId}`);
    if (select) select.value = '';
  };

  async function executeAddModelApi(comboId, model) {
    try {
      const res = await fetch(`/api/combos/${encodeURIComponent(comboId)}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      if (res.ok) {
        window.SG.toast(`Đã thêm [${model}] vào combo`);
        window.fetchCombos();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể thêm model', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  }

  window.removeModelFromCombo = async function (comboId, model) {
    if (!confirm(`Xóa model [${model}] khỏi combo này?`)) return;
    try {
      const res = await fetch(
        `/api/combos/${encodeURIComponent(comboId)}/models/${encodeURIComponent(model)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        window.SG.toast(`Đã xóa model [${model}]`);
        window.fetchCombos();
      }
    } catch (_) { }
  };

  window.removeCombo = async function (id) {
    if (!confirm('Xóa toàn bộ Model Combo này?')) return;
    try {
      const res = await fetch(`/api/combos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        window.SG.toast('Đã xóa Model Combo');
        window.fetchCombos();
      }
    } catch (_) { }
  };

  /* Edit Combo Modal */
  window.openEditComboModal = function (comboId) {
    const combo = (window.SG.cachedCombosList || []).find((c) => c.id === comboId);
    if (!combo) return;
    window.SG.currentEditingCombo = JSON.parse(JSON.stringify(combo));

    const nameEl = document.getElementById('edit-combo-name');
    const stratEl = document.getElementById('edit-combo-strategy');
    const pickerEl = document.getElementById('edit-combo-model-picker');
    const customRow = document.getElementById('edit-combo-custom-row');

    if (nameEl) nameEl.value = window.SG.currentEditingCombo.name;
    if (stratEl) stratEl.value = window.SG.currentEditingCombo.strategy || 'fallback';
    if (pickerEl) {
      pickerEl.innerHTML = getModelPickerOptionsHtml('-- Chọn model để thêm --');
      pickerEl.value = '';
    }
    if (customRow) customRow.style.display = 'none';

    renderEditComboModalChips();
    window.openModalById('modal-edit-combo');
  };

  window.closeEditComboModal = function () {
    window.closeModalById('modal-edit-combo');
    window.SG.currentEditingCombo = null;
  };

  function renderEditComboModalChips() {
    const combo = window.SG.currentEditingCombo;
    if (!combo) return;
    const container = document.getElementById('edit-combo-chips-container');
    const countEl = document.getElementById('edit-combo-count');
    if (countEl) countEl.textContent = `${combo.models.length} model`;
    if (!container) return;

    if (combo.models.length === 0) {
      container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.78rem;">Chưa có model nào. Chọn thêm bên dưới.</span>`;
      return;
    }

    const esc = window.SG.escapeHtml;
    container.innerHTML = combo.models
      .map((m) => {
        const safeM = encodeURIComponent(m);
        return `
          <span class="model-chip-tag">
            <span>${esc(m)}</span>
            <button class="model-chip-remove" onclick="removeModelInEditModal(decodeURIComponent('${safeM}'))" aria-label="Xóa ${esc(m)}">×</button>
          </span>
        `;
      })
      .join('');
  }

  window.removeModelInEditModal = function (model) {
    if (!window.SG.currentEditingCombo) return;
    window.SG.currentEditingCombo.models = window.SG.currentEditingCombo.models.filter((m) => m !== model);
    renderEditComboModalChips();
  };

  window.handleEditModalSelectChange = function (selectEl) {
    const customRow = document.getElementById('edit-combo-custom-row');
    if (!customRow) return;
    if (selectEl.value === '__custom__') {
      customRow.style.display = 'flex';
      document.getElementById('edit-combo-custom-input')?.focus();
    } else {
      customRow.style.display = 'none';
    }
  };

  window.submitAddModelInEditModal = function () {
    const combo = window.SG.currentEditingCombo;
    const picker = document.getElementById('edit-combo-model-picker');
    if (!combo || !picker) return;
    const val = picker.value.trim();
    if (!val) return window.SG.toast('Vui lòng chọn một model', 'error');
    if (val === '__custom__') return window.submitAddCustomModelInEditModal();
    if (combo.models.includes(val)) return window.SG.toast(`Model [${val}] đã có trong combo`);
    combo.models.push(val);
    picker.value = '';
    renderEditComboModalChips();
  };

  window.submitAddCustomModelInEditModal = function () {
    const combo = window.SG.currentEditingCombo;
    const input = document.getElementById('edit-combo-custom-input');
    const val = input?.value.trim();
    if (!combo || !val) return window.SG.toast('Vui lòng nhập tên model tùy chỉnh', 'error');
    if (combo.models.includes(val)) return window.SG.toast(`Model [${val}] đã có trong combo`);
    combo.models.push(val);
    input.value = '';
    const customRow = document.getElementById('edit-combo-custom-row');
    if (customRow) customRow.style.display = 'none';
    const picker = document.getElementById('edit-combo-model-picker');
    if (picker) picker.value = '';
    renderEditComboModalChips();
  };

  window.saveEditComboModal = async function () {
    const combo = window.SG.currentEditingCombo;
    if (!combo) return;
    const name = document.getElementById('edit-combo-name')?.value.trim();
    const strategy = document.getElementById('edit-combo-strategy')?.value || 'fallback';
    if (!name) return window.SG.toast('Tên Combo không được để trống', 'error');
    if (combo.models.length === 0) return window.SG.toast('Combo phải có ít nhất 1 model', 'error');

    try {
      const res = await fetch(`/api/combos/${encodeURIComponent(combo.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, strategy, models: combo.models })
      });
      if (res.ok) {
        window.SG.toast(`Đã lưu thay đổi cho Combo [${name}]`);
        window.closeEditComboModal();
        window.fetchCombos();
      } else {
        const err = await res.json();
        window.SG.toast(err.error || 'Không thể lưu thay đổi', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  /* ========================================================================
     VIRTUAL API KEYS
     ======================================================================== */
  window.fetchApiKeys = async function () {
    try {
      const res = await fetch('/api/keys');
      if (!res.ok) return;
      const data = await res.json();
      const keys = data.keys || [];
      const badge = document.getElementById('badge-key-count');
      if (badge) badge.textContent = keys.length;
      renderKeysGrid(keys);
    } catch (_) { }
  };

  function renderKeysGrid(keys) {
    const tbody = document.getElementById('keys-grid-body');
    if (!tbody) return;
    if (!keys || keys.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Chưa có Virtual API Key nào. Tạo key đầu tiên phía trên.</td></tr>`;
      return;
    }

    const esc = window.SG.escapeHtml;
    tbody.innerHTML = keys
      .map((k) => {
        const masked =
          k.key && k.key.length > 20 ? `${k.key.slice(0, 14)}••••${k.key.slice(-6)}` : k.key || '';
        const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Chưa sử dụng';
        const safeKey = window.SG.encodeArg(k.key || '');
        const safeId = window.SG.encodeArg(k.id);

        return `
          <tr>
            <td><strong>${esc(k.name)}</strong></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <code class="mono-num" style="color: var(--brand-text); font-size: 0.78rem;">${esc(masked)}</code>
                <button class="btn btn-xs" onclick="copyPlain(decodeURIComponent('${safeKey}'))">Copy</button>
              </div>
            </td>
            <td style="color: var(--text-muted); font-size: 0.78rem;">${esc(new Date(k.createdAt).toLocaleDateString())}</td>
            <td style="color: var(--text-muted); font-size: 0.78rem;">${esc(lastUsed)}</td>
            <td>
              <button class="btn btn-danger btn-xs" onclick="removeApiKey(decodeURIComponent('${safeId}'))">Xóa</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  window.submitCreateApiKey = async function () {
    const input = document.getElementById('new-key-label');
    const label = input?.value.trim();
    if (!label) return window.SG.toast('Vui lòng nhập tên nhãn cho API Key', 'error');

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label })
      });
      if (res.ok) {
        window.SG.toast(`Đã tạo Virtual Key [${label}]`);
        if (input) input.value = '';
        window.fetchApiKeys();
      }
    } catch (_) { }
  };

  window.removeApiKey = async function (id) {
    if (!confirm('Xóa Virtual API Key này?')) return;
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        window.SG.toast('Đã xóa API Key');
        window.fetchApiKeys();
      }
    } catch (_) { }
  };

  /* ========================================================================
     ANTIGRAVITY DIRECT LINK (MITM)
     ======================================================================== */
  window.checkMitmStatus = async function () {
    try {
      const res = await fetch('/api/mitm/status');
      if (!res.ok) return;
      const info = await res.json();
      window.SG.mitmInfo = info;

      const badge = document.getElementById('mitm-status-badge');
      const portBadge = document.getElementById('mitm-port-badge');
      const btn = document.getElementById('btn-toggle-mitm');
      if (badge && btn) {
        if (info.running) {
          badge.textContent = 'ĐANG HOẠT ĐỘNG';
          badge.className = 'badge badge-success';
          btn.textContent = 'Dừng Direct Link';
          btn.className = 'btn btn-danger';
        } else {
          badge.textContent = 'CHƯA BẬT';
          badge.className = 'badge badge-neutral';
          btn.textContent = 'Kích Hoạt Direct Link';
          btn.className = 'btn btn-primary';
        }
      }

      if (portBadge) {
        if (info.running && info.port) {
          portBadge.style.display = 'inline-block';
          portBadge.textContent = info.port === 443 ? 'Port 443 (Direct Root)' : `Port ${info.port} (Cần Forward 443)`;
          portBadge.className = info.port === 443 ? 'badge badge-success' : 'badge badge-warning';
        } else {
          portBadge.style.display = 'none';
        }
      }
    } catch (_) { }
  };

  window.toggleMitmDirectLink = async function () {
    const willEnable = !window.SG.mitmInfo.running;
    try {
      const res = await fetch('/api/mitm/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: willEnable })
      });
      const data = await res.json();
      if (data.success) {
        window.SG.toast(willEnable ? 'Đã kích hoạt Antigravity Direct Link' : 'Đã dừng Direct Link');
        window.checkMitmStatus();
      } else {
        window.SG.toast(data.error || 'Không thể đổi trạng thái Direct Link', 'error');
      }
    } catch (_) {
      window.SG.toast('Lỗi kết nối máy chủ', 'error');
    }
  };

  window.copyTrustCommand = function () {
    const cmd =
      window.SG.mitmInfo.trustCommand ||
      'sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.config/switch-google/mitm/rootCA.crt';
    window.SG.copyText(cmd, 'Đã sao chép lệnh tin cậy Root CA');
  };

  window.copyHostsCommand = function () {
    const cmd =
      window.SG.mitmInfo.enableDnsCommand ||
      'echo "127.0.0.1 daily-cloudcode-pa.googleapis.com" | sudo tee -a /etc/hosts';
    window.SG.copyText(cmd, 'Đã sao chép lệnh cấu hình Hosts');
  };

  window.copyPortForwardCommand = function () {
    const defaultCmd =
      'sudo sysctl -w net.inet.ip.forwarding=1 && (sudo pfctl -e 2>/dev/null || true) && echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443" | sudo pfctl -a com.apple/switchgoogle -f -';
    const cmd = window.SG.mitmInfo.portForwardCommand || defaultCmd;
    window.SG.copyText(cmd, 'Đã sao chép lệnh Port Forwarding');
  };

  window.copyDisablePortForwardCommand = function () {
    const defaultCmd = 'sudo pfctl -a com.apple/switchgoogle -F all';
    const cmd = window.SG.mitmInfo.disablePortForwardCommand || defaultCmd;
    window.SG.copyText(cmd, 'Đã sao chép lệnh hủy Port Forwarding');
  };

  /* ========================================================================
     REMOTE & MULTI-DEVICE (TAILSCALE & CLOUDFLARE TUNNEL)
     ======================================================================== */
  let cloudflarePublicUrl = null;

  window.fetchNetworkStatus = async function () {
    try {
      const res = await fetch('/api/network/status');
      if (!res.ok) return;
      const data = await res.json();

      // Cập nhật Tailscale IP
      const tsBadge = document.getElementById('remote-tailscale-badge');
      const tsIpBadge = document.getElementById('remote-ts-ip-badge');
      const tsBox = document.getElementById('remote-ts-base-url');

      if (data.tailscale && data.tailscale.ip) {
        if (tsBadge) { tsBadge.textContent = 'Tailscale Active'; tsBadge.className = 'badge badge-success'; }
        if (tsIpBadge) tsIpBadge.textContent = data.tailscale.ip;
        if (tsBox) tsBox.textContent = `http://${data.tailscale.ip}:1909/v1`;
      } else {
        if (tsBadge) { tsBadge.textContent = 'Tailscale Offline'; tsBadge.className = 'badge badge-neutral'; }
        if (tsIpBadge) tsIpBadge.textContent = 'Chưa kết nối';
      }

      // Cập nhật Cloudflare Tunnel
      const toggle = document.getElementById('toggle-cf-tunnel');
      const cfBox = document.getElementById('remote-cf-url-box');
      const cfCopyBtn = document.getElementById('btn-copy-cf');

      if (data.cloudflare && data.cloudflare.running && data.cloudflare.url) {
        cloudflarePublicUrl = data.cloudflare.url;
        if (toggle) toggle.checked = true;
        if (cfBox) {
          cfBox.textContent = `${data.cloudflare.url}/v1`;
          cfBox.style.color = '#10B981';
        }
        if (cfCopyBtn) cfCopyBtn.disabled = false;
      } else {
        cloudflarePublicUrl = null;
        if (toggle) toggle.checked = false;
        if (cfBox) {
          cfBox.textContent = 'Chưa kích hoạt Cloudflare Tunnel';
          cfBox.style.color = 'var(--text-muted)';
        }
        if (cfCopyBtn) cfCopyBtn.disabled = true;
      }
    } catch (_) {}
  };

  window.toggleCloudflareTunnel = async function (enabled) {
    const cfBox = document.getElementById('remote-cf-url-box');
    const cfCopyBtn = document.getElementById('btn-copy-cf');
    if (cfBox) cfBox.textContent = enabled ? '⏳ Đang khởi tạo đường truyền Cloudflare...' : 'Chưa kích hoạt Cloudflare Tunnel';

    try {
      const res = await fetch('/api/network/cloudflare/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi bật/tắt Cloudflare Tunnel');

      if (data.running && data.url) {
        cloudflarePublicUrl = data.url;
        if (cfBox) {
          cfBox.textContent = `${data.url}/v1`;
          cfBox.style.color = '#10B981';
        }
        if (cfCopyBtn) cfCopyBtn.disabled = false;
        alert(`🎉 Đã kích hoạt Cloudflare Tunnel thành công!\nURL: ${data.url}`);
      } else {
        cloudflarePublicUrl = null;
        if (cfBox) {
          cfBox.textContent = 'Chưa kích hoạt Cloudflare Tunnel';
          cfBox.style.color = 'var(--text-muted)';
        }
        if (cfCopyBtn) cfCopyBtn.disabled = true;
      }
    } catch (err) {
      alert(`Lỗi: ${err.message}`);
      window.fetchNetworkStatus();
    }
  };

  window.copyCloudflareUrl = function () {
    if (cloudflarePublicUrl) {
      window.SG.copyText(`${cloudflarePublicUrl}/v1`, 'Đã sao chép Cloudflare Public URL');
    }
  };

  /* ========================================================================
     SYSTEM, DAEMON, AUTO-UPDATE & BACKUP/RESTORE
     ======================================================================== */
  window.checkSystemVersion = async function () {
    try {
      const res = await fetch('/api/system/version');
      if (!res.ok) return;
      const data = await res.json();
      window.SG.currentSystemInfo = data;

      const versionText = data.currentVersion ? `v${data.currentVersion}` : 'v1.3.1';
      const vBadge = document.getElementById('app-version-badge');
      const vSys = document.getElementById('sys-current-version');
      if (vBadge) vBadge.textContent = versionText;
      if (vSys) vSys.textContent = versionText;

      const ciBadge = document.getElementById('app-cicd-badge');
      const sysCi = document.getElementById('sys-ci-status');
      if (ciBadge) {
        if (data.ciPassed) {
          ciBadge.style.display = 'inline-block';
          ciBadge.textContent = 'CI OK';
          ciBadge.classList.remove('testing');
          ciBadge.title = data.ciDetails || 'Đã vượt qua bộ lọc CI/CD';
          if (sysCi) {
            sysCi.textContent = 'CI Verified';
            sysCi.className = 'badge badge-success';
          }
        } else if (data.ciStatus === 'in_progress') {
          ciBadge.style.display = 'inline-block';
          ciBadge.textContent = 'CI Testing';
          ciBadge.classList.add('testing');
          if (sysCi) {
            sysCi.textContent = 'CI Testing';
            sysCi.className = 'badge badge-warning';
          }
        } else {
          ciBadge.style.display = 'none';
          if (sysCi) {
            sysCi.textContent = 'Local Build';
            sysCi.className = 'badge badge-neutral';
          }
        }
      }

      const updateBtn = document.getElementById('btn-system-update');
      const updateText = document.getElementById('update-btn-text');
      const sysUpdateBtn = document.getElementById('sys-btn-update-now');
      if (updateBtn) {
        if (data.hasUpdate) {
          updateBtn.style.display = 'inline-flex';
          updateBtn.className = data.ciPassed ? 'btn btn-success btn-sm' : 'btn btn-warning btn-sm';
          if (updateText) {
            updateText.textContent = data.ciPassed
              ? `Cập nhật (${data.latestCommit})`
              : `Bản mới (${data.latestCommit})`;
          }
          if (sysUpdateBtn) sysUpdateBtn.style.display = 'inline-flex';
        } else {
          updateBtn.style.display = 'none';
          if (sysUpdateBtn) sysUpdateBtn.style.display = 'none';
        }
      }

      const autoUpdateBtn = document.getElementById('btn-toggle-autoupdate');
      if (autoUpdateBtn && data.autoUpdate) {
        const enabled = Boolean(data.autoUpdate.enabled);
        autoUpdateBtn.textContent = enabled ? 'Đang BẬT' : 'Đang TẮT';
        autoUpdateBtn.className = enabled ? 'btn btn-primary btn-sm' : 'btn btn-sm';
      }

      const autoStartBtn = document.getElementById('btn-toggle-autostart');
      if (autoStartBtn && data.daemon) {
        const enabled = Boolean(data.daemon.autoStartEnabled);
        autoStartBtn.textContent = enabled ? 'Đang BẬT' : 'Đang TẮT';
        autoStartBtn.className = enabled ? 'btn btn-primary btn-sm' : 'btn btn-sm';
      }
    } catch (_) { }
  };

  window.toggleAutoUpdate = async function () {
    const isEnabled = window.SG.currentSystemInfo?.autoUpdate?.enabled ?? true;
    const willEnable = !isEnabled;
    try {
      const res = await fetch('/api/system/update/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: willEnable })
      });
      const data = await res.json();
      if (data.success) {
        window.SG.toast(`Đã ${willEnable ? 'bật' : 'tắt'} tự động cập nhật ngầm`);
        window.checkSystemVersion();
      }
    } catch (err) {
      window.SG.toast(`Lỗi: ${err.message}`, 'error');
    }
  };

  window.toggleAutoStart = async function () {
    const isEnabled = window.SG.currentSystemInfo?.daemon?.autoStartEnabled || false;
    const willEnable = !isEnabled;
    try {
      const res = await fetch('/api/system/daemon/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: willEnable })
      });
      const data = await res.json();
      if (data.success) {
        window.SG.toast(data.message || `Đã ${willEnable ? 'bật' : 'tắt'} khởi động cùng máy`);
        window.checkSystemVersion();
      } else {
        window.SG.toast(data.message || 'Không thể đổi cấu hình khởi động', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  window.triggerSystemUpdate = async function () {
    if (!confirm('Cập nhật Switch Google lên phiên bản mới nhất từ GitHub và tự động build lại?')) return;
    window.SG.toast('Đang tải bản cập nhật từ GitHub và biên dịch lại...');
    try {
      const res = await fetch('/api/system/update', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.SG.toast('Cập nhật thành công! Đang tải lại giao diện...');
        setTimeout(() => window.location.reload(), 2000);
      } else {
        window.SG.toast(data.message || 'Cập nhật thất bại', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  window.triggerSystemRestart = async function () {
    if (!confirm('Khởi động lại Switch Google Server? Kết nối sẽ gián đoạn vài giây.')) return;
    window.SG.toast('Đang gửi lệnh khởi động lại máy chủ...');
    try {
      await fetch('/api/system/restart', { method: 'POST' });
      setTimeout(() => window.location.reload(), 3000);
    } catch (_) { }
  };

  window.triggerAutoRecover = async function () {
    window.SG.toast('Đang quét các tài khoản bị chặn Antigravity...');
    try {
      const res = await fetch('/api/auto-recover', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast(data.message || 'Hoàn tất quét tự phục hồi');
        window.fetchSwitchStatus?.();
      } else {
        window.SG.toast(data.error || 'Không thể chạy tự phục hồi', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi kết nối: ${err.message}`, 'error');
    }
  };

  /* Backup & Restore (JSON + SQLite) */
  window.downloadBackup = async function () {
    window.SG.toast('Đang xuất file sao lưu JSON...');
    try {
      const res = await fetch('/api/backup/export');
      if (!res.ok) return window.SG.toast('Lỗi khi xuất file sao lưu', 'error');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `switch-google-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      window.SG.toast('Đã tải xuống file sao lưu JSON');
    } catch (_) {
      window.SG.toast('Lỗi mạng khi xuất sao lưu', 'error');
    }
  };

  window.handleBackupFile = function (event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!confirm(`Phục hồi dữ liệu từ file JSON "${file.name}"?`)) return;
        window.SG.toast('Đang phục hồi dữ liệu JSON...');
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        const data = await res.json();
        if (res.ok) {
          window.SG.toast(data.message || 'Phục hồi sao lưu JSON thành công');
          window.fetchSwitchStatus?.();
          window.fetchApiKeys?.();
          window.fetchCombos?.();
          window.fetchAuditLogs?.();
        } else {
          window.SG.toast(data.error || 'Lỗi phục hồi JSON', 'error');
        }
      } catch (err) {
        window.SG.toast(`File JSON không hợp lệ: ${err.message}`, 'error');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  window.exportSqliteDatabase = function () {
    window.SG.toast('Đang tải cơ sở dữ liệu SQLite (.sqlite)...');
    window.location.href = '/api/backup/sqlite';
  };

  window.handleSqliteBackupFile = async function (event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm(`Phục hồi cơ sở dữ liệu từ file SQLite "${file.name}"? Dữ liệu hiện tại sẽ được cập nhật.`)) {
      event.target.value = '';
      return;
    }

    window.SG.toast('Đang nạp cơ sở dữ liệu SQLite...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch('/api/backup/sqlite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.sqlite3' },
        body: arrayBuffer
      });
      const data = await res.json();
      if (res.ok) {
        window.SG.toast('Phục hồi cơ sở dữ liệu SQLite thành công');
        window.fetchSwitchStatus?.();
        window.fetchCombos?.();
        window.fetchApiKeys?.();
        window.fetchAnalyticsData?.();
      } else {
        window.SG.toast(data.error || 'Không thể phục hồi SQLite', 'error');
      }
    } catch (err) {
      window.SG.toast(`Lỗi khi nạp SQLite: ${err.message}`, 'error');
    }
    event.target.value = '';
  };
})();
