'use strict';

const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

function rateLimited() {
  const key = 'login_attempts';
  const now = Date.now();
  let attempts = JSON.parse(localStorage.getItem(key) || '[]').filter(t => t > now - LOGIN_WINDOW_MS);
  localStorage.setItem(key, JSON.stringify(attempts));
  return attempts.length >= LOGIN_MAX;
}
function recordAttempt() {
  const key = 'login_attempts';
  const attempts = JSON.parse(localStorage.getItem(key) || '[]');
  attempts.push(Date.now());
  localStorage.setItem(key, JSON.stringify(attempts));
}
function clearAttempts() { localStorage.removeItem('login_attempts'); }

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.style.display = 'block';
}

function dashboardUrl() {
  return new URL('index.html', window.location.href).href;
}

let redirected = false;
function goDashboard() {
  if (redirected) return;
  redirected = true;
  const url = dashboardUrl();
  try { window.location.replace(url); } catch (_) {}
  // احتياط لمتصفحات الجوال التي تتجاهل التحويل داخل مسار async
  setTimeout(() => { window.location.href = url; }, 80);
  setTimeout(() => { window.location.assign(url); }, 400);
}

function setBusy(busy) {
  const btn = document.querySelector('#loginForm button[type="submit"]');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? 'جاري الدخول…' : 'دخــول';
}

function isLoginPage() {
  const p = (location.pathname || '').replace(/\/+$/, '');
  return /(login)(\.html)?$/i.test(p) || p === '' || p === '/';
}

(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && isLoginPage()) goDashboard();
  } catch (_) {}
})();

supabase.auth.onAuthStateChange((event, session) => {
  if (!session) return;
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') goDashboard();
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const username = String(form.get('username') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');

  if (rateLimited()) {
    showError('تم حظر تسجيل الدخول مؤقتًا — كثرة المحاولات الخاطئة. حاول بعد 5 دقائق');
    return;
  }

  setBusy(true);
  showError('');
  const box = document.getElementById('errorBox');
  if (box) box.style.display = 'none';

  try {
    const { data: row, error: userErr } = await supabase
      .from('usernames')
      .select('email')
      .eq('username', username)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!row || !row.email) {
      recordAttempt();
      showError('اسم المستخدم أو كلمة المرور غير صحيحة');
      setBusy(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: row.email,
      password,
    });
    if (error || !data || !data.session) {
      recordAttempt();
      showError('اسم المستخدم أو كلمة المرور غير صحيحة');
      setBusy(false);
      return;
    }

    clearAttempts();
    // لا ننتظر سجل التدقيق — كان يعلّق التحويل إلى لوحة التحكم
    supabase.rpc('log_audit', { p_action: 'تسجيل دخول', p_details: '' }).catch(() => {});
    goDashboard();
  } catch (err) {
    showError('تعذر تسجيل الدخول. تحقق من الاتصال وحاول مرة أخرى');
    setBusy(false);
  }
});
