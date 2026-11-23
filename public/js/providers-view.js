/* ==========================================================================
   Switch Google — Dịch Vụ AI Mở Rộng View Controller
   ========================================================================== */

(function () {
  let providersCache = [];

  window.fetchProviders = async function () {
    const container = document.getElementById('providers-catalog-container');
    if (!container) return;

    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      providersCache = data.providers || [];
      renderProvidersCatalog(providersCache);
    } catch (e) {
      container.innerHTML = `<div class="card" style="color: var(--color-danger); padding: 20px;">Lỗi tải danh sách dịch vụ: ${e.message}</div>`;
    }
  };

  function renderProvidersCatalog(providers) {
    const container = document.getElementById('providers-catalog-container');
    if (!container) return;

    if (!providers || providers.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 40px; text-align: center; background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-color);">
          <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Chưa có dịch vụ nào</div>
          <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 16px;">Bấm nút "Thêm Dịch Vụ Mới" để thêm cấu hình nhà cung cấp AI.</p>
          <button class="btn btn-primary" onclick="openProviderModal()">+ Thêm Dịch Vụ Mới</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px;">
        ${providers.map((p) => {
          const isConfigured = Boolean(p.isFree || (p.apiKey && p.apiKey.length > 5));
          const escapeHtml = window.escapeHtml || (s => s);
          return `
            <div class="card provider-card" style="padding: 20px; border-radius: 12px; border: 1px solid ${p.enabled ? 'var(--color-primary)' : 'var(--border-color)'}; background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between; box-shadow: var(--shadow-sm); transition: transform 0.15s ease, box-shadow 0.15s ease;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(37, 99, 235, 0.08); color: var(--color-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem;">
                      ${p.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style="font-weight: 600; font-size: 1.05rem; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        ${escapeHtml(p.name)}
                        ${p.isFree ? '<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 8px;">Miễn Phí</span>' : '<span class="badge badge-info" style="font-size: 0.7rem; padding: 2px 8px;">API Key</span>'}
                      </div>
                      <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
                        ${isConfigured ? '<span style="color: #10B981;">● Sẵn sàng kết nối</span>' : '<span style="color: #F59E0B;">○ Chưa cấu hình Key</span>'}
                      </div>
                    </div>
                  </div>

                  <label class="switch" style="cursor: pointer;" title="Bật/Tắt dịch vụ">
                    <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="toggleProvider('${p.id}', this.checked)">
                    <span class="slider round"></span>
                  </label>
                </div>

                <div style="background: var(--bg-canvas, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 0.82rem;">
                  <div style="color: var(--text-muted); font-size: 0.74rem; margin-bottom: 2px;">Endpoint URL:</div>
                  <div style="font-family: monospace; color: var(--text-main); word-break: break-all;">
                    ${escapeHtml(p.baseUrl)}
                  </div>
                </div>

                <div style="margin-bottom: 16px;">
                  <div style="color: var(--text-muted); font-size: 0.74rem; margin-bottom: 6px;">Models hỗ trợ:</div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${(p.models || []).map(m => `<span style="background: var(--bg-surface, rgba(0,0,0,0.04)); border: 1px solid var(--border-color); padding: 2px 8px; border-radius: 6px; font-size: 0.76rem; font-family: monospace;">${escapeHtml(m)}</span>`).join('')}
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 8px;">
                <button class="btn btn-secondary btn-sm" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="openProviderModal('${p.id}')">
                  ⚙️ Cấu Hình
                </button>
                <button class="btn btn-ghost btn-sm" style="color: var(--color-danger); padding: 0 10px;" onclick="deleteProvider('${p.id}')" title="Xóa dịch vụ">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  window.toggleProvider = async function (id, enabled) {
    try {
      await fetch(`/api/providers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      window.fetchProviders();
    } catch (e) {
      alert(`Không thể cập nhật trạng thái: ${e.message}`);
    }
  };

  window.openProviderModal = function (providerId) {
    const modal = document.getElementById('provider-config-modal');
    if (!modal) return;

    const p = providerId ? providersCache.find(x => x.id === providerId) : null;

    document.getElementById('modal-provider-id').value = p ? p.id : '';
    document.getElementById('modal-provider-name').value = p ? p.name : '';
    document.getElementById('modal-provider-url').value = p ? p.baseUrl : 'https://api.example.com/v1';
    document.getElementById('modal-provider-key').value = p ? (p.apiKey || '') : '';
    document.getElementById('modal-provider-free').checked = p ? Boolean(p.isFree) : false;
    document.getElementById('modal-provider-models').value = p ? (p.models || []).join(', ') : 'default';

    document.getElementById('modal-provider-title').textContent = p ? `Cấu Hình Dịch Vụ: ${p.name}` : 'Thêm Dịch Vụ AI Mới';
    modal.style.display = 'flex';
  };

  window.closeProviderModal = function () {
    const modal = document.getElementById('provider-config-modal');
    if (modal) modal.style.display = 'none';
  };

  window.saveProviderFromModal = async function () {
    const id = document.getElementById('modal-provider-id').value || `prov_${Date.now()}`;
    const name = document.getElementById('modal-provider-name').value.trim();
    const baseUrl = document.getElementById('modal-provider-url').value.trim();
    const apiKey = document.getElementById('modal-provider-key').value.trim();
    const isFree = document.getElementById('modal-provider-free').checked;
    const rawModels = document.getElementById('modal-provider-models').value.trim();

    if (!name || !baseUrl) {
      alert('Vui lòng nhập Tên dịch vụ và Base URL.');
      return;
    }

    const models = rawModels.split(',').map(m => m.trim()).filter(Boolean);

    try {
      await fetch(`/api/providers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          baseUrl,
          apiKey,
          isFree,
          models: models.length > 0 ? models : ['default'],
          enabled: true
        })
      });
      window.closeProviderModal();
      window.fetchProviders();
    } catch (e) {
      alert(`Lỗi lưu dịch vụ: ${e.message}`);
    }
  };

  window.deleteProvider = async function (id) {
    if (!confirm('Bạn có chắc chắn muốn xóa dịch vụ này khỏi hệ thống?')) return;
    try {
      await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      window.fetchProviders();
    } catch (e) {
      alert(`Lỗi xóa dịch vụ: ${e.message}`);
    }
  };
})();
