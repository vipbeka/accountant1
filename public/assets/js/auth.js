'use strict';

const ROLES = { admin: 'مدير النظام', accountant: 'محاسب', accounts_manager: 'مسؤول الحسابات', viewer: 'مشاهدة فقط' };

const NAV_GROUPS = [
  ['الأساسيات', [
    ['index.html', '🏠', 'لوحة التحكم'],
    ['accounts.html', '📚', 'دليل الحسابات'],
    ['accounts-tree.html', '🌳', 'شجرة الحسابات'],
  ]],
  ['العمليات', [
    ['journal.html', '📒', 'دفتر اليومية'],
    ['invoices.html', '🧾', 'الفواتير'],
    ['expenses.html', '🧾', 'المصاريف'],
    ['vouchers.html', '💵', 'سندات القبض والصرف'],
    ['parties.html', '👥', 'العملاء والموظفون'],
  ]],
  ['الموارد البشرية', [
    ['hr.html', '🧑‍💼', 'شؤون الموظفين'],
  ]],
  ['التقارير', [
    ['reports.html', '📑', 'مركز التقارير'],
    ['ledger.html', '📖', 'الأستاذ العام'],
    ['trial-balance.html', '⚖️', 'ميزان المراجعة'],
    ['income-statement.html', '📈', 'قائمة الدخل'],
    ['balance-sheet.html', '🏦', 'المركز المالي'],
    ['cash-flow.html', '💵', 'التدفقات النقدية'],
    ['budget.html', '📊', 'الموازنة التقديرية'],
    ['period-close.html', '🔒', 'إقفال الفترة'],
  ]],
];

function navLink(url, ic, label, activePath) {
  return `<a href="${url}" class="${activePath === url ? 'active' : ''}"><span class="ic">${ic}</span>${label}</a>`;
}

function closeDrawer() {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('show');
}
function openDrawer() {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if (sb) sb.classList.add('open');
  if (bd) bd.classList.add('show');
}

function isPublicAuthPage() {
  const p = (location.pathname || '').replace(/\/+$/, '').toLowerCase();
  return /(login|forgot)(\.html)?$/.test(p);
}

function loginUrl() {
  return new URL('login.html', window.location.href).href;
}

const APP = {
  session: null,
  user: null,
  profile: null,
  settings: { company_name: '', period_from: '', period_to: '', signatures: [], tax_no: '', commercial_reg: '', company_address: '', bank_details: '' },
  regions: [],

  canWrite() {
    return this.profile && ['admin', 'accountant', 'accounts_manager'].includes(this.profile.role);
  },
  isAdmin() {
    return this.profile && this.profile.role === 'admin';
  },
  isAccountsManager() { return this.profile && this.profile.role === 'accounts_manager'; },
  canManageUsers() { return this.profile && ['admin', 'accounts_manager'].includes(this.profile.role); },
  allowedForRole(path) {
    if (!this.isAccountsManager()) return true;
    return ['invoices.html', 'expenses.html', 'hr.html', 'vouchers.html', 'users.html', 'audit.html', 'settings.html', 'profile.html', 'help.html'].includes(path);
  },

  async logout() {
    try { await supabase.rpc('log_audit', { p_action: 'تسجيل خروج', p_details: '' }); } catch (_) {}
    await supabase.auth.signOut();
    location.replace(loginUrl());
  },

  async loadContext() {
    const [{ data: settingsRows }, { data: regionRows }] = await Promise.all([
      supabase.from('settings').select('key,value'),
      supabase.from('regions').select('name').eq('is_active', true).order('id'),
    ]);
    const s = {};
    (settingsRows || []).forEach(r => { s[r.key] = r.value; });
    this.settings.company_name = s.company_name || 'نظام محاسبي متكامل';
    this.settings.period_from = s.period_from || '';
    this.settings.period_to = s.period_to || '';
    this.settings.tax_no = s.tax_no || '';
    this.settings.commercial_reg = s.commercial_reg || '';
    this.settings.company_address = s.company_address || '';
    this.settings.bank_details = s.bank_details || '';
    try { this.settings.signatures = JSON.parse(s.signatures || '[]'); } catch { this.settings.signatures = []; }
    this.regions = (regionRows || []).map(r => r.name);
  },

  renderShell(activePath) {
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('topbar');
    if (!sidebar || !topbar) return;
    let links = NAV_GROUPS.map(([group, items]) => {
      const visible = items.filter(([url]) => this.allowedForRole(url));
      return visible.length ? `<div class="nav-group">${group}</div>` + visible.map(([url, ic, label]) => navLink(url, ic, label, activePath)).join('') : '';
    }).join('');
    links += `<div class="nav-group">النظام</div>`;
    if (this.canManageUsers()) {
      links += navLink('users.html', '👥', 'المستخدمون', activePath);
      links += navLink('audit.html', '🛡️', 'سجل العمليات', activePath);
    }
    links += navLink('help.html', '📘', 'دليل الاستخدام', activePath);
    links += navLink('profile.html', '👤', 'ملفي الشخصي', activePath);
    links += navLink('settings.html', '⚙️', 'الإعدادات', activePath);
    links += `<a href="#" id="logoutLink"><span class="ic">🚪</span>تسجيل الخروج</a>`;

    if (!document.getElementById('sidebar-backdrop')) {
      const bd = document.createElement('div');
      bd.id = 'sidebar-backdrop';
      bd.className = 'sidebar-backdrop';
      document.body.appendChild(bd);
      bd.addEventListener('click', closeDrawer);
    }

    sidebar.innerHTML = `
      <div class="brand">
        <div class="mark">ح</div>
        <div><b>النظام المحاسبي</b><small>${esc(this.settings.company_name)}</small></div>
        <button type="button" class="drawer-close" id="drawerClose" aria-label="إغلاق">✕</button>
      </div>
      <nav class="nav">${links}</nav>
      <div class="side-footer">© جميع الحقوق محفوظة<br><b>محاسب / محمد احمد</b></div>`;

    const pageTitle = document.body.dataset.pageTitle || '';
    topbar.innerHTML = `
      <button type="button" class="menu-btn" id="menuBtn" aria-label="القائمة">☰</button>
      <h2>${esc(pageTitle)}</h2>
      <div class="user-chip">
        <div class="avatar">${esc((this.profile.full_name || '?')[0])}</div>
        <div>${esc(this.profile.full_name)}<span class="role">${ROLES[this.profile.role] || ''}</span></div>
      </div>`;

    document.getElementById('logoutLink').addEventListener('click', e => { e.preventDefault(); this.logout(); });
    document.getElementById('menuBtn').addEventListener('click', openDrawer);
    document.getElementById('drawerClose').addEventListener('click', closeDrawer);
    sidebar.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', closeDrawer));
  },

  /* يُستدعى في بداية كل صفحة محمية. adminOnly لصفحات المدير فقط */
  async requireAuth({ activePath, adminOnly = false, allowRoles = null } = {}) {
    let session = null;
    for (let i = 0; i < 10; i++) {
      const { data } = await supabase.auth.getSession();
      session = data && data.session;
      if (session) break;
      await new Promise(r => setTimeout(r, 120));
    }
    if (!session) {
      location.replace(loginUrl());
      return null;
    }
    this.session = session;
    this.user = session.user;

    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', this.user.id).single();
    if (error || !profile) {
      await supabase.auth.signOut();
      location.replace(loginUrl());
      return null;
    }
    this.profile = profile;

    if (!this.allowedForRole(activePath || '')) {
      if (this.isAccountsManager()) location.replace(new URL('invoices.html', window.location.href).href);
      else document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif">ليست لديك صلاحية الوصول إلى هذه الصفحة</div>';
      return null;
    }

    if ((allowRoles && !allowRoles.includes(profile.role)) || (adminOnly && profile.role !== 'admin')) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif">ليست لديك صلاحية الوصول إلى هذه الصفحة</div>';
      return null;
    }

    await this.loadContext();
    this.renderShell(activePath);
    document.dispatchEvent(new CustomEvent('app-ready'));
    return this;
  },
};

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !isPublicAuthPage()) {
    location.replace(loginUrl());
  }
});
