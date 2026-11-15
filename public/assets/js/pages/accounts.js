'use strict';

let ACCOUNTS = [];

function buildToolbar() {
  const tb = $('#toolbar');
  let html = '';
  if (APP.canWrite()) html += `<button class="btn btn-teal btn-sm" onclick="openAccModal()">➕ حساب جديد</button>`;
  if (APP.canWrite()) html += `<button class="btn btn-dark btn-sm" onclick="openModal('importModal')">📥 استيراد</button>`;
  html += `<button class="btn btn-gold btn-sm" onclick="doExport()">📊 تصدير Excel</button>`;
  if (APP.isAdmin()) html += `<button class="btn btn-red btn-sm" onclick="wipeAll()">🗑️ مسح الشجرة كاملة</button>`;
  tb.innerHTML = html;
}

async function load() {
  try {
    ACCOUNTS = await DB.accounts();
    render(ACCOUNTS);
  } catch (e) { toast(errMsg(e), 'err'); }
}

function render(list) {
  const tb = $('#acc-table tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="big">📚</div>لا توجد حسابات — أضف أول حساب أو استورد من إكسيل</td></tr>';
    return;
  }
  const canWrite = APP.canWrite();
  tb.innerHTML = list.map(a => `
    <tr>
      <td class="num">${esc(a.acc_no)}</td>
      <td>${esc(a.name)}</td>
      <td>${a.type ? `<span class="badge region">${esc(a.type)}</span>` : '<span class="badge gray">—</span>'}</td>
      <td class="num">${fmt(a.opening_balance)}</td>
      <td class="num ${a.budget > 0 ? 'budget-cell' : ''}">${a.budget > 0 ? fmt(a.budget) : '<span class="badge gray">—</span>'}</td>
      <td class="num">
        ${canWrite ? `
        <button class="btn btn-sm btn-dark act-btn" title="تعديل" onclick='editAcc(${JSON.stringify({ id: a.id, acc_no: a.acc_no, name: a.name, type: a.type, opening_balance: a.opening_balance, budget: a.budget })})'>✏️</button>
        <button class="btn btn-sm btn-red act-btn" title="حذف" onclick="delAcc(${a.id}, '${esc(a.acc_no)}')">🗑️</button>` : '<span class="badge gray">عرض فقط</span>'}
      </td>
    </tr>`).join('');
}

$('#search').addEventListener('input', e => {
  const q = e.target.value.trim();
  render(!q ? ACCOUNTS : ACCOUNTS.filter(a => a.acc_no.includes(q) || a.name.includes(q)));
});

function openAccModal() {
  $('#acc-modal-title').textContent = 'حساب جديد';
  $('#f-id').value = ''; $('#f-no').value = ''; $('#f-name').value = '';
  $('#f-type').value = ''; $('#f-open').value = '0'; $('#f-budget').value = '0';
  openModal('accModal');
}
function editAcc(a) {
  $('#acc-modal-title').textContent = 'تعديل حساب';
  $('#f-id').value = a.id; $('#f-no').value = a.acc_no;
  $('#f-name').value = a.name; $('#f-type').value = a.type || '';
  $('#f-open').value = a.opening_balance; $('#f-budget').value = a.budget || 0;
  openModal('accModal');
}

async function saveAccount() {
  const body = {
    acc_no: $('#f-no').value.trim(), name: $('#f-name').value.trim(), type: $('#f-type').value,
    opening_balance: parseFloat($('#f-open').value || 0), budget: parseFloat($('#f-budget').value || 0),
  };
  if (!body.acc_no || !body.name) return toast('رقم الحساب واسم الحساب مطلوبان', 'err');
  try {
    const id = $('#f-id').value;
    if (id) await DB.updateAccount(id, body); else await DB.createAccount(body);
    closeModal('accModal');
    toast(id ? 'تم تعديل الحساب' : 'تمت إضافة الحساب');
    load();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function delAcc(id, no) {
  if (!await confirmDlg(`حذف الحساب ${no}؟ لا يمكن الحذف إذا كان له حركات.`)) return;
  try { await DB.deleteAccount(id); toast('تم حذف الحساب'); load(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

async function doImport() {
  const f = $('#imp-file').files[0];
  if (!f) return toast('اختر ملفًا أولًا', 'err');
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    let added = 0, updated = 0; const errors = [];
    for (const r of rows) {
      const acc_no = String(r['رقم الحساب'] ?? r['acc_no'] ?? '').trim();
      const name = String(r['اسم الحساب'] ?? r['name'] ?? '').trim();
      const type = String(r['النوع'] ?? r['type'] ?? '').trim();
      if (!acc_no || !name) continue;
      try {
        const existing = await DB.accountByNo(acc_no);
        if (existing) { await DB.updateAccount(existing.id, { acc_no, name, type, opening_balance: existing.opening_balance, budget: existing.budget }); updated++; }
        else { await DB.createAccount({ acc_no, name, type, opening_balance: 0, budget: 0 }); added++; }
      } catch (e) { errors.push(`${acc_no}: ${errMsg(e)}`); }
    }
    $('#imp-result').innerHTML = `<div class="alert ok">✔ تم استيراد <b>${added}</b> حساب جديد وتحديث <b>${updated}</b> حساب موجود</div>` +
      (errors.length ? `<div class="alert warn">${errors.map(esc).join('<br>')}</div>` : '');
    toast('تم الاستيراد بنجاح');
    load();
  } catch (e) {
    $('#imp-result').innerHTML = `<div class="alert err">${esc(errMsg(e))}</div>`;
  }
}

function doExport() {
  const rows = [['رقم الحساب', 'اسم الحساب', 'النوع', 'الرصيد الافتتاحي', 'الميزانية التقديرية']];
  ACCOUNTS.forEach(a => rows.push([a.acc_no, a.name, a.type || '', a.opening_balance, a.budget]));
  exportExcel('دليل حسابات.xlsx', 'الحسابات', rows);
}

async function wipeAll() {
  if (!await confirmDlg('تحذير نهائي ⚠️ هتحذف الشجرة كاملة (كل الحسابات وكل القيود) نهائيًا. متأكد؟')) return;
  if (!await confirmDlg('تأكيد أخير: نفّذ مسح الشجرة الآن؟')) return;
  try {
    const d = await DB.wipeAccounts();
    toast(`تم مسح الشجرة: ${d.deleted_accounts} حساب و${d.deleted_entries} قيد`);
    load();
  } catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({ activePath: 'accounts.html' }).then(() => {
  buildToolbar();
  const q = new URLSearchParams(location.search).get('q');
  if (q) { $('#search').value = q; }
  load().then(() => { if (q) render(ACCOUNTS.filter(a => a.acc_no.includes(q) || a.name.includes(q))); });
});
