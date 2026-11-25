/* ==========================================================================
   Switch Google — Subscriptions & Account Plans View
   ========================================================================== */

(function () {
  let cachedProfiles = [];

  window.fetchSubscriptionsList = async function () {
    const tbody = document.getElementById('subscriptions-table-body');
    const badge = document.getElementById('sub-active-count-badge');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">Đang cập nhật danh sách...</td></tr>';
    }

    try {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('Không thể lấy danh sách profiles');
      const data = await res.json();
      cachedProfiles = data.profiles || [];

      if (badge) {
        const activeCount = cachedProfiles.filter((p) => !p.isExpired).length;
        badge.textContent = `${activeCount}/${cachedProfiles.length} Đang hoạt động`;
        badge.className = activeCount > 0 ? 'badge badge-success' : 'badge badge-danger';
      }

      renderSubscriptionsTable(cachedProfiles);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--status-err);">Lỗi: ${err.message}</td></tr>`;
      }
    }
  };

  function renderSubscriptionsTable(profiles) {
    const tbody = document.getElementById('subscriptions-table-body');
    if (!tbody) return;

    if (!profiles || profiles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">Chưa có tài khoản nào trong hệ thống.</td></tr>';
      return;
    }

    const esc = window.SG.escapeHtml;

    tbody.innerHTML = profiles.map((p) => {
      const safeName = window.SG.encodeArg(p.name);
      const isExpired = Boolean(p.isExpired);
      const statusBadge = isExpired
        ? '<span class="badge badge-danger">Hết Hạn</span>'
        : '<span class="badge badge-success">Đang Hoạt Động</span>';

      const planTier = p.planTier || (p.type === 'web_session' ? 'Web Session Cookie' : p.type === 'token' ? 'OAuth Access Token' : 'Google AI Studio Key');
      const expiresAt = p.planExpiresAt || p.expiresAt || 'Không xác định';

      return `
        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;" onmouseover="this.style.background='var(--bg-canvas)'" onmouseout="this.style.background='transparent'">
          <td style="padding: 14px 20px;">
            <div style="font-weight: 600; color: var(--text-main);">${esc(p.email || p.name)}</div>
            <div style="font-size: 0.76rem; color: var(--text-muted); font-family: var(--font-mono);">${esc(p.name)}</div>
          </td>
          <td style="padding: 14px 20px;">
            <span class="badge badge-neutral" style="text-transform: uppercase;">${esc(p.type)}</span>
          </td>
          <td style="padding: 14px 20px;">
            <strong style="color: var(--brand-text); font-size: 0.9rem;">${esc(planTier)}</strong>
          </td>
          <td style="padding: 14px 20px;">
            <div style="font-family: var(--font-mono); font-size: 0.84rem; color: ${isExpired ? 'var(--status-err)' : 'var(--text-main)'};">
              ${esc(expiresAt)}
            </div>
          </td>
          <td style="padding: 14px 20px;">
            ${statusBadge}
          </td>
          <td style="padding: 14px 20px; text-align: right;">
            <button class="btn btn-sm btn-secondary" onclick="openEditSubscriptionModal(decodeURIComponent('${safeName}'))" style="font-size: 0.78rem;">
              ✏️ Sửa Gói
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openEditSubscriptionModal = function (profileName) {
    const p = cachedProfiles.find((item) => item.name === profileName);
    if (!p) return;

    const currentPlan = p.planTier || 'AI Premium (Google Gemini Advanced)';
    const currentExpiry = p.planExpiresAt || p.expiresAt || '';

    const newPlan = prompt(`Nhập tên gói đăng ký mới cho ${p.email || p.name}:`, currentPlan);
    if (newPlan === null) return;

    const newExpiry = prompt(`Nhập thời hạn gói (ví dụ: 31/12/2026 hoặc Không hết hạn):`, currentExpiry);
    if (newExpiry === null) return;

    saveSubscription(p.name, newPlan.trim(), newExpiry.trim());
  };

  async function saveSubscription(name, planTier, planExpiresAt) {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(name)}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier, planExpiresAt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi lưu thông tin gói');

      alert('Đã cập nhật thông tin gói thành công!');
      window.fetchSubscriptionsList();
    } catch (err) {
      alert(`Lỗi: ${err.message}`);
    }
  }
})();
