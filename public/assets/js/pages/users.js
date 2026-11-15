'use strict';

const ROLE_LABEL = { admin: '<span class="badge posted">مدير النظام</span>', accountant: '<span class="badge region">محاسب</span>', accounts_manager: '<span class="badge teal">مسؤول الحسابات</span>', viewer: '<span class="badge gray">مشاهدة فقط</span>' };

function handleUserErr(e) {
  if (e && (e.code === 'SETUP_SQL_REQUIRED' || e.message === 'SETUP_SQL_REQUIRED')) {
    openModal('sqlModal');
    toast('شغّل سكربت قاعدة البيانات مرة واحدة لتفعيل إضافة المستخدمين', 'err');
    return;
  }
  toast(errMsg(e), 'err');
}

/* كلمات المرور وإجابات أسئلة الأمان لا تُخزَّن في المسودات أبداً */
const USER_DRAFT = Drafts.register({ module: 'users', form: 'user', root: '#addModal', exclude: ['u-pass', 'u-ans'] });
const SEC_DRAFT = Drafts.register({ module: 'users', form: 'security-question', root: '#secModal', exclude: ['sec-ans'], recordId: () => $('#sec-id').value || null });
function openAddUser() { USER_DRAFT.open(); openModal('addModal'); }

async function loadUsers() {
  try {
    const users = await DB.usersList();
    $('#users-body').innerHTML = (users || []).map(u => `
      <tr>
        <td>${esc(u.full_name)}</td><td class="num">${esc(u.username)}</td>
        <td>${ROLE_LABEL[u.role] || ''}</td>
        <td>${u.security_question ? `<span class="badge posted" title="${esc(u.security_question)}">مُفعّل</span>` : '<span class="badge draft">بدون سؤال</span>'}</td>
        <td class="num">${fmtDate(u.created_at)}</td>
        <td class="num">
          <button class="btn btn-sm btn-dark" onclick='setSecurity(${JSON.stringify(u.id)}, ${JSON.stringify(u.username)}, ${JSON.stringify(u.security_question || "")})'>🛡️ سؤال أمان</button>
          <button class="btn btn-sm btn-teal" onclick='resetPw(${JSON.stringify(u.id)}, ${JSON.stringify(u.username)})'>🔑 كلمة مرور</button>
          ${u.id !== APP.user.id ? `<button class="btn btn-sm btn-red" onclick='delUser(${JSON.stringify(u.id)}, ${JSON.stringify(u.username)})'>🗑️</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty-state">لا يوجد مستخدمون</td></tr>';
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function addUser() {
  const full_name = $('#u-name').value.trim();
  const username = $('#u-user').value.trim().toLowerCase();
  const password = $('#u-pass').value;
  if (!full_name) return toast('اكتب الاسم الكامل', 'err');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return toast('اسم الدخول: إنجليزي وأرقام من 3 إلى 32 حرفاً', 'err');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return toast('كلمة المرور 8 أحرف على الأقل وتحتوي حروف وأرقام', 'err');
  }
  try {
    await DB.callManageUsers({
      action: 'create',
      full_name, username, password,
      role: $('#u-role').value,
      security_question: $('#u-q').value.trim(),
      security_answer: $('#u-ans').value.trim(),
    });
    USER_DRAFT.done();
    closeModal('addModal');
    $('#u-name').value = $('#u-user').value = $('#u-pass').value = $('#u-q').value = $('#u-ans').value = '';
    toast('تمت إضافة المستخدم — يمكنه الدخول الآن باسم المستخدم وكلمة المرور');
    loadUsers();
  } catch (e) { handleUserErr(e); }
}

function setSecurity(id, username, question) {
  $('#sec-title').textContent = `سؤال الأمان لـ ${username}`;
  $('#sec-id').value = id; $('#sec-q').value = question || ''; $('#sec-ans').value = '';
  SEC_DRAFT.open();
  openModal('secModal');
}
async function saveSecurity() {
  const q = $('#sec-q').value.trim(), a = $('#sec-ans').value.trim();
  if (!q) return toast('اكتب سؤال الأمان', 'err');
  if (!a) return toast('اكتب إجابة سؤال الأمان', 'err');
  try {
    await DB.callManageUsers({ action: 'set_security', user_id: $('#sec-id').value, security_question: q, security_answer: a });
    SEC_DRAFT.done();
    closeModal('secModal');
    toast('تم حفظ سؤال الأمان');
    loadUsers();
  } catch (e) { handleUserErr(e); }
}

function resetPw(id, username) {
  $('#pw-title').textContent = `كلمة مرور جديدة لـ ${username}`;
  $('#pw-id').value = id; $('#pw-new').value = '';
  openModal('pwModal');
}
async function savePw() {
  const password = $('#pw-new').value;
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return toast('كلمة المرور 8 أحرف على الأقل وتحتوي حروف وأرقام', 'err');
  }
  try {
    await DB.callManageUsers({ action: 'reset_password', user_id: $('#pw-id').value, password });
    closeModal('pwModal');
    toast('تم تغيير كلمة المرور');
  } catch (e) { handleUserErr(e); }
}

async function delUser(id, username) {
  if (!await confirmDlg(`حذف المستخدم ${username}؟ لن يستطيع الدخول بعد الحذف.`)) return;
  try { await DB.callManageUsers({ action: 'delete', user_id: id }); toast('تم حذف المستخدم'); loadUsers(); }
  catch (e) { handleUserErr(e); }
}

async function copySetupSql() {
  const box = $('#sql-box');
  try {
    await navigator.clipboard.writeText(box.value);
    toast('تم نسخ السكربت — الصقه في SQL Editor داخل Supabase ثم Run');
  } catch {
    box.select();
    document.execCommand('copy');
    toast('تم نسخ السكربت');
  }
}

APP.requireAuth({ activePath: 'users.html', allowRoles: ['admin', 'accounts_manager'] }).then(async () => {
  loadUsers();
  try {
    const res = await fetch('assets/sql/admin-users.sql', { cache: 'no-store' });
    if (res.ok) $('#sql-box').value = await res.text();
  } catch (_) {}
});
