'use strict';

let ACCOUNTS = [], editingId = null;

function onKindChange() {
  const sale = $('#i-kind').value === 'sale';
  $('#lbl-party-acc').textContent = sale ? 'حساب العملاء (مدينون) *' : 'حساب الموردين (دائنون) *';
  $('#lbl-income-acc').textContent = sale ? 'حساب المبيعات / الإيراد *' : 'حساب المبيعات (اختياري)';
  fillPartySelect();
}

function fillPartySelect() {
  const kind = $('#i-kind').value === 'purchase' ? 'vendor' : 'customer';
  const cur = $('#i-party').value;
  $('#i-party').innerHTML = partyOptionsHtml(kind, cur);
}

function addInvLine(itemNo = '', sku = '', desc = '', qty = 1, price = '', unit = 'PCS') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="ln-no num" value="${esc(itemNo)}" placeholder="17"></td>
    <td><input class="ln-sku" value="${esc(sku)}" placeholder="كود الصنف"></td>
    <td><input class="ln-desc" value="${esc(desc)}" placeholder="وصف البند"></td>
    <td><input class="ln-qty num" type="number" step="0.01" min="0" value="${qty}"></td>
    <td><input class="ln-price num" type="number" step="0.01" min="0" value="${price}"></td>
    <td class="num ln-amt">0.00</td>
    <td><button class="line-del" type="button" onclick="this.closest('tr').remove();recalcInv()">🗑️</button></td>`;
  $('#i-lines').appendChild(tr);
  recalcInv();
}

function recalcInv() {
  let sub = 0;
  $$('#i-lines tr').forEach(tr => {
    const q = parseFloat($('.ln-qty', tr).value || 0);
    const p = parseFloat($('.ln-price', tr).value || 0);
    const a = round2(q * p);
    sub += a;
    $('.ln-amt', tr).textContent = fmt(a);
  });
  const pct = parseFloat($('#i-taxpct').value || 0);
  const tax = round2(sub * pct / 100);
  $('#i-sub').textContent = fmt(sub);
  $('#i-tax').textContent = fmt(tax);
  $('#i-total').textContent = fmt(sub + tax);
  const qty = $$('#i-lines tr').reduce((sum, tr) => sum + Number($('.ln-qty', tr).value || 0), 0);
  const qel = document.getElementById('i-qty-total'); if (qel) qel.textContent = fmt(qty);
}

document.addEventListener('input', e => {
  if (e.target.closest('#i-lines') || e.target.id === 'i-taxpct') recalcInv();
});

function buildToolbar() {
  let html = '';
  if (APP.canWrite()) html += `<button class="btn btn-gold btn-sm" onclick="newInv()">➕ فاتورة جديدة</button>`;
  html += `<button class="btn btn-dark btn-sm" onclick="doExport()">📊 تصدير Excel</button>`;
  $('#toolbar').innerHTML = html;
}

function collectInv() {
  return {
    id: editingId || undefined,
    kind: $('#i-kind').value,
    date: $('#i-date').value,
    region: $('#i-region').value,
    party_id: $('#i-party').value || '',
    no: $('#i-no').value.trim(),
    tax_pct: parseFloat($('#i-taxpct').value || 0),
    description: $('#i-desc').value.trim(),
    party_account_id: $('#i-party-acc').value,
    income_account_id: $('#i-income-acc').value,
    expense_account_id: $('#i-exp-acc').value,
    tax_account_id: $('#i-tax-acc').value,
    status: $('#i-status').value,
    po_no: $('#i-po-no').value.trim(), po_date: $('#i-po-date').value, currency: $('#i-currency').value.trim() || 'USD',
    incoterm: $('#i-incoterm').value.trim(), pol: $('#i-pol').value.trim(), pod: $('#i-pod').value.trim(),
    origin: $('#i-origin').value.trim(), hs_code: $('#i-hs').value.trim(), bank_details: $('#i-bank').value.trim(),
    lines: $$('#i-lines tr').map(tr => ({ item_no: $('.ln-no', tr).value, sku: $('.ln-sku', tr).value, desc: $('.ln-desc', tr).value, qty: $('.ln-qty', tr).value, price: $('.ln-price', tr).value, unit: 'PCS' })),
  };
}

function newInv() {
  editingId = null;
  $('#inv-title').textContent = 'فاتورة جديدة';
  $('#i-kind').value = 'sale';
  $('#i-date').value = todayISO();
  $('#i-no').value = '';
  $('#i-status').value = 'draft'; $('#i-po-no').value = ''; $('#i-po-date').value = ''; $('#i-currency').value = 'USD'; $('#i-incoterm').value = 'FOB'; $('#i-pol').value = ''; $('#i-pod').value = ''; $('#i-origin').value = ''; $('#i-hs').value = ''; $('#i-bank').value = '';
  $('#i-desc').value = '';
  $('#i-taxpct').value = '0';
  $('#i-lines').innerHTML = '';
  addInvLine();
  onKindChange();
  const ar = findAccHint(ACCOUNTS, ['عملاء', 'مدينون', '120']);
  const ap = findAccHint(ACCOUNTS, ['مورد', 'دائنون', '210']);
  const rev = findAccHint(ACCOUNTS, ['مبيعات', 'إيراد']);
  const pur = findAccHint(ACCOUNTS, ['مشتريات', 'تكلفة']);
  const vat = findAccHint(ACCOUNTS, ['ضريبة', 'قيمة مضافة']);
  if (ar) $('#i-party-acc').value = ar.id;
  if (rev) $('#i-income-acc').value = rev.id;
  if (pur) $('#i-exp-acc').value = pur.id;
  if (vat) $('#i-tax-acc').value = vat.id;
  openModal('invModal');
}

function editInv(id) {
  const inv = EXT.invoice(id);
  if (!inv) return toast('الفاتورة غير موجودة', 'err');
  editingId = id;
  $('#inv-title').textContent = 'تعديل الفاتورة ' + inv.no;
  $('#i-kind').value = inv.kind;
  $('#i-date').value = inv.date;
  $('#i-region').value = inv.region || '';
  $('#i-no').value = inv.no;
  $('#i-desc').value = inv.description || '';
  $('#i-taxpct').value = inv.tax_pct || 0;
  $('#i-party-acc').value = inv.party_account_id || '';
  $('#i-income-acc').value = inv.income_account_id || '';
  $('#i-exp-acc').value = inv.expense_account_id || '';
  $('#i-tax-acc').value = inv.tax_account_id || '';
  onKindChange();
  $('#i-party').value = inv.party_id || '';
  $('#i-lines').innerHTML = '';
  $('#i-status').value = inv.status || 'draft'; $('#i-po-no').value = inv.po_no || ''; $('#i-po-date').value = inv.po_date || ''; $('#i-currency').value = inv.currency || 'USD'; $('#i-incoterm').value = inv.incoterm || ''; $('#i-pol').value = inv.pol || ''; $('#i-pod').value = inv.pod || ''; $('#i-origin').value = inv.origin || ''; $('#i-hs').value = inv.hs_code || ''; $('#i-bank').value = inv.bank_details || '';
  (inv.lines || []).forEach(l => addInvLine(l.item_no, l.sku, l.desc, l.qty, l.price, l.unit));
  if (!(inv.lines || []).length) addInvLine();
  recalcInv();
  openModal('invModal');
}

async function saveInv(status) {
  try {
    const inv = collectInv();
    if (!inv.party_account_id) return toast('اختر حساب الطرف (عملاء/موردين)', 'err');
    if (inv.kind === 'sale' && !inv.income_account_id) return toast('اختر حساب المبيعات', 'err');
    if (inv.kind === 'purchase' && !inv.expense_account_id) return toast('اختر حساب المشتريات', 'err');
    inv.status = status;
    const saved = await EXT.saveInvoice(inv);
    if (status === 'posted') await postInv(saved.id, true);
    else toast('تم حفظ المسودة في قاعدة البيانات');
    closeModal('invModal');
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function postInv(id, silent) {
  let inv = EXT.invoice(id);
  if (!inv) return toast('غير موجودة', 'err');
  if (inv.status === 'posted') return toast('مرحلة بالفعل', 'err');
  if (!silent && !await confirmDlg('ترحيل الفاتورة كقيد يومية؟ سيظهر في الميزان والتقارير.')) return;
  try {
    if (round2(inv.tax) > 0 && !inv.tax_account_id) {
      const vat = await ensureVatAccount(inv.kind);
      inv = await EXT.markInvoice(id, { tax_account_id: vat.id });
    }
    const mv = inv.no;
    const party = EXT.party(inv.party_id);
    const desc = (inv.kind === 'sale' ? 'فاتورة مبيعات ' : 'فاتورة مشتريات ') + inv.no
      + (party ? ' — ' + party.name : '') + (inv.description ? ' — ' + inv.description : '');
    await postExtJournal({
      movement_no: mv,
      entry_date: inv.date,
      region: inv.region || (APP.regions[0] || ''),
      description: desc,
      entry_type: 'عادي',
      status: 'posted',
      lines: invoiceJournalLines(inv),
    });
    await EXT.markInvoice(id, { status: 'posted', journal_mv: mv });
    toast('تم ترحيل الفاتورة وحفظها في قاعدة البيانات ✔');
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function voidInv(id) {
  const inv = EXT.invoice(id);
  if (!inv) return;
  if (inv.status === 'posted') {
    if (!await confirmDlg('إلغاء ترحيل الفاتورة؟ احذف قيد اليومية المقابل يدويًا من دفتر اليومية إن لزم.')) return;
  } else if (!await confirmDlg('حذف المسودة؟')) return;
  try {
    if (inv.status === 'posted') {
      await EXT.markInvoice(id, { status: 'draft' });
      toast('أُلغيت حالة الترحيل — راجع قيد ' + (inv.journal_mv || inv.no) + ' في دفتر اليومية');
    } else {
      await EXT.deleteInvoice(id);
      toast('تم الحذف');
    }
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function printInv(id) {
  try {
    const inv = EXT.invoice(id); if (!inv) return;
    const party = EXT.party(inv.party_id);
    const company = (APP.settings && APP.settings.company_name) || 'ZINTRA';
    const currency = String(inv.currency || 'USD').trim().toUpperCase();
    const status = inv.status === 'posted' ? 'مرحّلة' : inv.status === 'approved' ? 'معتمدة' : 'مسودة';
    const rows = (inv.lines || []).map((l, i) => `<tr><td>${esc(l.item_no || i + 1)}</td><td><b>${esc(l.sku || '')}</b></td><td>${esc(l.desc)}</td><td>${esc(l.unit || 'PCS')}</td><td class="num">${fmt(l.qty)}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(l.amount)}</td></tr>`).join('');
    const sigs = ((APP.settings && APP.settings.signatures) || []).map(x => `<div class="sig"><div class="line"></div><b>${esc(x.title || '')}</b><div>${esc(x.name || '')}</div></div>`).join('') || '<div class="sig"><div class="line"></div><b>Prepared by</b><div></div></div><div class="sig"><div class="line"></div><b>Approved by</b><div></div></div><div class="sig"><div class="line"></div><b>Stamp</b><div></div></div>';
    const bank = inv.bank_details || APP.settings.bank_details || '—';
    showDoc(`<style>
      .zintra{font-family:Arial,Tahoma,sans-serif;color:#18212b;background:#fff;max-width:980px;margin:auto}.zintra .top{height:10px;background:linear-gradient(90deg,#101820,#1f9d8b,#d3a84c)}.zintra .head{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 34px 18px;border-bottom:2px solid #1f9d8b}.zintra .brand h1{margin:0;font-size:32px;letter-spacing:5px;color:#102a43}.zintra .brand small{color:#667085}.zintra .badge{border:1px solid #d7dee5;border-radius:12px;padding:12px 16px;text-align:left;background:#f8fafb}.zintra .badge b{display:block;color:#1f9d8b;font-size:16px;margin-bottom:6px}.zintra .meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 34px}.zintra .box{border:1px solid #e1e7ec;border-radius:10px;padding:13px 16px;line-height:1.65}.zintra .box h3{margin:0 0 8px;color:#1f9d8b;font-size:14px}.zintra .box p{margin:2px 0;font-size:12px}.zintra table{width:calc(100% - 68px);margin:0 34px;border-collapse:collapse;font-size:11px}.zintra th{background:#102a43;color:white;padding:10px 7px;text-align:right}.zintra td{border-bottom:1px solid #e6ebef;padding:9px 7px;vertical-align:top}.zintra tbody tr:nth-child(even){background:#f7fafb}.zintra .totals{margin:18px 34px 0 auto;width:330px}.zintra .totals div{display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid #e4e8ec}.zintra .totals .grand{font-size:16px;background:#eaf7f4;color:#102a43;border:2px solid #1f9d8b}.zintra .words{margin:16px 34px;padding:12px;background:#fff8e6;border:1px dashed #d3a84c;border-radius:8px}.zintra .notes{margin:14px 34px;font-size:12px;white-space:pre-line}.zintra .sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;margin:45px 34px 24px;text-align:center;font-size:12px}.zintra .line{border-top:1px solid #334155;margin:28px 10px 7px}.zintra .foot{border-top:1px solid #dfe5ea;padding:12px 34px;color:#667085;font-size:10px;display:flex;justify-content:space-between}@media print{.zintra{max-width:none}.zintra thead{display:table-header-group}.zintra tr{page-break-inside:avoid}}
    </style><div class="zintra"><div class="top"></div><div class="head"><div class="brand"><h1>${esc(company)}</h1><small>Commercial Invoice · Professional Edition</small></div><div class="badge"><b>${status}</b>Invoice No: ${esc(inv.no)}<br>Date: ${fmtDate(inv.date)}<br>Currency: ${esc(currency)}<br>Incoterm: ${esc(inv.incoterm || '—')}</div></div><div class="meta"><div class="box"><h3>Seller / Company</h3><p><b>${esc(company)}</b></p><p>Tax No: ${esc(APP.settings.tax_no || '—')}</p><p>Commercial Register: ${esc(APP.settings.commercial_reg || '—')}</p><p>${esc(APP.settings.company_address || '—')}</p></div><div class="box"><h3>Buyer / Consignee</h3><p><b>${esc(party ? party.name : '—')}</b></p><p>${esc(party && party.address || '—')}</p><p>Tax No: ${esc(party && party.tax_no || '—')}</p><p>Phone: ${esc(party && party.phone || '—')}</p></div></div><div class="meta"><div class="box"><h3>Order & Shipment</h3><p>Purchase Order: ${esc(inv.po_no || '—')} &nbsp; Date: ${esc(inv.po_date || '—')}</p><p>Port of Loading: ${esc(inv.pol || '—')}</p><p>Port of Discharge: ${esc(inv.pod || '—')}</p><p>Country / HS Code: ${esc(inv.origin || '—')} / ${esc(inv.hs_code || '—')}</p></div><div class="box"><h3>Bank Details</h3><p>${esc(bank)}</p></div></div><table><thead><tr><th>No.</th><th>Item No.</th><th>Description</th><th>Unit</th><th>Initial Counter / Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Total Quantity</span><b>${fmt((inv.lines || []).reduce((a,l)=>a+Number(l.qty||0),0))}</b></div><div><span>Subtotal</span><b>${currency} ${money(inv.subtotal, currency)}</b></div><div><span>Tax ${esc(String(inv.tax_pct || 0))}%</span><b>${currency} ${money(inv.tax, currency)}</b></div><div class="grand"><span>Grand Total</span><b>${currency} ${money(inv.total, currency)}</b></div></div><div class="words">Amount in words: ${esc(tafqeet(inv.total, currency))}</div>${inv.description ? `<div class="notes"><b>Notes:</b> ${esc(inv.description)}</div>` : ''}<div class="sigs">${sigs}</div><div class="foot"><span>${esc(company)}</span><span>Commercial Invoice · ${esc(inv.no)}</span><span>${esc(APP.settings.company_address || '')}</span></div></div>`);
  } catch (e) { toast(errMsg(e), 'err'); }
}
function renderList() {
  const kind = $('#flt-kind').value;
  const st = $('#flt-status').value;
  const q = ($('#flt-q').value || '').trim();
  let list = EXT.invoices().slice().sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  if (kind) list = list.filter(x => x.kind === kind);
  if (st) list = list.filter(x => x.status === st);
  if (q) list = list.filter(x => (x.no + ' ' + (x.description || '') + ' ' + ((EXT.party(x.party_id) || {}).name || '')).includes(q));
  const tb = $('#inv-body');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="big">🧾</div>لا توجد فواتير</td></tr>';
    return;
  }
  const can = APP.canWrite();
  tb.innerHTML = list.map(inv => {
    const p = EXT.party(inv.party_id);
    const rem = inv.status === 'posted' ? EXT.invoiceRemain(inv) : inv.total;
    return `<tr>
      <td class="num">${esc(inv.no)}</td>
      <td class="num">${fmtDate(inv.date)}</td>
      <td>${inv.kind === 'sale' ? '<span class="badge region">مبيعات</span>' : '<span class="badge gray">مشتريات</span>'}</td>
      <td>${esc(p ? p.name : '—')}</td>
      <td class="num">${fmt(inv.total)}</td>
      <td class="num">${fmt(rem)}</td>
      <td class="num">${inv.status === 'posted' ? '<span class="badge posted">مرحّلة</span>' : inv.status === 'approved' ? '<span class="badge region">معتمدة</span>' : '<span class="badge draft">مسودة</span>'}</td>
      <td class="num">${can ? `<div class="j-actions">
        <button class="btn btn-sm btn-dark act-btn" title="تعديل" onclick="editInv('${inv.id}')">✏️</button>
        ${inv.status !== 'posted' ? `<button class="btn btn-sm btn-green act-btn" title="ترحيل" onclick="postInv('${inv.id}')">✔</button>` : ''}
        <button class="btn btn-sm btn-gold act-btn" title="طباعة" onclick="printInv('${inv.id}')">🖨️</button>
        <button class="btn btn-sm btn-red act-btn" title="حذف / إلغاء" onclick="voidInv('${inv.id}')">🗑️</button>
      </div>` : ''}</td>
    </tr>`;
  }).join('');
}

function doExport() {
  const rows = [['الرقم', 'التاريخ', 'النوع', 'الطرف', 'الصافي', 'الضريبة', 'الإجمالي', 'المتبقي', 'الحالة']];
  EXT.invoices().forEach(inv => {
    const p = EXT.party(inv.party_id);
    rows.push([inv.no, inv.date, inv.kind === 'sale' ? 'مبيعات' : 'مشتريات', p ? p.name : '',
      inv.subtotal, inv.tax, inv.total, EXT.invoiceRemain(inv), inv.status === 'posted' ? 'مرحلة' : 'مسودة']);
  });
  exportExcel('الفواتير.xlsx', 'الفواتير', rows);
}

const OTC_ITEMS = [['1','kryoOTC','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',20,75],['2','CryoOTC','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',12,65],['3','CRYO Penguin','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',25,85],['4','CRYO med','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',30,90],['5','CoolAir','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',25,80],['6','Kryo360','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',30,120],['7','AQUA FREEZ','Device for cryotherapy: Treatment with cold air — Country of Origin: Netherlands',50,75],['8','CAVI-OTC','radiofrequent therapy with radio waves — Country of Origin: Netherlands',22,115],['9','CAVI-OTC PRO','radiofrequent therapy with radio waves — Country of Origin: Netherlands',25,70],['10','CAVI{c}','radiofrequent therapy with radio waves — Country of Origin: Netherlands',100,60],['11','VACUOTC','Vacuum therapy device — Country of Origin: Netherlands',200,6],['12','ULTRA PRO','Combination of treatment with ultrasonic waves (1 and 3 MHz)',30,26],['13','Ultra V','Combination of treatment with ultrasonic waves (1 and 3 MHz)',100,30],['14','ULTRA waves','Electrotherapy with ultrasonic waves (1 and 3 MHz)',20,111],['15','SWOTC','Shockwave therapy with ultrasonic waves (1 and 3 MHz)',100,70],['16','SWOTC PRO','Shockwave therapy with ultrasonic waves (1 and 3 MHz)',50,90]];
async function importOTCInvoice() { newInv(); $('#i-kind').value = 'purchase'; $('#i-no').value = 'OTC20260803'; $('#i-date').value = '2026-08-03'; $('#i-status').value = 'approved'; $('#i-po-no').value = '22022003'; $('#i-po-date').value = '2026-08-03'; $('#i-currency').value = 'USD'; $('#i-incoterm').value = 'FOB'; $('#i-pol').value = 'SHEKOU PORT'; $('#i-pod').value = 'SOKHNA PORT'; $('#i-origin').value = 'Netherlands'; $('#i-hs').value = '9019100020'; $('#i-desc').value = 'MEDICAL SLIMMING MACHINE'; $('#i-taxpct').value = '0'; $('#i-lines').innerHTML = ''; OTC_ITEMS.forEach(x => addInvLine(...x)); onKindChange(); let supplier = EXT.parties().find(p => p.kind === 'vendor' && /trend for trading/i.test(p.name || '')); if (!supplier) supplier = await EXT.saveParty({ kind: 'vendor', name: 'TREND FOR TRADING CO., LIMITED', address: 'Flat/RM A 9/F Silvercorp Int’l Tower, 707-713 Nathan Rd, Mongkok, HK', phone: '008618565189885 - 02088501825', notes: 'Bank: Zhejiang Tailong Commercial Bank | A/C: NRA33080020201000041395 | SWIFT: ZJTLCNBH' }); $('#i-party').value = supplier.id; const ap=findAccHint(ACCOUNTS,['مورد','دائنون','210']); const pur=findAccHint(ACCOUNTS,['مشتريات','تكلفة']); if(ap) $('#i-party-acc').value=ap.id; if(pur) $('#i-exp-acc').value=pur.id; recalcInv(); }

APP.requireAuth({ activePath: 'invoices.html' }).then(async () => {
  await EXT.hydrate();
  ACCOUNTS = await DB.accounts();
  $('#i-region').innerHTML = APP.regions.map(r => `<option>${esc(r)}</option>`).join('');
  $('#i-party-acc').innerHTML = accOptionsHtml(ACCOUNTS);
  $('#i-income-acc').innerHTML = accOptionsHtml(ACCOUNTS);
  $('#i-exp-acc').innerHTML = accOptionsHtml(ACCOUNTS);
  $('#i-tax-acc').innerHTML = accOptionsHtml(ACCOUNTS);
  buildToolbar();
  renderList();
});
