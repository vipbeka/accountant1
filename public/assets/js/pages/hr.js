'use strict';

let HR_ACCOUNTS = [];
let hrEditing = {};

const HR_LEAVE = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بدون راتب' };
const HR_ATT = { present: 'حضور', absent: 'غياب', leave: 'إجازة', late: 'تأخير' };
const HR_EOS_REASON = { end: 'إنهاء من صاحب العمل', resign: 'استقالة', contract: 'انتهاء العقد' };

function hrRegion() {
  return (APP.regions && APP.regions[0]) || 'المركز الرئيسي';
}
function hrEmpOptions(selected) {
  const list = HR.cache.employees.filter(e => e.status !== 'ended');
  return '<option value="">— اختر الموظف —</option>' + list.map(e =>
    `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(e.code)} — ${esc(e.name)}</option>`
  ).join('');
}
function hrJobOptions(selected) {
  return '<option value="">— بدون وظيفة —</option>' + HR.cache.jobs.map(j =>
    `<option value="${esc(j.id)}" ${j.id === selected ? 'selected' : ''}>${esc(j.title)}</option>`
  ).join('');
}
function hrAccOptions(selected, pred) {
  const list = pred ? HR_ACCOUNTS.filter(pred) : HR_ACCOUNTS;
  return '<option value="">— اختر الحساب —</option>' + list.map(a =>
    `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${esc(a.acc_no)} - ${esc(a.name)}</option>`
  ).join('');
}

function showHr(tab) {
  $$('.hr-panel').forEach(p => { p.style.display = 'none'; });
  $$('#hr-tabs button').forEach(b => b.classList.toggle('btn-gold', b.dataset.tab === tab));
  $$('#hr-tabs button').forEach(b => b.classList.toggle('btn-dark', b.dataset.tab !== tab));
  const panel = document.getElementById('panel-' + tab);
  if (panel) panel.style.display = '';
  const fn = {
    jobs: renderJobs, employees: renderEmployees, attendance: renderAttendance,
    leaves: renderLeaves, advances: renderAdvances, payroll: renderPayroll,
    eos: renderEos, statement: renderStatement,
  }[tab];
  if (fn) fn();
}

function renderJobs() {
  const rows = HR.cache.jobs.map(j => `<tr>
    <td class="num">${esc(j.code)}</td>
    <td>${esc(j.title)}</td>
    <td>${esc(j.department || '—')}</td>
    <td class="num">${fmt(j.basic_salary)}</td>
    <td>${esc(j.description || '')}</td>
    <td class="num">${APP.canWrite() ? `<button class="btn btn-sm btn-dark" onclick="editJob('${j.id}')">تعديل</button>
      <button class="btn btn-sm btn-red" onclick="removeJob('${j.id}')">حذف</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-state">لا توجد وظائف</td></tr>';
  $('#panel-jobs').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>الوظائف</h3>
        ${APP.canWrite() ? '<button class="btn btn-teal btn-sm" onclick="editJob()">إضافة وظيفة</button>' : ''}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th class="num">الرمز</th><th>الوظيفة</th><th>القسم</th><th class="num">راتب أساسي مقترح</th><th>الوصف</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="modal-overlay" id="jobModal"><div class="modal">
      <div class="modal-head"><h3>وظيفة</h3><button class="modal-close" data-close-modal>×</button></div>
      <div class="modal-body">
        <div class="field"><label>المسمى</label><input id="j-title"></div>
        <div class="field"><label>القسم</label><input id="j-dept"></div>
        <div class="field"><label>راتب أساسي مقترح</label><input id="j-basic" type="number" min="0" step="0.01"></div>
        <div class="field"><label>الوصف</label><textarea id="j-desc"></textarea></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-gold" onclick="saveJobForm()">حفظ</button>
        <button class="btn btn-dark" data-close-modal>إلغاء</button>
      </div>
    </div></div>`;
}

function editJob(id) {
  hrEditing.job = id || null;
  const j = id ? HR.job(id) : { title: '', department: '', basic_salary: 0, description: '' };
  $('#j-title').value = j.title || '';
  $('#j-dept').value = j.department || '';
  $('#j-basic').value = j.basic_salary || 0;
  $('#j-desc').value = j.description || '';
  openModal('jobModal');
}
async function saveJobForm() {
  try {
    await HR.saveJob({
      id: hrEditing.job || undefined,
      title: $('#j-title').value,
      department: $('#j-dept').value,
      basic_salary: $('#j-basic').value,
      description: $('#j-desc').value,
    });
    closeModal('jobModal');
    toast('تم حفظ الوظيفة');
    renderJobs();
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function removeJob(id) {
  if (!await confirmDlg('حذف هذه الوظيفة؟')) return;
  try { await HR.deleteJob(id); toast('تم الحذف'); renderJobs(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

function renderEmployees() {
  const rows = HR.cache.employees.map(e => {
    const job = HR.job(e.job_id);
    const cv = e.cv_data ? `<button class="btn btn-sm btn-teal" onclick="downloadCv('${e.id}')">تنزيل السيرة</button>` : '—';
    return `<tr>
      <td class="num">${esc(e.code)}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(job ? job.title : '—')}</td>
      <td class="num">${esc(e.hire_date || '')}</td>
      <td class="num">${fmt(e.basic_salary)}</td>
      <td class="num">${fmt(e.allowances)}</td>
      <td>${e.status === 'ended' ? '<span class="badge draft">منتهية</span>' : '<span class="badge posted">نشط</span>'}</td>
      <td class="num">${cv}</td>
      <td class="num"><button class="btn btn-sm btn-gold" onclick="openEmployeeStatement('${e.id}')">كشف</button> ${APP.canWrite() ? `<button class="btn btn-sm btn-dark" onclick="editEmployee('${e.id}')">تعديل</button>
        <button class="btn btn-sm btn-red" onclick="removeEmployee('${e.id}')">حذف</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-state">لا يوجد موظفون</td></tr>';
  $('#panel-employees').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>ملفات الموظفين</h3>
        ${APP.canWrite() ? '<button class="btn btn-teal btn-sm" onclick="editEmployee()">إضافة موظف</button>' : ''}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th class="num">الرمز</th><th>الاسم</th><th>الوظيفة</th><th class="num">التعيين</th>
        <th class="num">الأساسي</th><th class="num">البدلات</th><th>الحالة</th><th class="num">السيرة</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="modal-overlay" id="empModal"><div class="modal" style="max-width:720px">
      <div class="modal-head"><h3>ملف موظف</h3><button class="modal-close" data-close-modal>×</button></div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="field"><label>الاسم</label><input id="e-name"></div>
          <div class="field"><label>الرقم القومي</label><input id="e-nid"></div>
          <div class="field"><label>الهاتف</label><input id="e-phone"></div>
          <div class="field"><label>الوظيفة</label><select id="e-job"></select></div>
          <div class="field"><label>تاريخ التعيين</label><input id="e-hire" type="date"></div>
          <div class="field"><label>راتب أساسي</label><input id="e-basic" type="number" min="0" step="0.01"></div>
          <div class="field"><label>بدلات</label><input id="e-allow" type="number" min="0" step="0.01"></div>
          <div class="field"><label>أجر تأميني</label><input id="e-insw" type="number" min="0" step="0.01"></div>
          <div class="field"><label>تأمينات الموظف %</label><input id="e-insp" type="number" min="0" step="0.01" value="11"></div>
          <div class="field"><label>ضريبة %</label><input id="e-taxp" type="number" min="0" step="0.01" value="0"></div>
          <div class="field"><label>رصيد إجازة سنوية (يوم)</label><input id="e-leave" type="number" min="0" step="1" value="21"></div>
          <div class="field"><label>السيرة الذاتية (PDF أو صورة، حتى 700 ك.ب)</label><input id="e-cv" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf"></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-gold" onclick="saveEmployeeForm()">حفظ</button>
        <button class="btn btn-dark" id="e-clear-cv" style="display:none" onclick="clearEmployeeCv()">حذف السيرة</button>
        <button class="btn btn-dark" data-close-modal>إلغاء</button>
      </div>
    </div></div>`;
}

async function removeEmployee(id) {
  const emp = HR.employee(id);
  if (!emp) return;
  if (!await confirmDlg('حذف الموظف «' + emp.name + '»؟ يُحذف ملفه وحضوره وإجازاته. لا يُحذف إن كان له راتب أو سلفة مرحّلة.')) return;
  try {
    await HR.deleteEmployee(id);
    toast('تم حذف الموظف');
    renderEmployees();
  } catch (e) { toast(errMsg(e), 'err'); }
}
function editEmployee(id) {
  hrEditing.emp = id || null;
  hrEditing.cv = null;
  const e = id ? HR.employee(id) : null;
  $('#e-job').innerHTML = hrJobOptions(e && e.job_id);
  $('#e-name').value = e ? e.name : '';
  $('#e-nid').value = e ? e.national_id || '' : '';
  $('#e-phone').value = e ? e.phone || '' : '';
  $('#e-hire').value = e ? e.hire_date || '' : new Date().toISOString().slice(0, 10);
  $('#e-basic').value = e ? e.basic_salary : 0;
  $('#e-allow').value = e ? e.allowances : 0;
  $('#e-insw').value = e ? (e.insurable_wage || e.basic_salary || 0) : 0;
  $('#e-insp').value = e ? e.insurance_pct : 11;
  $('#e-taxp').value = e ? e.tax_pct : 0;
  $('#e-leave').value = e ? e.annual_leave_days : 21;
  $('#e-cv').value = '';
  $('#e-clear-cv').style.display = e && e.cv_data ? '' : 'none';
  openModal('empModal');
}

function readCvFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 700 * 1024) return reject(new Error('حجم السيرة أكبر من 700 ك.ب'));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', data: String(reader.result || '') });
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

async function saveEmployeeForm() {
  try {
    const cv = await readCvFile($('#e-cv').files && $('#e-cv').files[0]);
    const payload = {
      id: hrEditing.emp || undefined,
      name: $('#e-name').value,
      national_id: $('#e-nid').value,
      phone: $('#e-phone').value,
      job_id: $('#e-job').value,
      hire_date: $('#e-hire').value,
      basic_salary: $('#e-basic').value,
      allowances: $('#e-allow').value,
      insurable_wage: $('#e-insw').value,
      insurance_pct: $('#e-insp').value,
      tax_pct: $('#e-taxp').value,
      annual_leave_days: $('#e-leave').value,
    };
    if (cv) {
      payload.cv_name = cv.name;
      payload.cv_type = cv.type;
      payload.cv_data = cv.data;
    }
    await HR.saveEmployee(payload);
    closeModal('empModal');
    toast('تم حفظ ملف الموظف');
    renderEmployees();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function clearEmployeeCv() {
  if (!hrEditing.emp) return;
  try {
    await HR.clearCv(hrEditing.emp);
    toast('حُذفت السيرة');
    closeModal('empModal');
    renderEmployees();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function downloadCv(id) {
  const e = HR.employee(id);
  if (!e || !e.cv_data) return;
  const a = document.createElement('a');
  a.href = e.cv_data;
  a.download = e.cv_name || (e.name + '-cv');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderAttendance() {
  const month = (hrEditing.attMonth || new Date().toISOString().slice(0, 7));
  hrEditing.attMonth = month;
  const rows = HR.cache.attendance
    .filter(a => String(a.date).slice(0, 7) === month)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(a => {
      const e = HR.employee(a.employee_id);
      return `<tr>
        <td class="num">${esc(a.date)}</td>
        <td>${esc(e ? e.name : '—')}</td>
        <td>${esc(HR_ATT[a.status] || a.status)}</td>
        <td>${esc(a.note || '')}</td>
        <td class="num">${APP.canWrite() ? `<button class="btn btn-sm btn-red" onclick="removeAttendance('${a.id}')">حذف</button>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="empty-state">لا سجلات لهذا الشهر</td></tr>';
  $('#panel-attendance').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>الحضور</h3></div>
      <div class="filters">
        <div class="field"><label>الشهر</label><input id="att-month" type="month" value="${month}"></div>
        <div class="field"><label>الموظف</label><select id="att-emp">${hrEmpOptions()}</select></div>
        <div class="field"><label>التاريخ</label><input id="att-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>الحالة</label>
          <select id="att-status"><option value="present">حضور</option><option value="absent">غياب</option><option value="leave">إجازة</option><option value="late">تأخير</option></select></div>
        <div class="field"><label>ملاحظة</label><input id="att-note"></div>
        ${APP.canWrite() ? '<button class="btn btn-gold" onclick="saveAttendanceForm()">تسجيل</button>' : ''}
        <button class="btn btn-dark" onclick="hrEditing.attMonth=$('#att-month').value;renderAttendance()">عرض</button>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th class="num">التاريخ</th><th>الموظف</th><th>الحالة</th><th>ملاحظة</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
async function saveAttendanceForm() {
  try {
    await HR.saveAttendance({
      employee_id: $('#att-emp').value,
      date: $('#att-date').value,
      status: $('#att-status').value,
      note: $('#att-note').value.trim(),
    });
    hrEditing.attMonth = $('#att-month').value || String($('#att-date').value).slice(0, 7);
    toast('تم تسجيل الحضور');
    renderAttendance();
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function removeAttendance(id) {
  if (!await confirmDlg('حذف سجل الحضور؟')) return;
  try { await HR.deleteAttendance(id); renderAttendance(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

function renderLeaves() {
  const rows = HR.cache.leaves.slice().sort((a, b) => String(b.from).localeCompare(String(a.from))).map(l => {
    const e = HR.employee(l.employee_id);
    const st = l.status === 'approved' ? 'مقبولة' : l.status === 'rejected' ? 'مرفوضة' : 'قيد المراجعة';
    return `<tr>
      <td>${esc(e ? e.name : '—')}</td>
      <td>${esc(HR_LEAVE[l.kind] || l.kind)}</td>
      <td class="num">${esc(l.from)} → ${esc(l.to)}</td>
      <td class="num">${l.days}</td>
      <td>${esc(st)}</td>
      <td class="num">${APP.canWrite() && l.status === 'pending' ? `
        <button class="btn btn-sm btn-green" onclick="setLeave('${l.id}','approved')">قبول</button>
        <button class="btn btn-sm btn-red" onclick="setLeave('${l.id}','rejected')">رفض</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">لا إجازات</td></tr>';
  $('#panel-leaves').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>الإجازات</h3></div>
      ${APP.canWrite() ? `<div class="filters">
        <div class="field"><label>الموظف</label><select id="lv-emp">${hrEmpOptions()}</select></div>
        <div class="field"><label>النوع</label>
          <select id="lv-kind"><option value="annual">سنوية</option><option value="sick">مرضية</option><option value="unpaid">بدون راتب</option></select></div>
        <div class="field"><label>من</label><input id="lv-from" type="date"></div>
        <div class="field"><label>إلى</label><input id="lv-to" type="date"></div>
        <div class="field"><label>ملاحظة</label><input id="lv-note"></div>
        <button class="btn btn-gold" onclick="saveLeaveForm()">إضافة</button>
      </div>` : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>الموظف</th><th>النوع</th><th class="num">الفترة</th><th class="num">الأيام</th><th>الحالة</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
async function saveLeaveForm() {
  try {
    await HR.saveLeave({
      employee_id: $('#lv-emp').value,
      kind: $('#lv-kind').value,
      from: $('#lv-from').value,
      to: $('#lv-to').value,
      note: $('#lv-note').value.trim(),
      status: 'pending',
    });
    toast('أُضيف طلب الإجازة');
    renderLeaves();
  } catch (e) { toast(errMsg(e), 'err'); }
}
async function setLeave(id, status) {
  try { await HR.setLeaveStatus(id, status); toast('تم تحديث الإجازة'); renderLeaves(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

function renderAdvances() {
  const rows = HR.cache.advances.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(a => {
    const e = HR.employee(a.employee_id);
    return `<tr>
      <td class="num">${esc(a.no)}</td>
      <td>${esc(e ? e.name : '—')}</td>
      <td class="num">${esc(a.date)}</td>
      <td class="num">${fmt(a.amount)}</td>
      <td class="num">${a.installments}</td>
      <td class="num">${fmt(HR.advanceRemain(a))}</td>
      <td>${a.status === 'posted' ? '<span class="badge posted">مرحلة</span>' : '<span class="badge draft">مسودة</span>'}</td>
      <td class="num">${APP.canWrite() && a.status !== 'posted' ? `<button class="btn btn-sm btn-green" onclick="postAdvance('${a.id}')">ترحيل</button>` : esc(a.journal_mv || '')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty-state">لا سلف</td></tr>';
  const cash = hrAccOptions('', a => /صندوق|بنك|1101|1102|1103/.test((a.acc_no || '') + (a.name || '')) || a.type === 'أصول');
  $('#panel-advances').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>السلف</h3></div>
      <p class="hint" style="padding:0 16px">الترحيل: مدين سلف الموظفين 1205 ، دائن الصندوق. القسط يُخصم تلقائياً في مسير الرواتب.</p>
      ${APP.canWrite() ? `<div class="filters">
        <div class="field"><label>الموظف</label><select id="adv-emp">${hrEmpOptions()}</select></div>
        <div class="field"><label>التاريخ</label><input id="adv-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>المبلغ</label><input id="adv-amt" type="number" min="0" step="0.01"></div>
        <div class="field"><label>عدد الأقساط</label><input id="adv-inst" type="number" min="1" step="1" value="1"></div>
        <div class="field"><label>الصندوق / البنك</label><select id="adv-cash">${cash}</select></div>
        <div class="field"><label>البيان</label><input id="adv-desc"></div>
        <button class="btn btn-gold" onclick="saveAdvanceForm()">حفظ مسودة</button>
      </div>` : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th class="num">الرقم</th><th>الموظف</th><th class="num">التاريخ</th><th class="num">المبلغ</th>
        <th class="num">الأقساط</th><th class="num">المتبقي</th><th>الحالة</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

async function ensureHrAccount(no, name, type) {
  let acc = HR_ACCOUNTS.find(a => String(a.acc_no) === no);
  if (acc) return acc;
  const { data, error } = await supabase.from('accounts').insert({
    acc_no: no, name, type, opening_balance: 0, budget: 0,
  }).select().single();
  if (error) {
    acc = await DB.accountByNo(no);
    if (!acc) throw new Error('تعذر إنشاء الحساب ' + no + ' ' + name);
  } else acc = data;
  HR_ACCOUNTS.push(acc);
  return acc;
}

async function saveAdvanceForm() {
  try {
    await HR.saveAdvance({
      employee_id: $('#adv-emp').value,
      date: $('#adv-date').value,
      amount: $('#adv-amt').value,
      installments: $('#adv-inst').value,
      cash_account_id: $('#adv-cash').value,
      description: $('#adv-desc').value.trim(),
    });
    toast('حُفظت السلفة كمسودة');
    renderAdvances();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function postAdvance(id) {
  const a = HR.cache.advances.find(x => x.id === id);
  if (!a) return;
  if (!a.cash_account_id) return toast('أعد حفظ السلفة مع اختيار الصندوق', 'err');
  if (!await confirmDlg('ترحيل السلفة كقيد يومية؟')) return;
  try {
    const advAcc = await ensureHrAccount('1205', 'سلف الموظفين', 'أصول');
    const emp = HR.employee(a.employee_id);
    await postExtJournal({
      movement_no: a.no,
      entry_date: a.date,
      region: hrRegion(),
      description: 'سلفة موظف ' + a.no + (emp ? ' — ' + emp.name : '') + (a.description ? ' — ' + a.description : ''),
      entry_type: 'عادي',
      status: 'posted',
      lines: [
        { account_id: advAcc.id, debit: a.amount, credit: 0 },
        { account_id: Number(a.cash_account_id), debit: 0, credit: a.amount },
      ],
    });
    a.status = 'posted';
    a.journal_mv = a.no;
    a.paid = hrRound(a.paid || 0);
    await HR.persist();
    toast('تم ترحيل السلفة');
    renderAdvances();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function hrExcelRows(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=e=>{ try{ const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]]; resolve(XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false})); }catch(x){reject(x);} }; r.onerror=reject; r.readAsArrayBuffer(file); }); }
function hrHeaderIndex(headers,names){return headers.findIndex(h=>names.some(n=>String(h||'').trim().toLowerCase().includes(String(n).toLowerCase())));}
function hrCell(row,headers,names,fallback=''){const i=hrHeaderIndex(headers,names);return i>=0?String(row[i]??'').trim():fallback;}
async function importPayrollExcel(input){ const file=input.files&&input.files[0]; input.value=''; if(!file)return; try{const all=await hrExcelRows(file); if(!all.length)return toast('الملف فارغ','err'); const headers=all[0].map(x=>String(x??'')); const rows=all.slice(1).filter(r=>r.some(v=>String(v??'').trim()!=='')); const month=hrEditing.payMonth||new Date().toISOString().slice(0,7); const num=(v)=>Number(String(v||0).replace(/[,،]/g,''))||0; const lines=rows.map((row,i)=>{const net=num(hrCell(row,headers,['الصافي','net'],row[9])); const basic=num(hrCell(row,headers,['أساسي','basic'],row[2])); const allowances=num(hrCell(row,headers,['بدلات','allowances'],row[3])); return {employee_id:'',name:hrCell(row,headers,['الموظف','الاسم','employee','name'],row[1]||('صف '+(i+1))),code:hrCell(row,headers,['الرمز','code'],row[0]||''),basic,allowances,days:num(hrCell(row,headers,['أيام خصم','days'],row[4])),absenceDeduction:num(hrCell(row,headers,['خصم غياب','absence'],row[5])),insurance:num(hrCell(row,headers,['تأمينات','insurance'],row[6])),tax:num(hrCell(row,headers,['ضريبة','tax'],row[7])),advanceDeduction:num(hrCell(row,headers,['سلفة','advance'],row[8])),net,raw_row:row};}); const totals={earned:lines.reduce((a,l)=>a+num(l.basic)+num(l.allowances)-num(l.absenceDeduction),0),insurance:lines.reduce((a,l)=>a+l.insurance,0),tax:lines.reduce((a,l)=>a+l.tax,0),advance:lines.reduce((a,l)=>a+l.advanceDeduction,0),net:lines.reduce((a,l)=>a+l.net,0)}; const old=HR.cache.payrolls.findIndex(p=>p.month===month); const rec={id:HR.uid(),no:'PAYROLL-'+month,month,status:'imported',source:'excel',source_file:file.name,raw_headers:headers,raw_rows:rows,lines,totals}; if(old>=0)HR.cache.payrolls[old]=rec;else HR.cache.payrolls.push(rec); await HR.persist(); hrEditing.payMonth=month; renderPayroll(); toast('تم جلب '+rows.length+' صفاً كما هي من ملف Excel'); }catch(e){toast('تعذر قراءة ملف Excel: '+errMsg(e),'err');} }

function renderPayroll() {
  const month = hrEditing.payMonth || new Date().toISOString().slice(0, 7);
  hrEditing.payMonth = month;
  const existing = HR.cache.payrolls.find(p => p.month === month);
  let preview = null;
  let err = '';
  try { preview = existing && (existing.status === 'posted' || existing.source === 'excel') ? existing : HR.previewPayroll(month); }
  catch (e) { err = errMsg(e); }
  const lines = (preview && preview.lines) || [];
  const totals = (preview && preview.totals) || { earned: 0, insurance: 0, tax: 0, advance: 0, net: 0 };
  const rows = lines.map(l => `<tr>
    <td>${esc(l.code || '')}</td><td>${esc(l.name)}</td>
    <td class="num">${fmt(l.basic)}</td><td class="num">${fmt(l.allowances)}</td>
    <td class="num">${l.days}</td><td class="num">${fmt(l.absenceDeduction)}</td>
    <td class="num">${fmt(l.insurance)}</td><td class="num">${fmt(l.tax)}</td>
    <td class="num">${fmt(l.advanceDeduction)}</td><td class="num">${fmt(l.net)}</td>
  </tr>`).join('') || `<tr><td colspan="10" class="empty-state">${esc(err || 'لا موظفون نشطون في هذا الشهر')}</td></tr>`;
  const posted = existing && existing.status === 'posted';
  $('#panel-payroll').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>مسير الرواتب</h3>
        <div class="toolbar">
          <button class="btn btn-dark btn-sm" onclick="exportPayroll()">📊 تصدير Excel</button><button class="btn btn-teal btn-sm" onclick="document.getElementById('payroll-import-file').click()">📥 جلب Excel</button>
          <button class="btn btn-gold btn-sm" onclick="printPayroll()">طباعة</button>
          ${APP.canWrite() && !posted ? '<button class="btn btn-teal btn-sm" onclick="postPayroll()">ترحيل القيد</button>' : ''}
        </div>
      </div>
      <div class="filters">
        <div class="field"><label>الشهر</label><input id="pay-month" type="month" value="${month}"></div>
        <div class="field"><label>الصندوق / البنك</label><select id="pay-cash">${hrAccOptions(hrEditing.payCash || '')}</select></div>
        <button class="btn btn-dark" onclick="hrEditing.payMonth=$('#pay-month').value;hrEditing.payCash=$('#pay-cash').value;renderPayroll()">عرض</button>
      </div>
      <div class="panel-body hint">${posted ? 'هذا الشهر مرحّل بقيد ' + esc(existing.journal_mv || existing.no) : 'الغياب والإجازة بدون راتب تُخصم من الأساسي ÷ 30. التأمينات والضريبة حسب نسبة كل موظف. القسط يُخصم من السلف المرحّلة.'}</div>
      <div class="cards-grid">
        <div class="card"><div class="lbl">المستحق</div><div class="val">${fmt(totals.earned)}</div></div>
        <div class="card"><div class="lbl">تأمينات</div><div class="val">${fmt(totals.insurance)}</div></div>
        <div class="card"><div class="lbl">ضريبة</div><div class="val">${fmt(totals.tax)}</div></div>
        <div class="card"><div class="lbl">سلف</div><div class="val">${fmt(totals.advance)}</div></div>
        <div class="card green"><div class="lbl">صافي الصرف</div><div class="val green">${fmt(totals.net)}</div></div>
      </div>
      <div class="tbl-wrap"><table class="tbl" id="pay-table"><thead><tr>
        <th>الرمز</th><th>الموظف</th><th class="num">أساسي</th><th class="num">بدلات</th><th class="num">أيام خصم</th>
        <th class="num">خصم غياب</th><th class="num">تأمينات</th><th class="num">ضريبة</th><th class="num">سلفة</th><th class="num">الصافي</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  hrEditing.preview = preview;
}

async function postPayroll() {
  const month = $('#pay-month').value;
  const cashId = $('#pay-cash').value;
  if (!cashId) return toast('اختر حساب الصندوق أو البنك', 'err');
  if (!await confirmDlg('ترحيل مسير ' + month + ' قيداً واحداً؟')) return;
  try {
    const existing = HR.cache.payrolls.find(p => p.month === month && p.status === 'posted');
    if (existing) return toast('الشهر مرحّل بالفعل', 'err');
    const preview = HR.previewPayroll(month);
    if (!preview.lines.length) return toast('لا موظفون لهذا الشهر', 'err');
    const t = preview.totals;
    const salaryAcc = await ensureHrAccount('5101', 'رواتب وأجور', 'مصروفات');
    const lines = [{ account_id: salaryAcc.id, debit: t.earned, credit: 0 }];
    if (t.insurance > 0) {
      const ins = await ensureHrAccount('2104', 'تأمينات اجتماعية مستحقة', 'خصوم');
      lines.push({ account_id: ins.id, debit: 0, credit: t.insurance });
    }
    if (t.tax > 0) {
      const tax = await ensureHrAccount('2105', 'ضريبة كسب عمل مستحقة', 'خصوم');
      lines.push({ account_id: tax.id, debit: 0, credit: t.tax });
    }
    if (t.advance > 0) {
      const adv = await ensureHrAccount('1205', 'سلف الموظفين', 'أصول');
      lines.push({ account_id: adv.id, debit: 0, credit: t.advance });
    }
    if (t.net > 0) lines.push({ account_id: Number(cashId), debit: 0, credit: t.net });
    const no = 'PAYROLL-' + month;
    await postExtJournal({
      movement_no: no,
      entry_date: hrMonthLast(month),
      region: hrRegion(),
      description: 'مسير رواتب شهر ' + month,
      entry_type: 'عادي',
      status: 'posted',
      lines,
    });
    preview.lines.forEach(l => {
      (l.splits || []).forEach(s => {
        const adv = HR.cache.advances.find(a => a.id === s.advance_id);
        if (adv) adv.paid = hrRound(Number(adv.paid || 0) + s.amount);
      });
    });
    const prev = HR.cache.payrolls.findIndex(p => p.month === month);
    const rec = Object.assign(preview, { id: HR.uid(), no, status: 'posted', journal_mv: no, cash_account_id: cashId });
    if (prev >= 0) HR.cache.payrolls[prev] = rec;
    else HR.cache.payrolls.push(rec);
    await HR.persist();
    toast('تم ترحيل مسير الرواتب');
    hrEditing.payMonth = month;
    renderPayroll();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function payrollSheetHtml() {
  const p = hrEditing.preview;
  if (!p) return '';
  const rows = (p.lines || []).map(l => `<tr>
    <td>${esc(l.name)}</td><td class="num">${fmt(l.basic)}</td><td class="num">${fmt(l.allowances)}</td>
    <td class="num">${l.days}</td><td class="num">${fmt(l.insurance)}</td><td class="num">${fmt(l.tax)}</td>
    <td class="num">${fmt(l.advanceDeduction)}</td><td class="num">${fmt(l.net)}</td></tr>`).join('');
  return `<div class="bar"></div><div class="pad">
    <h1>مسير رواتب ${esc(p.month)}</h1>
    <p>${esc(APP.settings.company_name || '')}</p>
    <table class="doc-table"><thead><tr>
      <th>الموظف</th><th>أساسي</th><th>بدلات</th><th>أيام خصم</th><th>تأمينات</th><th>ضريبة</th><th>سلفة</th><th>الصافي</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>الإجمالي</td><td></td><td></td><td></td>
      <td class="num">${fmt(p.totals.insurance)}</td><td class="num">${fmt(p.totals.tax)}</td>
      <td class="num">${fmt(p.totals.advance)}</td><td class="num">${fmt(p.totals.net)}</td></tr></tfoot></table>
  </div>`;
}
function printPayroll() {
  if (!hrEditing.preview) return toast('اعرض الشهر أولاً', 'err');
  if (typeof showDoc === 'function') showDoc(payrollSheetHtml());
  else toast('تعذر فتح الطباعة', 'err');
}
function exportPayroll() {
  const p = hrEditing.preview;
  if (!p) return toast('اعرض الشهر أولاً', 'err');
  const aoa = [['الرمز', 'الموظف', 'أساسي', 'بدلات', 'أيام خصم', 'خصم غياب', 'تأمينات', 'ضريبة', 'سلفة', 'الصافي']];
  p.lines.forEach(l => aoa.push([l.code, l.name, l.basic, l.allowances, l.days, l.absenceDeduction, l.insurance, l.tax, l.advanceDeduction, l.net]));
  aoa.push(['الإجمالي', '', '', '', '', '', p.totals.insurance, p.totals.tax, p.totals.advance, p.totals.net]);
  exportExcel('مسير-' + p.month + '.xlsx', 'رواتب', aoa);
}

function renderEos() {
  $('#panel-eos').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>نهاية الخدمة</h3></div>
      <div class="panel-body hint">احتساب تقديري: نصف شهر عن كل سنة من الخمس الأولى، وشهر عن كل سنة بعد ذلك، من الراتب الأساسي. الاستقالة تُخفّض النسبة (أقل من سنتين = صفر، أقل من 5 = الثلث، أقل من 10 = الثلثين). يمكن تعديل المبلغ قبل الترحيل.</div>
      <div class="filters">
        <div class="field"><label>الموظف</label><select id="eos-emp" onchange="fillEos()">${hrEmpOptions()}</select></div>
        <div class="field"><label>تاريخ الانتهاء</label><input id="eos-date" type="date" value="${new Date().toISOString().slice(0, 10)}" onchange="fillEos()"></div>
        <div class="field"><label>السبب</label>
          <select id="eos-reason" onchange="fillEos()">
            <option value="end">إنهاء من صاحب العمل</option>
            <option value="resign">استقالة</option>
            <option value="contract">انتهاء العقد</option>
          </select></div>
        <div class="field"><label>المبلغ</label><input id="eos-amt" type="number" min="0" step="0.01"></div>
        <div class="field"><label>الصندوق</label><select id="eos-cash">${hrAccOptions()}</select></div>
        ${APP.canWrite() ? '<button class="btn btn-gold" onclick="postEos()">ترحيل وإنهاء الخدمة</button>' : ''}
      </div>
      <p id="eos-note" class="hint" style="padding:0 16px 16px"></p>
    </div>`;
}
function fillEos() {
  const emp = HR.employee($('#eos-emp').value);
  const info = hrEosPreview(emp, $('#eos-date').value, $('#eos-reason').value);
  $('#eos-amt').value = info.amount;
  $('#eos-note').textContent = emp
    ? ('سنوات الخدمة ' + info.years + ' — أشهر المكافأة ' + info.months + ' — معامل السبب ' + info.factor)
    : '';
}
async function postEos() {
  const emp = HR.employee($('#eos-emp').value);
  if (!emp) return toast('اختر الموظف', 'err');
  if (emp.status === 'ended') return toast('خدمة الموظف منتهية بالفعل', 'err');
  const amount = hrRound($('#eos-amt').value || 0);
  const cash = $('#eos-cash').value;
  if (!(amount > 0)) return toast('المبلغ صفر', 'err');
  if (!cash) return toast('اختر الصندوق', 'err');
  if (!await confirmDlg('ترحيل مكافأة نهاية الخدمة وإنهاء ملف ' + emp.name + '؟')) return;
  try {
    const exp = await ensureHrAccount('5114', 'مكافأة نهاية الخدمة', 'مصروفات');
    const no = 'EOS-' + String(emp.code || emp.id).replace(/\s/g, '');
    await postExtJournal({
      movement_no: no,
      entry_date: $('#eos-date').value,
      region: hrRegion(),
      description: 'مكافأة نهاية خدمة — ' + emp.name + ' — ' + (HR_EOS_REASON[$('#eos-reason').value] || ''),
      entry_type: 'عادي',
      status: 'posted',
      lines: [
        { account_id: exp.id, debit: amount, credit: 0 },
        { account_id: Number(cash), debit: 0, credit: amount },
      ],
    });
    emp.status = 'ended';
    emp.end_date = $('#eos-date').value;
    emp.end_reason = $('#eos-reason').value;
    emp.eos_amount = amount;
    emp.eos_journal = no;
    await HR.persist();
    toast('تم ترحيل نهاية الخدمة');
    renderEos();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function openEmployeeStatement(id) { hrEditing.statementId = id; showHr('statement'); }
function cvPreviewHtml(emp) {
  if (!emp || !emp.cv_data) return '<div class="box"><h3>السيرة الذاتية</h3><p>لا توجد سيرة ذاتية مرفقة.</p></div>';
  const type = String(emp.cv_type || '').toLowerCase();
  const label = esc(emp.cv_name || 'السيرة الذاتية');
  if (type.includes('pdf') || type.startsWith('image/')) return `<div class="box"><h3>السيرة الذاتية — ${label}</h3><iframe src="${esc(emp.cv_data)}" title="السيرة الذاتية" style="width:100%;height:560px;border:1px solid #ddd;border-radius:8px;background:#fff"></iframe><p><a class="btn btn-sm btn-teal" href="${esc(emp.cv_data)}" download="${label}">تنزيل السيرة</a></p></div>`;
  return `<div class="box"><h3>السيرة الذاتية — ${label}</h3><p>هذا النوع من الملفات لا يعرض داخل المتصفح.</p><a class="btn btn-sm btn-teal" href="${esc(emp.cv_data)}" download="${label}">تنزيل السيرة كاملة</a></div>`;
}

function renderStatement() {
  const id = hrEditing.statementId || '';
  const emp = id ? HR.employee(id) : null;
  let body = '<p class="hint">اختر موظفاً لعرض كشفه.</p>';
  if (emp) {
    const job = HR.job(emp.job_id);
    const year = new Date().getFullYear();
    const used = HR.leaveDaysUsed(emp.id, year, 'annual');
    const adv = HR.cache.advances.filter(a => a.employee_id === emp.id);
    const leaves = HR.cache.leaves.filter(l => l.employee_id === emp.id).sort((a, b) => String(b.from || '').localeCompare(String(a.from || '')));
    const pays = HR.cache.payrolls.filter(p => p.status === 'posted' && (p.lines || []).some(l => l.employee_id === emp.id));
    const att = HR.cache.attendance.filter(a => a.employee_id === emp.id);
    const absent = att.filter(a => a.status === 'absent').length;
    body = `
      <div class="cards-grid">
        <div class="card"><div class="lbl">الوظيفة</div><div class="val" style="font-size:18px">${esc(job ? job.title : '—')}</div></div>
        <div class="card"><div class="lbl">الراتب الأساسي</div><div class="val">${fmt(emp.basic_salary)}</div></div>
        <div class="card"><div class="lbl">إجازة سنوية متبقية ${year}</div><div class="val">${fmt(Number(emp.annual_leave_days || 21) - used)}</div></div>
        <div class="card"><div class="lbl">سلف متبقية</div><div class="val">${fmt(adv.reduce((s, a) => s + HR.advanceRemain(a), 0))}</div></div>
      </div>
      <p class="hint">التعيين ${esc(emp.hire_date || '—')} — غياب مسجّل ${absent} يوم — الحالة ${emp.status === 'ended' ? 'منتهية' : 'نشط'}
        ${emp.eos_amount ? ' — مكافأة نهاية خدمة ' + fmt(emp.eos_amount) : ''}</p>
      ${cvPreviewHtml(emp)}
      <h3 style="margin:12px 0">الرواتب المرحلة</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>الشهر</th><th class="num">مستحق</th><th class="num">تأمينات</th><th class="num">ضريبة</th><th class="num">سلفة</th><th class="num">صافي</th>
      </tr></thead><tbody>${pays.map(p => {
        const l = p.lines.find(x => x.employee_id === emp.id);
        return `<tr><td>${esc(p.month)}</td><td class="num">${fmt(l.earned)}</td><td class="num">${fmt(l.insurance)}</td><td class="num">${fmt(l.tax)}</td><td class="num">${fmt(l.advanceDeduction)}</td><td class="num">${fmt(l.net)}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty-state">لا مسيرات</td></tr>'}</tbody></table></div>
      <h3 style="margin:12px 0">السلف</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>الرقم</th><th class="num">التاريخ</th><th class="num">المبلغ</th><th class="num">المتبقي</th><th>الحالة</th>
      </tr></thead><tbody>${adv.map(a => `<tr><td>${esc(a.no)}</td><td class="num">${esc(a.date)}</td><td class="num">${fmt(a.amount)}</td><td class="num">${fmt(HR.advanceRemain(a))}</td><td>${a.status === 'posted' ? 'مرحلة' : 'مسودة'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">لا سلف</td></tr>'}</tbody></table></div>
      <h3 style="margin:12px 0">الإجازات</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th class="num">من</th><th class="num">إلى</th><th class="num">الأيام</th><th>الحالة</th><th>البيان</th></tr></thead><tbody>${leaves.map(l => `<tr><td>${l.kind === 'annual' ? 'سنوية' : l.kind === 'sick' ? 'مرضية' : 'بدون راتب'}</td><td class="num">${esc(l.from || '—')}</td><td class="num">${esc(l.to || '—')}</td><td class="num">${fmt(l.days || 0)}</td><td>${l.status === 'approved' ? 'معتمدة' : l.status === 'rejected' ? 'مرفوضة' : 'معلقة'}</td><td>${esc(l.note || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">لا إجازات</td></tr>'}</tbody></table></div>
      <h3 style="margin:12px 0">الحضور والغياب</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">التاريخ</th><th>الحالة</th><th>البيان</th></tr></thead><tbody>${att.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(a => `<tr><td class="num">${esc(a.date || '—')}</td><td>${esc(HR_ATT[a.status] || a.status || '—')}</td><td>${esc(a.note || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">لا سجلات حضور</td></tr>'}</tbody></table></div>`;
  }
  $('#panel-statement').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>كشف الموظف</h3>
        <div class="toolbar">
          <button class="btn btn-gold btn-sm" onclick="printStatement()">طباعة</button>
          <button class="btn btn-dark btn-sm" onclick="exportStatement()">Excel</button>
        </div></div>
      <div class="filters">
        <div class="field"><label>الموظف</label>
          <select id="st-emp" onchange="hrEditing.statementId=this.value;renderStatement()">
            <option value="">—</option>
            ${HR.cache.employees.map(e => `<option value="${esc(e.id)}" ${e.id === id ? 'selected' : ''}>${esc(e.code)} — ${esc(e.name)}</option>`).join('')}
          </select></div>
      </div>
      <div id="st-body">${body}</div>
    </div>`;
}

function cvPrintHtml(emp) {
  if (!emp || !emp.cv_data) return '<div class="box cv-print-empty"><h3>السيرة الذاتية</h3><p>لا توجد سيرة ذاتية مرفقة.</p></div>';
  const type = String(emp.cv_type || '').toLowerCase();
  const label = esc(emp.cv_name || 'السيرة الذاتية');
  if (type.startsWith('image/')) {
    return `<div class="box cv-print-block"><h3>السيرة الذاتية — ${label}</h3><img class="cv-print-image" src="${esc(emp.cv_data)}" alt="${label}"></div>`;
  }
  if (type.includes('pdf')) {
    return `<div class="box cv-print-block cv-print-pdf"><h3>السيرة الذاتية — ${label}</h3><object class="cv-print-pdf-object" data="${esc(emp.cv_data)}" type="application/pdf"><p>تعذر عرض ملف PDF داخل الطباعة. استخدم زر تنزيل السيرة لطباعتها كاملة.</p></object></div>`;
  }
  return `<div class="box cv-print-block"><h3>السيرة الذاتية — ${label}</h3><p>هذا النوع من الملفات لا يُعرض داخل الطباعة.</p><a href="${esc(emp.cv_data)}" download="${label}">تنزيل السيرة كاملة</a></div>`;
}

function printStatement() {
  const emp = HR.employee(hrEditing.statementId);
  if (!emp) return toast('اختر الموظف', 'err');
  const statementHtml = $('#st-body').innerHTML;
  // استبدال iframe ذي الارتفاع الثابت بعنصر طباعة يتمدد مع الصورة أو المستند.
  const cvOnScreen = cvPreviewHtml(emp);
  const cvForPrint = cvPrintHtml(emp);
  const printableBody = statementHtml.includes(cvOnScreen) ? statementHtml.replace(cvOnScreen, cvForPrint) : statementHtml;
  const html = `<div class="bar"></div><div class="pad hr-print-sheet"><h1>كشف موظف — ${esc(emp.name)}</h1><p>${esc(emp.code)} — ${esc(APP.settings.company_name || '')}</p>${printableBody}</div><style>
    .hr-print-sheet .cv-print-block{page-break-inside:avoid;break-inside:avoid;background:#fff}
    .hr-print-sheet .cv-print-image{display:block;width:auto;max-width:100%;height:auto;max-height:none;object-fit:contain;margin:0 auto}
    .hr-print-sheet .cv-print-pdf-object{display:block;width:100%;height:1050px;border:1px solid #ddd;background:#fff}
    @media print{.hr-print-sheet .cv-print-image{max-width:100%;height:auto!important}.hr-print-sheet .cv-print-pdf-object{height:1050px!important}.hr-print-sheet .cv-print-block{page-break-before:always}}
  </style>`;
  if (typeof showDoc === 'function') showDoc(html);
}
function exportStatement() {
  const emp = HR.employee(hrEditing.statementId);
  if (!emp) return toast('اختر الموظف', 'err');
  const aoa = [['كشف', emp.name, emp.code], ['أساسي', emp.basic_salary, 'بدلات', emp.allowances], []];
  aoa.push(['شهر', 'مستحق', 'تأمينات', 'ضريبة', 'سلفة', 'صافي']);
  HR.cache.payrolls.filter(p => p.status === 'posted').forEach(p => {
    const l = (p.lines || []).find(x => x.employee_id === emp.id);
    if (l) aoa.push([p.month, l.earned, l.insurance, l.tax, l.advanceDeduction, l.net]);
  });
  exportExcel('كشف-' + emp.code + '.xlsx', 'كشف', aoa);
}

APP.requireAuth({ activePath: 'hr.html' }).then(async () => {
  try {
    await HR.hydrate();
    if (window.EXT) await EXT.hydrate();
    if (window.EXT && HR.syncSalaryVouchers) await HR.syncSalaryVouchers(EXT.vouchers(), EXT.parties());
    HR_ACCOUNTS = await DB.accounts();
    $$('#hr-tabs button').forEach(b => b.addEventListener('click', () => showHr(b.dataset.tab)));
    showHr('employees');
  } catch (e) { toast(errMsg(e), 'err'); }
});
