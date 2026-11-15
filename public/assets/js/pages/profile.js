'use strict';

function profileRoleLabel(role) { return (ROLES && ROLES[role]) || role || '—'; }

function renderMyProfile() {
  const p = APP.profile || {};
  const email = APP.user && APP.user.email ? APP.user.email : '—';
  $('#profile-content').innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>👤 بياناتي الشخصية</h3></div>
        <div class="panel-body">
          <div class="field"><label>الاسم الكامل</label><input id="my-full-name" value="${esc(p.full_name || '')}" maxlength="120"></div>
          <div class="field"><label>رقم الهاتف</label><input id="my-phone" value="${esc(p.phone || '')}" maxlength="40" inputmode="tel"></div>
          <div class="field"><label>المسمى الوظيفي</label><input id="my-job-title" value="${esc(p.job_title || '')}" maxlength="120"></div>
          <button class="btn btn-gold" onclick="saveMyProfile()">💾 حفظ بياناتي</button>
          <p class="hint" id="profile-saved" style="margin-top:10px"></p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>🔒 بيانات الحساب</h3></div>
        <div class="panel-body">
          <p class="profile-line"><b>اسم المستخدم:</b> ${esc(p.username || '—')}</p>
          <p class="profile-line"><b>البريد الداخلي:</b> ${esc(email)}</p>
          <p class="profile-line"><b>الدور:</b> <span class="badge region">${esc(profileRoleLabel(p.role))}</span></p>
          <p class="profile-line"><b>تاريخ إنشاء الحساب:</b> ${esc(p.created_at ? fmtDate(p.created_at) : '—')}</p>
          <p class="hint">هذه البيانات تخص حسابك فقط. لا تظهر بيانات ملفك الشخصي للمستخدمين العاديين الآخرين.</p>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>🔑 أمان الحساب</h3></div>
      <div class="panel-body">
        <div class="grid-2">
          <div class="field"><label>كلمة المرور الحالية</label><input id="my-old-password" type="password" autocomplete="current-password"></div>
          <div class="field"><label>كلمة المرور الجديدة</label><input id="my-new-password" type="password" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-teal" onclick="saveMyPassword()">تغيير كلمة المرور</button>
      </div>
    </div>`;
}

async function saveMyProfile() {
  const full_name = $('#my-full-name').value.trim();
  if (!full_name) return toast('الاسم الكامل مطلوب', 'err');
  try {
    const p = await DB.updateMyProfile({ full_name, phone: $('#my-phone').value, job_title: $('#my-job-title').value });
    APP.profile = { ...APP.profile, ...p };
    renderMyProfile();
    toast('تم حفظ بيانات ملفك الشخصي');
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function saveMyPassword() {
  try {
    await DB.changeMyPassword($('#my-old-password').value, $('#my-new-password').value);
    $('#my-old-password').value = ''; $('#my-new-password').value = '';
    toast('تم تغيير كلمة المرور بنجاح');
  } catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({ activePath: 'profile.html' }).then(() => renderMyProfile());
