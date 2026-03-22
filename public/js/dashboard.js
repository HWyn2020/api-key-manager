/* ============================================================
   API Key Manager — Dashboard SPA
   ============================================================ */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 1. State
  // ──────────────────────────────────────────────
  const state = {
    apiKey: null,
    currentView: 'overview',
    keys: [],
    auditLogs: [],
    stats: { total: 0, active: 0, revoked: 0, expired: 0, auditCount: 0 },
    pagination: { limit: 50, offset: 0 },
  };

  // ──────────────────────────────────────────────
  // 2. API Client
  // ──────────────────────────────────────────────
  var API_BASE = window.location.port === '5500' ? 'http://localhost:3000/api' : '/api';

  async function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.apiKey) {
      headers['Authorization'] = 'Bearer ' + state.apiKey;
    }
    var opts = { method: method, headers: headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(API_BASE + path, opts);
    var data = await res.json();
    if (!res.ok) {
      var err = new Error(data.error ? data.error.message : 'Request failed');
      err.status = res.status;
      err.code = data.error ? data.error.code : 'UNKNOWN';
      throw err;
    }
    return data;
  }

  // ──────────────────────────────────────────────
  // 3. Utilities
  // ──────────────────────────────────────────────
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    var s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    var d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function truncateId(id) {
    if (!id) return '—';
    return String(id).substring(0, 8);
  }

  function renderStatusBadge(status) {
    var colors = {
      active: 'badge-success',
      revoked: 'badge-danger',
      expired: 'badge-secondary',
      rotating: 'badge-warning',
    };
    var cls = colors[status] || 'badge-secondary';
    return '<span class="badge ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Copied to clipboard', 'success');
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard', 'success');
    } catch (_e) {
      showToast('Failed to copy', 'error');
    }
    document.body.removeChild(ta);
  }

  // ──────────────────────────────────────────────
  // 4. Toast Notifications
  // ──────────────────────────────────────────────
  var toastContainer = null;

  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.getElementById('toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
      }
    }
    return toastContainer;
  }

  function showToast(message, type) {
    type = type || 'info';
    var container = ensureToastContainer();
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger reflow for animation
    toast.offsetHeight; // eslint-disable-line no-unused-expressions

    toast.classList.add('toast-visible');

    var timer = setTimeout(function () {
      dismissToast(toast);
    }, 5000);

    toast.addEventListener('click', function () {
      clearTimeout(timer);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // ──────────────────────────────────────────────
  // 5. Modal Helpers
  // ──────────────────────────────────────────────
  function showModal(id) {
    var modal = document.getElementById(id);
    if (modal) {
      modal.classList.add('modal-open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function hideModal(id) {
    var modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('modal-open');
      modal.setAttribute('aria-hidden', 'true');
      // Clear any plaintext key displays inside the modal
      var plaintextEls = modal.querySelectorAll('[data-plaintext-key]');
      plaintextEls.forEach(function (el) {
        el.textContent = '';
      });
    }
  }

  function hideAllModals() {
    var modals = document.querySelectorAll('.modal');
    modals.forEach(function (m) {
      m.classList.remove('modal-open');
      m.setAttribute('aria-hidden', 'true');
    });
  }

  // ──────────────────────────────────────────────
  // 6. Authentication
  // ──────────────────────────────────────────────
  async function authenticate() {
    var input = document.getElementById('auth-key-input');
    if (!input) return;
    var key = input.value.trim();
    if (!key) {
      showToast('Please enter an API key', 'warning');
      return;
    }

    try {
      // Temporarily set the key so the api() helper includes it
      state.apiKey = key;

      // Verify the key works by hitting health then keys
      await api('GET', '/health');
      await api('GET', '/keys?limit=1');

      // Persist for session
      sessionStorage.setItem('akm_api_key', key);

      // Clear the input so the plaintext is no longer in the DOM
      input.value = '';

      showAuthenticatedUI();
      showToast('Authenticated successfully', 'success');
      navigate('overview');
    } catch (err) {
      state.apiKey = null;
      sessionStorage.removeItem('akm_api_key');
      if (err.status === 401 || err.status === 403) {
        showToast('Invalid API key', 'error');
      } else {
        showToast('Connection failed: ' + err.message, 'error');
      }
    }
  }

  function logout() {
    state.apiKey = null;
    state.keys = [];
    state.auditLogs = [];
    state.stats = { total: 0, active: 0, revoked: 0, expired: 0, auditCount: 0 };
    state.pagination = { limit: 50, offset: 0 };
    sessionStorage.removeItem('akm_api_key');
    showUnauthenticatedUI();
    showToast('Logged out', 'info');
  }

  function restoreSession() {
    var saved = sessionStorage.getItem('akm_api_key');
    if (saved) {
      state.apiKey = saved;
      showAuthenticatedUI();
      navigate('overview');
    } else {
      showUnauthenticatedUI();
    }
  }

  function showAuthenticatedUI() {
    var auth = document.getElementById('auth-screen');
    var dash = document.getElementById('dashboard-layout');
    if (auth) auth.style.display = 'none';
    if (dash) dash.style.display = '';
  }

  function showUnauthenticatedUI() {
    var auth = document.getElementById('auth-screen');
    var dash = document.getElementById('dashboard-layout');
    if (auth) auth.style.display = '';
    if (dash) dash.style.display = 'none';
  }

  // ──────────────────────────────────────────────
  // 7. Navigation
  // ──────────────────────────────────────────────
  var views = ['overview', 'keys', 'audit'];

  function navigate(view) {
    if (views.indexOf(view) === -1) view = 'overview';
    state.currentView = view;

    // Hide all views
    views.forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.style.display = 'none';
    });

    // Show selected
    var active = document.getElementById('view-' + view);
    if (active) active.style.display = '';

    // Update sidebar active state
    var navLinks = document.querySelectorAll('[data-nav]');
    navLinks.forEach(function (link) {
      if (link.getAttribute('data-nav') === view) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Load data for the view
    if (view === 'overview') loadOverview();
    else if (view === 'keys') loadKeys();
    else if (view === 'audit') { state.pagination.offset = 0; loadAuditLogs(); }
  }

  // ──────────────────────────────────────────────
  // 8. Overview View
  // ──────────────────────────────────────────────
  async function loadOverview() {
    try {
      var keysRes = await api('GET', '/keys?limit=100');
      var keys = keysRes.data || [];
      state.keys = keys;

      var stats = { total: keys.length, active: 0, revoked: 0, expired: 0 };
      keys.forEach(function (k) {
        if (k.status === 'active') stats.active++;
        else if (k.status === 'revoked') stats.revoked++;
        else if (k.status === 'expired') stats.expired++;
      });

      // Fetch recent audit logs
      var auditRes = await api('GET', '/audit?limit=10');
      var recentLogs = auditRes.data || [];
      stats.auditCount = recentLogs.length;
      state.stats = stats;

      renderOverview(stats, recentLogs);
    } catch (err) {
      showToast('Failed to load overview: ' + err.message, 'error');
    }
  }

  function renderOverview(stats, recentLogs) {
    // Stats cards
    setContent('stat-total', stats.total);
    setContent('stat-active', stats.active);
    setContent('stat-revoked', stats.revoked);
    setContent('stat-expired', stats.expired);

    // Recent activity table
    var tbody = document.getElementById('overview-activity-body');
    if (!tbody) return;

    if (recentLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No recent activity</td></tr>';
      return;
    }

    var html = '';
    recentLogs.forEach(function (log) {
      html += '<tr>'
        + '<td>' + escapeHtml(formatDate(log.createdAt)) + '</td>'
        + '<td>' + escapeHtml(log.action) + '</td>'
        + '<td title="' + escapeHtml(log.keyId) + '">' + escapeHtml(truncateId(log.keyId)) + '</td>'
        + '<td>' + escapeHtml(log.actorId) + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
  }

  function setContent(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ──────────────────────────────────────────────
  // 9. Keys View
  // ──────────────────────────────────────────────
  async function loadKeys() {
    try {
      var res = await api('GET', '/keys?limit=100');
      state.keys = res.data || [];
      renderKeysTable(state.keys);
    } catch (err) {
      showToast('Failed to load keys: ' + err.message, 'error');
    }
  }

  function renderKeysTable(keys) {
    var tbody = document.getElementById('keys-table-body');
    if (!tbody) return;

    if (keys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No API keys found. Create one to get started.</td></tr>';
      return;
    }

    var html = '';
    keys.forEach(function (key) {
      html += '<tr>'
        + '<td class="key-name-cell">'
        +   '<span class="key-name" title="' + escapeHtml(key.keyId) + '">'
        +     escapeHtml(key.keyName)
        +   '</span>'
        +   '<span class="key-id text-muted">' + escapeHtml(truncateId(key.keyId)) + '</span>'
        + '</td>'
        + '<td>' + renderStatusBadge(key.status) + '</td>'
        + '<td>' + escapeHtml((key.scopes || []).join(', ') || '—') + '</td>'
        + '<td>' + escapeHtml(formatDate(key.createdAt)) + '</td>'
        + '<td>' + escapeHtml(formatDate(key.expiresAt)) + '</td>'
        + '<td class="actions-cell">'
        +   '<button class="btn btn-sm btn-outline" onclick="window.__akm.viewKeyDetail(\'' + escapeHtml(key.keyId) + '\')" title="View details">Details</button> '
        +   (key.status === 'active'
              ? '<button class="btn btn-sm btn-warning" onclick="window.__akm.openRotateModal(\'' + escapeHtml(key.keyId) + '\')" title="Rotate">Rotate</button> '
              + '<button class="btn btn-sm btn-danger" onclick="window.__akm.openRevokeModal(\'' + escapeHtml(key.keyId) + '\')" title="Revoke">Revoke</button>'
              : '')
        + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
  }

  // Create key
  async function createKey(name, scopes, expiresInHours, rateLimit) {
    var body = {
      keyName: name,
      scopes: scopes,
    };
    if (expiresInHours) body.expiresInHours = Number(expiresInHours);
    if (rateLimit && rateLimit.maxRequests) body.rateLimit = rateLimit;

    try {
      var res = await api('POST', '/keys', body);
      var created = res.data;
      showToast('Key created successfully', 'success');
      hideModal('modal-create-key');

      // Show the plaintext key
      showPlaintextKey(created.plaintext);

      // Reload keys list
      loadKeys();
      return created;
    } catch (err) {
      showToast('Failed to create key: ' + err.message, 'error');
    }
  }

  function showPlaintextKey(plaintext) {
    var display = document.getElementById('plaintext-key-display');
    var value = document.getElementById('plaintext-key-value');
    if (display && value) {
      value.textContent = plaintext;
      value.setAttribute('data-plaintext-key', 'true');
      showModal('modal-plaintext-key');
    }
  }

  // Rotate key
  async function rotateKey(keyId, reason, gracePeriodMs) {
    var body = { reason: reason };
    if (gracePeriodMs) body.gracePeriodMs = Number(gracePeriodMs);

    try {
      var res = await api('PUT', '/keys/' + encodeURIComponent(keyId) + '/rotate', body);
      showToast('Key rotated successfully', 'success');
      hideModal('modal-rotate-key');

      // Show the new plaintext key
      showPlaintextKey(res.data.plaintext);

      loadKeys();
      return res.data;
    } catch (err) {
      showToast('Failed to rotate key: ' + err.message, 'error');
    }
  }

  // Revoke key
  async function revokeKey(keyId, reason) {
    try {
      await api('PUT', '/keys/' + encodeURIComponent(keyId) + '/revoke', { reason: reason });
      showToast('Key revoked successfully', 'success');
      hideModal('modal-revoke-key');
      loadKeys();
    } catch (err) {
      showToast('Failed to revoke key: ' + err.message, 'error');
    }
  }

  // View key detail
  async function viewKeyDetail(keyId) {
    try {
      var keyRes = await api('GET', '/keys/' + encodeURIComponent(keyId));
      var auditRes = await api('GET', '/keys/' + encodeURIComponent(keyId) + '/audit?limit=20');
      var key = keyRes.data;
      var logs = auditRes.data || [];

      renderKeyDetailPanel(key, logs);
      showModal('modal-key-detail');
    } catch (err) {
      showToast('Failed to load key details: ' + err.message, 'error');
    }
  }

  function renderKeyDetailPanel(key, logs) {
    var container = document.getElementById('key-detail-content');
    if (!container) return;

    var html = '<div class="detail-section">'
      + '<h4>Key Information</h4>'
      + '<dl class="detail-list">'
      + '<dt>ID</dt><dd>' + escapeHtml(key.keyId || key.id) + '</dd>'
      + '<dt>Name</dt><dd>' + escapeHtml(key.keyName) + '</dd>'
      + '<dt>Status</dt><dd>' + renderStatusBadge(key.status) + '</dd>'
      + '<dt>Scopes</dt><dd>' + escapeHtml((key.scopes || []).join(', ') || '—') + '</dd>'
      + '<dt>Created</dt><dd>' + escapeHtml(formatDate(key.createdAt)) + '</dd>'
      + '<dt>Expires</dt><dd>' + escapeHtml(formatDate(key.expiresAt)) + '</dd>'
      + '<dt>Last Used</dt><dd>' + escapeHtml(formatDate(key.lastUsedAt)) + '</dd>'
      + '<dt>Rate Limit</dt><dd>' + escapeHtml(key.rateLimit ? key.rateLimit.maxRequests + ' req / ' + key.rateLimit.windowMs + 'ms' : '—') + '</dd>';

    if (key.revokedAt) {
      html += '<dt>Revoked At</dt><dd>' + escapeHtml(formatDate(key.revokedAt)) + '</dd>';
    }
    if (key.revokedReason) {
      html += '<dt>Revoke Reason</dt><dd>' + escapeHtml(key.revokedReason) + '</dd>';
    }

    html += '</dl></div>';

    // Audit history
    html += '<div class="detail-section">'
      + '<h4>Audit History</h4>';

    if (logs.length === 0) {
      html += '<p class="text-muted">No audit records found.</p>';
    } else {
      html += '<table class="table table-sm"><thead><tr>'
        + '<th>Time</th><th>Action</th><th>Actor</th><th>IP</th>'
        + '</tr></thead><tbody>';
      logs.forEach(function (log) {
        html += '<tr>'
          + '<td>' + escapeHtml(formatDate(log.createdAt)) + '</td>'
          + '<td>' + escapeHtml(log.action) + '</td>'
          + '<td>' + escapeHtml(log.actorId) + '</td>'
          + '<td>' + escapeHtml(log.ipAddress || '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ──────────────────────────────────────────────
  // 10. Audit View
  // ──────────────────────────────────────────────
  async function loadAuditLogs(filters) {
    filters = filters || {};
    try {
      var params = [];
      if (filters.keyId) params.push('keyId=' + encodeURIComponent(filters.keyId));
      if (filters.action) params.push('action=' + encodeURIComponent(filters.action));
      if (filters.startDate) params.push('startDate=' + encodeURIComponent(filters.startDate));
      if (filters.endDate) params.push('endDate=' + encodeURIComponent(filters.endDate));
      params.push('limit=' + state.pagination.limit);
      params.push('offset=' + state.pagination.offset);

      var qs = params.length > 0 ? '?' + params.join('&') : '';
      var res = await api('GET', '/audit' + qs);
      state.auditLogs = res.data || [];
      renderAuditTable(state.auditLogs);
      renderAuditPagination();
    } catch (err) {
      showToast('Failed to load audit logs: ' + err.message, 'error');
    }
  }

  function renderAuditTable(logs) {
    var tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No audit logs found.</td></tr>';
      return;
    }

    var html = '';
    logs.forEach(function (log) {
      var metaStr = log.metadata ? JSON.stringify(log.metadata, null, 2) : '';
      html += '<tr class="audit-row" data-log-id="' + escapeHtml(log.id) + '">'
        + '<td>' + escapeHtml(formatDate(log.createdAt)) + '</td>'
        + '<td>' + escapeHtml(log.action) + '</td>'
        + '<td title="' + escapeHtml(log.keyId) + '">' + escapeHtml(truncateId(log.keyId)) + '</td>'
        + '<td>' + escapeHtml(log.actorId) + '</td>'
        + '<td>' + escapeHtml(log.ipAddress || '—') + '</td>'
        + '<td>'
        +   (metaStr ? '<button class="btn btn-sm btn-outline" onclick="window.__akm.toggleMeta(this)">Show</button>' : '—')
        + '</td>'
        + '</tr>';

      if (metaStr) {
        html += '<tr class="audit-meta-row" style="display:none;">'
          + '<td colspan="6"><pre class="meta-json">' + escapeHtml(metaStr) + '</pre></td>'
          + '</tr>';
      }
    });
    tbody.innerHTML = html;
  }

  function toggleMeta(btn) {
    var row = btn.closest('tr');
    if (!row) return;
    var metaRow = row.nextElementSibling;
    if (!metaRow || !metaRow.classList.contains('audit-meta-row')) return;

    if (metaRow.style.display === 'none') {
      metaRow.style.display = '';
      btn.textContent = 'Hide';
    } else {
      metaRow.style.display = 'none';
      btn.textContent = 'Show';
    }
  }

  function renderAuditPagination() {
    var container = document.getElementById('audit-pagination');
    if (!container) return;

    var offset = state.pagination.offset;
    var limit = state.pagination.limit;
    var count = state.auditLogs.length;

    var html = '<div class="pagination-controls">';
    html += '<button class="btn btn-sm btn-outline" id="audit-prev" ' + (offset === 0 ? 'disabled' : '') + '>Previous</button>';
    html += '<span class="pagination-info">Showing ' + escapeHtml(offset + 1) + '–' + escapeHtml(offset + count) + '</span>';
    html += '<button class="btn btn-sm btn-outline" id="audit-next" ' + (count < limit ? 'disabled' : '') + '>Next</button>';
    html += '</div>';

    container.innerHTML = html;

    var prevBtn = document.getElementById('audit-prev');
    var nextBtn = document.getElementById('audit-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        state.pagination.offset = Math.max(0, state.pagination.offset - state.pagination.limit);
        loadAuditLogs(getAuditFilters());
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        state.pagination.offset += state.pagination.limit;
        loadAuditLogs(getAuditFilters());
      });
    }
  }

  function getAuditFilters() {
    var filters = {};
    var keyIdEl = document.getElementById('filter-key-id');
    var actionEl = document.getElementById('filter-action');
    var startEl = document.getElementById('filter-start-date');
    var endEl = document.getElementById('filter-end-date');

    if (keyIdEl && keyIdEl.value.trim()) filters.keyId = keyIdEl.value.trim();
    if (actionEl && actionEl.value) filters.action = actionEl.value;
    if (startEl && startEl.value) filters.startDate = startEl.value;
    if (endEl && endEl.value) filters.endDate = endEl.value;

    return filters;
  }

  // ──────────────────────────────────────────────
  // 11. Modal Form Openers
  // ──────────────────────────────────────────────
  function openCreateModal() {
    // Reset form
    var form = document.getElementById('form-create-key');
    if (form) form.reset();
    showModal('modal-create-key');
  }

  function openRotateModal(keyId) {
    var input = document.getElementById('rotate-key-id');
    if (input) input.value = keyId;
    var reasonInput = document.getElementById('rotate-reason');
    if (reasonInput) reasonInput.value = '';
    var graceInput = document.getElementById('rotate-grace-period');
    if (graceInput) graceInput.value = '';
    showModal('modal-rotate-key');
  }

  function openRevokeModal(keyId) {
    var input = document.getElementById('revoke-key-id');
    if (input) input.value = keyId;
    var reasonInput = document.getElementById('revoke-reason');
    if (reasonInput) reasonInput.value = '';
    showModal('modal-revoke-key');
  }

  // ──────────────────────────────────────────────
  // 12. Event Listeners
  // ──────────────────────────────────────────────
  function initEventListeners() {
    // Auth form
    var authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', function (e) {
        e.preventDefault();
        authenticate();
      });
    }

    // Logout button
    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        logout();
      });
    }

    // Sidebar navigation
    var navLinks = document.querySelectorAll('[data-nav]');
    navLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var view = this.getAttribute('data-nav');
        navigate(view);
      });
    });

    // Create key button
    var createBtn = document.getElementById('btn-create-key');
    if (createBtn) {
      createBtn.addEventListener('click', function () {
        openCreateModal();
      });
    }

    // Create key form submit
    var createForm = document.getElementById('form-create-key');
    if (createForm) {
      createForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = document.getElementById('create-key-name');
        var scopes = document.getElementById('create-key-scopes');
        var expires = document.getElementById('create-key-expires');
        var rlWindow = document.getElementById('create-key-rl-window');
        var rlMax = document.getElementById('create-key-rl-max');

        var scopeArr = scopes && scopes.value.trim()
          ? scopes.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
          : [];

        var rateLimit = null;
        if (rlWindow && rlMax && rlWindow.value && rlMax.value) {
          rateLimit = {
            windowMs: Number(rlWindow.value),
            maxRequests: Number(rlMax.value),
          };
        }

        createKey(
          name ? name.value.trim() : '',
          scopeArr,
          expires ? expires.value : null,
          rateLimit
        );
      });
    }

    // Rotate key form submit
    var rotateForm = document.getElementById('form-rotate-key');
    if (rotateForm) {
      rotateForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var keyId = document.getElementById('rotate-key-id');
        var reason = document.getElementById('rotate-reason');
        var grace = document.getElementById('rotate-grace-period');
        rotateKey(
          keyId ? keyId.value : '',
          reason ? reason.value.trim() : '',
          grace ? grace.value : null
        );
      });
    }

    // Revoke key form submit
    var revokeForm = document.getElementById('form-revoke-key');
    if (revokeForm) {
      revokeForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var keyId = document.getElementById('revoke-key-id');
        var reason = document.getElementById('revoke-reason');

        if (!reason || !reason.value.trim()) {
          showToast('Please provide a reason for revocation', 'warning');
          return;
        }

        revokeKey(
          keyId ? keyId.value : '',
          reason.value.trim()
        );
      });
    }

    // Copy plaintext key button
    var copyKeyBtn = document.getElementById('btn-copy-key');
    if (copyKeyBtn) {
      copyKeyBtn.addEventListener('click', function () {
        var val = document.getElementById('plaintext-key-value');
        if (val && val.textContent) {
          copyToClipboard(val.textContent);
        }
      });
    }

    // Modal backdrop clicks to close
    var modals = document.querySelectorAll('.modal');
    modals.forEach(function (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          hideModal(modal.id);
        }
      });
    });

    // Modal close buttons
    var closeButtons = document.querySelectorAll('[data-dismiss-modal]');
    closeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modalId = this.getAttribute('data-dismiss-modal');
        if (modalId) {
          hideModal(modalId);
        } else {
          // Find nearest modal parent
          var modal = this.closest('.modal');
          if (modal) hideModal(modal.id);
        }
      });
    });

    // Audit filter form
    var auditFilterForm = document.getElementById('form-audit-filters');
    if (auditFilterForm) {
      auditFilterForm.addEventListener('submit', function (e) {
        e.preventDefault();
        state.pagination.offset = 0;
        loadAuditLogs(getAuditFilters());
      });

      // Also listen for reset
      auditFilterForm.addEventListener('reset', function () {
        // Use timeout to let the reset complete first
        setTimeout(function () {
          state.pagination.offset = 0;
          loadAuditLogs({});
        }, 0);
      });
    }

    // Keyboard: Escape closes modals
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideAllModals();
      }
    });
  }

  // ──────────────────────────────────────────────
  // 13. Public API (for onclick handlers in rendered HTML)
  // ──────────────────────────────────────────────
  window.__akm = {
    viewKeyDetail: viewKeyDetail,
    openRotateModal: openRotateModal,
    openRevokeModal: openRevokeModal,
    toggleMeta: toggleMeta,
    copyToClipboard: copyToClipboard,
  };

  // ──────────────────────────────────────────────
  // 14. Init
  // ──────────────────────────────────────────────
  function init() {
    initEventListeners();
    restoreSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
