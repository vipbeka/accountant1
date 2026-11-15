'use strict';

let SIGS = [];
let editingRegionId = null;

/* بيانات المنشأة والضرائب + صفوف التواقيع الديناميكية */
const COMPANY_DRAFT = Drafts.register({
  module: 'settings', form: 'company', root: '#admin-settings', recordId: () => 'company',
  exclude: [], resetIn: () => document.querySelector('#admin-settings .panel-body'), resetSmall: true,
  custom: {
    collect: () => $$('#sig-list .sig-row').map(r => ({ title: $('.sig-title', r).value, name: $('.sig-name', r).value })),
    apply: rows => { if (Array.isArray(rows)) { SIGS = rows.filter(r => r && typeof r === 'object').map(r => ({ title: String(r.title || ''), name: String(r.name || '') })); renderSigs(); } },
  },
});
const REGION_DRAFT = Drafts.register({ module: 'settings', form: 'region', root: '#regionModal', recordId: () => editingRegionId });

function renderAdminPanels() {
  if (!(APP.isAdmin() || APP.isAccountsManager())) return;
  $('#admin-settings').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>🏢 بيانات المنشأة</h3></div>
      <div class="panel-body">
        <div class="field"><label>اسم الشركة</label><input id="s-company" type="text"></div>
        <div class="field"><label>الرقم الضريبي</label><input id="s-tax" type="text" inputmode="numeric" placeholder="مثال: 123456789"></div>
        <div class="field"><label>السجل التجاري</label><input id="s-reg" type="text" placeholder="رقم السجل التجاري"></div>
        <div class="field"><label>عنوان المنشأة</label><input id="s-addr" type="text" placeholder="المحافظة، الحي، الشارع"></div>
        <div class="field"><label>بيانات البنك للطباعة</label><textarea id="s-bank" rows="3" placeholder="اسم البنك، الحساب، SWIFT، العنوان"></textarea></div>
        <div class="field"><label>بداية فترة التقارير</label><input id="s-from" type="date"></div>
        <div class="field"><label>نهاية فترة التقارير</label><input id="s-to" type="date"></div>
        <button class="btn btn-gold" onclick="saveSettings()">💾 حفظ الإعدادات</button>
        <p class="hint" id="s-saved" style="margin-top:8px"></p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>✍️ التواقيع في التقارير المصدَّرة</h3>
        <button class="btn btn-teal btn-sm" onclick="addSigRow()">➕ إضافة توقيع</button></div>
      <div class="panel-body">
        <div class="alert ok" style="font-size:12.5px">التواقيع (المسمى + الاسم) تظهر في أسفل التقارير المُصدَّرة. الرقم الضريبي والسجل والعنوان يظهرون على الفاتورة الضريبية.</div>
        <div class="sig-list" id="sig-list"></div>
        <button class="btn btn-gold" style="margin-top:6px" onclick="saveSettings()">💾 حفظ الإعدادات</button>
      </div>
    </div>`;
  $('#s-company').value = APP.settings.company_name || '';
  $('#s-from').value = APP.settings.period_from || '';
  $('#s-to').value = APP.settings.period_to || '';
  $('#s-tax').value = APP.settings.tax_no || '';
  $('#s-reg').value = APP.settings.commercial_reg || '';
  $('#s-addr').value = APP.settings.company_address || '';
  $('#s-bank').value = APP.settings.bank_details || '';
  SIGS = [...(APP.settings.signatures || [])];
  renderSigs();
  COMPANY_DRAFT.open();
  $('#regions-panel').style.display = '';
  loadRegions();
}

function renderSigs() {
  const c = $('#sig-list');
  if (!c) return;
  c.innerHTML = SIGS.map((s, i) => `
    <div class="sig-row" data-i="${i}">
      <input class="sig-title" placeholder="المسمى الوظيفي" value="${esc(s.title || '')}">
      <input class="sig-name" placeholder="الاسم" value="${esc(s.name || '')}">
      <button class="btn btn-sm btn-red" title="حذف" onclick="removeSigRow(${i})">🗑️</button>
    </div>`).join('');
  if (!SIGS.length) c.innerHTML = '<p class="empty-state">لا توجد تواقيع إضافية</p>';
}
function syncSigsFromDom() {
  $$('#sig-list .sig-row').forEach(r => { const i = Number(r.dataset.i); if (SIGS[i]) SIGS[i] = { title: $('.sig-title', r).value, name: $('.sig-name', r).value }; });
}
function addSigRow() { syncSigsFromDom(); SIGS.push({ title: '', name: '' }); renderSigs(); }
function removeSigRow(i) { syncSigsFromDom(); SIGS.splice(i, 1); renderSigs(); }

async function upsertSetting(key, value) {
  const row = { key, value: value == null ? '' : String(value) };
  let res = await supabase.from('settings').upsert(row);
  if (res.error) res = await supabase.from('settings').upsert(row, { onConflict: 'key' });
  if (res.error) throw res.error;
}

async function saveSettings() {
  try {
    const sigs = SIGS.map((s, i) => {
      const row = document.querySelector(`.sig-row[data-i="${i}"]`);
      return { title: row ? row.querySelector('.sig-title').value.trim() : s.title, name: row ? row.querySelector('.sig-name').value.trim() : s.name };
    }).filter(s => s.title && s.name);
    const company = $('#s-company').value.trim();
    const tax = $('#s-tax').value.trim();
    const reg = $('#s-reg').value.trim();
    const addr = $('#s-addr').value.trim();
    const bank = $('#s-bank').value.trim();
    const from = $('#s-from').value;
    const to = $('#s-to').value;
    if (from && to && from > to) return toast('بداية الفترة بعد نهايتها', 'err');
    await upsertSetting('tax_no', tax);
    await upsertSetting('commercial_reg', reg);
    await upsertSetting('bank_details', bank);
    await upsertSetting('company_address', addr);
    try {
      await DB.saveSettings({ company_name: company, period_from: from, period_to: to, signatures: sigs });
    } catch (e) {
      const msg = errMsg(e);
      if (!/log_audit|catch is not a function/i.test(msg)) throw e;
    }
    APP.settings.company_name = company || APP.settings.company_name;
    APP.settings.tax_no = tax;
    APP.settings.commercial_reg = reg;
    APP.settings.company_address = addr;
    APP.settings.bank_details = bank;
    APP.settings.period_from = from;
    APP.settings.period_to = to;
    APP.settings.signatures = sigs;
    COMPANY_DRAFT.done();
    COMPANY_DRAFT.open(); // الحالة المحفوظة تصبح الأصل لأي تعديل لاحق
    const note = `تم الحفظ — الرقم الضريبي: ${tax || '—'} — السجل: ${reg || '—'} — العنوان: ${addr || '—'}`;
    toast('تم حفظ بيانات المنشأة');
    const el = $('#s-saved');
    if (el) el.textContent = note;
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function changePw() {
  const oldPwd = $('#p-old').value, newPwd = $('#p-new').value;
  if (!oldPwd || !newPwd) return toast('املأ الخانتين', 'err');
  try {
    await DB.changeMyPassword(oldPwd, newPwd);
    toast('تم تغيير كلمة المرور بنجاح');
    $('#p-old').value = ''; $('#p-new').value = '';
  } catch (e) { toast(errMsg(e), 'err'); }
}

function openRegionModal(id, name) {
  editingRegionId = id || null;
  $('#region-modal-title').textContent = id ? 'تعديل المنطقة' : 'إضافة منطقة جديدة';
  $('#region-name').value = name || '';
  REGION_DRAFT.open();
  openModal('regionModal');
}
async function loadRegions() {
  try {
    const regions = await DB.regionsAll();
    const tb = $('#regions-body');
    if (!regions.length) { tb.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد مناطق بعد</td></tr>'; return; }
    tb.innerHTML = regions.map(r => `
      <tr>
        <td class="num">${r.id}</td>
        <td>${esc(r.name)}${r.is_active ? '' : ' <span class="badge draft">متعطّل</span>'}</td>
        <td class="num">${r.is_active ? '<span class="badge posted">نشط</span>' : '<span class="badge draft">متعطّل</span>'}</td>
        <td class="num">${r.usage_count > 0 ? r.usage_count : '—'}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn btn-sm btn-dark act-btn" title="تعديل الاسم" onclick='openRegionModal(${r.id}, ${JSON.stringify(r.name)})'>✏️</button>
          ${r.is_active ? `<button class="btn btn-sm btn-gold act-btn" title="تعطيل" onclick="toggleRegion(${r.id}, false)">⏸</button>`
                        : `<button class="btn btn-sm btn-teal act-btn" title="تفعيل" onclick="toggleRegion(${r.id}, true)">▶</button>`}
          ${r.usage_count > 0 ? `<button class="btn btn-sm btn-dark act-btn" title="فيها قيود" style="opacity:.4;cursor:not-allowed">🗑️</button>`
                               : `<button class="btn btn-sm btn-red act-btn" title="حذف نهائي" onclick='delRegion(${r.id}, ${JSON.stringify(r.name)})'>🗑️</button>`}
        </td>
      </tr>`).join('');
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function saveRegion() {
  const name = $('#region-name').value.trim();
  if (!name) return toast('اكتب اسم المنطقة', 'err');
  try {
    if (editingRegionId) await DB.renameRegion(editingRegionId, name); else await DB.addRegion(name);
    REGION_DRAFT.done();
    closeModal('regionModal');
    toast(editingRegionId ? 'تم تعديل الاسم' : 'تمت الإضافة');
    loadRegions();
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function toggleRegion(id, active) {
  try { await DB.setRegionActive(id, active); toast(active ? 'تم التفعيل' : 'تم التعطيل'); loadRegions(); }
  catch (e) { toast(errMsg(e), 'err'); }
}
async function delRegion(id, name) {
  if (!await confirmDlg(`حذف المنطقة «${name}» نهائيًا؟`)) return;
  try { await DB.deleteRegion(id); toast('تم الحذف'); loadRegions(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({ activePath: 'settings.html', adminOnly: false }).then(() => {
  if (!(APP.isAdmin() || APP.isAccountsManager())) {
    $('#admin-settings').innerHTML = '<div class="panel"><div class="panel-body">بيانات المنشأة يعدّلها مدير النظام من هذه الصفحة.</div></div>';
    return;
  }
  renderAdminPanels();
});
