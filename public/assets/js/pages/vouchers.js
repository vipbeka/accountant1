'use strict';

let ACCOUNTS = [], editingId = null;

const VKIND = { receipt: 'قبض', payment: 'صرف', salary: 'راتب' };

function onVKind() {
  const k = $('#v-kind').value;
  const pk = k === 'receipt' ? 'customer' : k === 'salary' ? 'employee' : 'vendor';
  $('#v-party').innerHTML = partyOptionsHtml(pk, $('#v-party').value);
  fillInvoices();
  if (k === 'salary') {
    $('#lbl-off').textContent = 'حساب الرواتب / الأجور *';
    const sal = findAccHint(ACCOUNTS, ['راتب', 'أجور']);
    if (sal) $('#v-off').value = sal.id;
  } else if (k === 'receipt') {
    $('#lbl-off').textContent = 'حساب العملاء (المقابل الدائن) *';
  } else {
    $('#lbl-off').textContent = 'حساب الموردين / المصروف (المقابل المدين) *';
  }
}

function fillInvoices() {
  const pid = $('#v-party').value;
  const kind = $('#v-kind').value === 'receipt' ? 'sale' : 'purchase';
  const invs = EXT.invoices().filter(i => i.status === 'posted' && i.kind === kind && (!pid || i.party_id === pid) && EXT.invoiceRemain(i) > 0);
  $('#v-inv').innerHTML = '<option value="">— بدون ربط —</option>' + invs.map(i =>
    `<option value="${esc(i.id)}">${esc(i.no)} — متبقي ${fmt(EXT.invoiceRemain(i))}</option>`
  ).join('');
}

function buildToolbar() {
  let html = '';
  if (APP.canWrite()) {
    html += `<button class="btn btn-gold btn-sm" onclick="newV('receipt')">➕ سند قبض</button>`;
    html += `<button class="btn btn-teal btn-sm" onclick="newV('payment')">➖ سند صرف</button>`;
    html += `<button class="btn btn-dark btn-sm" onclick="newV('salary')">👤 صرف راتب</button>`;
  }
  html += `<button class="btn btn-dark btn-sm" onclick="doExport()">📊 تصدير Excel</button>`;
  $('#toolbar').innerHTML = html;
}

function newV(kind) {
  editingId = null;
  $('#v-title').textContent = 'سند ' + VKIND[kind];
  $('#v-kind').value = kind;
  $('#v-date').value = todayISO();
  $('#v-amt').value = '';
  $('#v-desc').value = '';
  onVKind();
  const cash = findAccHint(ACCOUNTS, ['صندوق', 'نقد', 'بنك', '110']);
  if (cash) $('#v-cash').value = cash.id;
  openModal('vModal');
}

function editV(id) {
  const v = EXT.voucher(id);
  if (!v) return;
  editingId = id;
  $('#v-title').textContent = 'تعديل ' + v.no;
  $('#v-kind').value = v.kind;
  $('#v-date').value = v.date;
  $('#v-region').value = v.region || '';
  $('#v-amt').value = v.amount;
  $('#v-desc').value = v.description || '';
  $('#v-cash').value = v.cash_account_id || '';
  $('#v-off').value = v.offset_account_id || '';
  onVKind();
  $('#v-party').value = v.party_id || '';
  fillInvoices();
  $('#v-inv').value = v.invoice_id || '';
  openModal('vModal');
}

function collectV() {
  return {
    id: editingId || undefined,
    kind: $('#v-kind').value,
    date: $('#v-date').value,
    region: $('#v-region').value,
    party_id: $('#v-party').value || '',
    amount: parseFloat($('#v-amt').value || 0),
    invoice_id: $('#v-inv').value || '',
    cash_account_id: $('#v-cash').value,
    offset_account_id: $('#v-off').value,
    description: $('#v-desc').value.trim(),
  };
}

async function saveV(status) {
  try {
    const v = collectV();
    if (!v.cash_account_id || !v.offset_account_id) return toast('اختر حساب الصندوق والحساب المقابل', 'err');
    if (v.cash_account_id === v.offset_account_id) return toast('الحسابان يجب أن يختلفا', 'err');
    v.status = 'draft';
    const saved = await EXT.saveVoucher(v);
    if (status === 'posted') await postV(saved.id, true);
    else toast('تم حفظ المسودة في قاعدة البيانات');
    closeModal('vModal');
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function postV(id, silent) {
  const v = EXT.voucher(id);
  if (!v) return;
  if (v.status === 'posted') return toast('مرحل بالفعل', 'err');
  if (!silent && !await confirmDlg('ترحيل السند كقيد يومية؟')) return;
  try {
    const party = EXT.party(v.party_id);
    const desc = 'سند ' + (VKIND[v.kind] || v.kind) + ' ' + v.no
      + (party ? ' — ' + party.name : '') + (v.description ? ' — ' + v.description : '');
    await postExtJournal({
      movement_no: v.no,
      entry_date: v.date,
      region: v.region || (APP.regions[0] || ''),
      description: desc,
      entry_type: 'عادي',
      status: 'posted',
      lines: voucherJournalLines(v),
    });
    await EXT.markVoucher(id, { status: 'posted', journal_mv: v.no });
    if (v.kind === 'salary') await syncHrSalaries();
    toast('تم ترحيل السند وحفظه في قاعدة البيانات ✔');
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function syncHrSalaries() {
  if (typeof HR === 'undefined' || !HR.syncSalaryVouchers) return;
  try { await HR.syncSalaryVouchers(EXT.vouchers(), EXT.parties(), { fresh: true }); }
  catch (e) { toast('تعذر تحديث سجل الرواتب في شؤون الموظفين: ' + errMsg(e), 'err'); }
}

async function delV(id) {
  const v = EXT.voucher(id);
  if (!v) return;
  if (v.status === 'posted') {
    if (!await confirmDlg('إلغاء حالة الترحيل؟ احذف قيد اليومية المقابل من دفتر اليومية إن لزم.')) return;
    await EXT.markVoucher(id, { status: 'draft' });
    toast('أُلغيت حالة الترحيل — راجع قيد ' + (v.journal_mv || v.no));
  } else {
    if (!await confirmDlg('حذف المسودة؟')) return;
    await EXT.deleteVoucher(id);
    toast('تم الحذف');
  }
  // أزل الراتب فوراً من سجل الموارد البشرية (وكشف الموظف المطبوع) — لا تنتظر فتح صفحة الموظفين
  if (v.kind === 'salary') await syncHrSalaries();
  renderList();
}

function printV(id) {
  const v = EXT.voucher(id);
  if (!v) return;
  const party = EXT.party(v.party_id);
  const company = APP.settings.company_name || 'النظام المحاسبي';
  const verb = v.kind === 'receipt' ? 'استلمنا من' : 'صرفنا إلى';
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(v.no)}</title>
<style>
  body{margin:0;background:#e8e4da;font-family:Tahoma,sans-serif;color:#1c1a14}
  .sheet{max-width:760px;margin:18px auto;background:#fff;border:1px solid #d8d0be}
  .bar{height:8px;background:linear-gradient(90deg,#b9862b,#e8c56a,#b9862b)}
  .pad{padding:22px 28px}
  h1{margin:0;color:#8a6416;font-size:22px}
  .badge{float:left;border:2px solid #c9a24a;padding:8px 12px;text-align:left}
  .row{margin:8px 0;font-size:15px}
  .amt{font-size:22px;color:#8a6416;font-weight:800}
  .words{background:#f4efe3;border:1px dashed #c9a24a;padding:10px 14px;margin-top:12px}
  .sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;margin-top:28px;font-size:13px}
  .line{border-top:1px solid #333;margin:40px 8px 8px}
  @media print{body{background:#fff}.sheet{margin:0;border:none}}
</style></head><body><div class="sheet"><div class="bar"></div><div class="pad">
  <div class="badge"><b>سند ${VKIND[v.kind]}</b><br>${esc(v.no)}<br>${fmtDate(v.date)}</div>
  <h1>${esc(company)}</h1>
  <p style="color:#6b6456;margin-top:4px">العملة: الجنيه المصري — المنطقة: ${esc(v.region || '—')}</p>
  <div style="clear:both"></div>
  <div class="row">${verb}: <b>${esc(party ? party.name : '—')}</b></div>
  <div class="row">المبلغ: <span class="amt">${money(v.amount)}</span></div>
  <div class="words">${esc(tafqeet(v.amount))}</div>
  <div class="row">وذلك عن: ${esc(v.description || '—')}</div>
  ${v.journal_mv ? `<div class="row">قيد اليومية: ${esc(v.journal_mv)}</div>` : ''}
  <div class="sigs">
    <div><div class="line"></div>المحاسب<br>محمد احمد</div>
    <div><div class="line"></div>${v.kind === 'receipt' ? 'المستلم' : 'المستفيد'}</div>
    <div><div class="line"></div>يعتمد</div>
  </div>
</div></div>
<script>window.print()<\/script></body></html>`);
  w.document.close();
}

function renderList() {
  const kind = $('#flt-kind').value;
  const st = $('#flt-status').value;
  const q = ($('#flt-q').value || '').trim();
  let list = EXT.vouchers().slice().sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  if (kind) list = list.filter(x => x.kind === kind);
  if (st) list = list.filter(x => x.status === st);
  if (q) list = list.filter(x => (x.no + ' ' + (x.description || '')).includes(q));
  const tb = $('#v-body');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="big">💵</div>لا توجد سندات</td></tr>';
    return;
  }
  const can = APP.canWrite();
  tb.innerHTML = list.map(v => {
    const p = EXT.party(v.party_id);
    const badge = v.kind === 'receipt' ? 'posted' : v.kind === 'salary' ? 'gray' : 'draft';
    return `<tr>
      <td class="num">${esc(v.no)}</td>
      <td class="num">${fmtDate(v.date)}</td>
      <td><span class="badge ${badge}">${VKIND[v.kind]}</span></td>
      <td>${esc(p ? p.name : '—')}</td>
      <td>${esc(v.description || '—')}</td>
      <td class="num">${fmt(v.amount)}</td>
      <td class="num">${v.status === 'posted' ? '<span class="badge posted">مرحل</span>' : '<span class="badge draft">مسودة</span>'}</td>
      <td class="num">${can ? `<div class="j-actions">
        <button class="btn btn-sm btn-dark act-btn" onclick="editV('${v.id}')">✏️</button>
        ${v.status === 'draft' ? `<button class="btn btn-sm btn-green act-btn" onclick="postV('${v.id}')">✔</button>` : ''}
        <button class="btn btn-sm btn-gold act-btn" onclick="printV('${v.id}')">🖨️</button>
        <button class="btn btn-sm btn-red act-btn" onclick="delV('${v.id}')">🗑️</button>
      </div>` : ''}</td>
    </tr>`;
  }).join('');
}

function doExport() {
  const rows = [['الرقم', 'التاريخ', 'النوع', 'الطرف', 'البيان', 'المبلغ', 'الحالة']];
  EXT.vouchers().forEach(v => {
    const p = EXT.party(v.party_id);
    rows.push([v.no, v.date, VKIND[v.kind], p ? p.name : '', v.description || '', v.amount, v.status === 'posted' ? 'مرحل' : 'مسودة']);
  });
  exportExcel('السندات.xlsx', 'السندات', rows);
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'v-party') fillInvoices();
});

APP.requireAuth({ activePath: 'vouchers.html' }).then(async () => {
  await EXT.hydrate();
  ACCOUNTS = await DB.accounts();
  $('#v-region').innerHTML = APP.regions.map(r => `<option>${esc(r)}</option>`).join('');
  $('#v-cash').innerHTML = accOptionsHtml(ACCOUNTS);
  $('#v-off').innerHTML = accOptionsHtml(ACCOUNTS);
  buildToolbar();
  renderList();
});
