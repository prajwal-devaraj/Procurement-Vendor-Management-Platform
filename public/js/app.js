// public/js/app.js
// Procurement & Vendor Management Platform — dashboard frontend.
// Vanilla JS, no build step. Talks to the backend via Api (api.js).

const State = {
  token: localStorage.getItem('pv_token') || null,
  user: JSON.parse(localStorage.getItem('pv_user') || 'null'),
  currentView: 'dashboard',
  cache: {} // small in-memory cache for cross-view lookups (vendors, etc.)
};

// ===================== Toast =====================

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ===================== Modal =====================

function openModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modalBackdrop').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.add('hidden');
  document.getElementById('modal').innerHTML = '';
}
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

// ===================== Formatting helpers =====================

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes(' ') ? s.replace(' ', 'T') + 'Z' : s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function relTime(s) {
  if (!s) return '—';
  const d = new Date(s.includes(' ') ? s.replace(' ', 'T') + 'Z' : s);
  if (isNaN(d)) return s;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(s);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const STATUS_TAG = {
  // vendor
  Active: 'green', Pending: 'amber', Rejected: 'red', Blocked: 'grey',
  // PR
  Draft: 'grey', Submitted: 'amber', ManagerApproved: 'blue', FinanceApproved: 'green', ConvertedToPO: 'rust',
  // PO
  Created: 'grey', SentToVendor: 'amber', Acknowledged: 'blue', PartiallyDelivered: 'amber', Completed: 'green', Cancelled: 'red',
  // Invoice
  Received: 'grey', Matched: 'blue', MismatchFound: 'red', Approved: 'green', Paid: 'green',
  // Payment
  Unpaid: 'amber', Overdue: 'red'
};
function tag(status) {
  const cls = STATUS_TAG[status] || 'grey';
  return `<span class="tag tag-${cls}">${esc(status)}</span>`;
}

// ===================== Auth =====================

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}
function showAppShell() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('userName').textContent = State.user.name;
  document.getElementById('userRole').textContent = humanRole(State.user.role);
  document.getElementById('userAvatar').textContent = initials(State.user.name);
  // Note: does not call navigateTo() itself — view modules (dashboard.js etc.)
  // load after app.js, so the caller is responsible for triggering the first
  // navigation once all VIEW_RENDERERS are registered. See boot() below and
  // the inline script at the bottom of index.html for the login-time case.
}

function humanRole(role) {
  return { SystemAdmin: 'System Admin', ProcurementAdmin: 'Procurement Admin' }[role] || role;
}

function setSession(token, user) {
  State.token = token;
  State.user = user;
  localStorage.setItem('pv_token', token);
  localStorage.setItem('pv_user', JSON.stringify(user));
}
function clearSession() {
  State.token = null;
  State.user = null;
  localStorage.removeItem('pv_token');
  localStorage.removeItem('pv_user');
}

document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tabName = btn.dataset.tab;
    document.getElementById('loginForm').classList.toggle('hidden', tabName !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tabName !== 'register');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const { token, user } = await Api.login(email, password);
    setSession(token, user);
    showAppShell();
    navigateTo('dashboard');
    toast(`Welcome back, ${user.name.split(' ')[0]}`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  const payload = {
    name: document.getElementById('regName').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    password: document.getElementById('regPassword').value,
    role: document.getElementById('regRole').value,
    department: document.getElementById('regDept').value.trim() || undefined
  };
  try {
    const { token, user } = await Api.register(payload);
    setSession(token, user);
    showAppShell();
    navigateTo('dashboard');
    toast(`Account created — welcome, ${user.name.split(' ')[0]}`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearSession();
  showAuthScreen();
});

// ===================== Navigation =====================

document.getElementById('sidebarNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  navigateTo(btn.dataset.view);
});

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  vendors: 'Vendor Management',
  requests: 'Purchase Requests',
  orders: 'Purchase Orders',
  invoices: 'Invoice Management',
  payments: 'Payment Tracking',
  audit: 'Audit Log'
};

const VIEW_RENDERERS = {}; // populated by view modules below

async function navigateTo(view) {
  State.currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view] || view;
  document.getElementById('topbarActions').innerHTML = '';

  const container = document.getElementById('viewContainer');
  container.innerHTML = `<p class="muted" style="padding:40px 0;text-align:center;">Loading…</p>`;

  try {
    const renderer = VIEW_RENDERERS[view];
    if (renderer) await renderer(container);
  } catch (err) {
    container.innerHTML = `<div class="panel"><div class="panel-body"><p class="modal-error">${esc(err.message)}</p></div></div>`;
  }
}

// ===================== Boot =====================
// Runs immediately when app.js parses (before view modules load).
// Only toggles which screen is visible — the actual first navigateTo()
// call happens in the inline script at the bottom of index.html, once
// all view modules have registered their VIEW_RENDERERS entries.

(function boot() {
  if (State.token && State.user) {
    showAppShell();
  } else {
    showAuthScreen();
  }
})();
