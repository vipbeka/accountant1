'use strict';

function daysBetween(iso) {
  const a = new Date(String(iso).slice(0, 10));
  const b = new Date(todayISO());
  return Math.max(0, Math.round((b - a) / 86400000));
}

function agingRows() {
  return EXT.invoices()
    .filter(i => i.status === 'posted' && i.kind === 'sale' && EXT.invoiceRemain(i) > 0)
    .map(i => {
      const p = EXT.party(i.party_id);
      return { party: p ? p.name : '—', no: i.no, date: i.date, remain: EXT.invoiceRemain(i), days: daysBetween(i.date) };
    })
    .sort((a, b) => b.days - a.days);
}

function exportAging() {
  const rows = [['العميل', 'الفاتورة', 'التاريخ', 'المتبقي', 'الأيام']];
  agingRows().forEach(r => rows.push([r.party, r.no, r.date, r.remain, r.days]));
  exportExcel('أعمار-الديون.xlsx', 'الأعمار', rows);
}

APP.requireAuth({ activePath: 'reports.html' }).then(async () => {
  await EXT.hydrate();
  const invs = EXT.invoices().filter(i => i.status === 'posted');
  const sales = invs.filter(i => i.kind === 'sale');
  const purch = invs.filter(i => i.kind === 'purchase');
  const rec = EXT.vouchers().filter(v => v.status === 'posted' && v.kind === 'receipt');
  const pay = EXT.vouchers().filter(v => v.status === 'posted' && v.kind !== 'receipt');
  const ar = round2(sales.reduce((s, i) => s + EXT.invoiceRemain(i), 0));
  const ap = round2(purch.reduce((s, i) => s + EXT.invoiceRemain(i), 0));

  $('#rep-cards').innerHTML = `
    <div class="card"><div class="lbl">مبيعات مرحلة</div><div class="val gold">${fmt(sales.reduce((s, i) => s + i.total, 0))}</div></div>
    <div class="card teal"><div class="lbl">مشتريات مرحلة</div><div class="val teal">${fmt(purch.reduce((s, i) => s + i.total, 0))}</div></div>
    <div class="card green"><div class="lbl">سندات قبض</div><div class="val green">${fmt(rec.reduce((s, v) => s + v.amount, 0))}</div></div>
    <div class="card red"><div class="lbl">سندات صرف</div><div class="val red">${fmt(pay.reduce((s, v) => s + v.amount, 0))}</div></div>
    <div class="card"><div class="lbl">ذمم عملاء متبقية</div><div class="val gold">${fmt(ar)}</div></div>
    <div class="card red"><div class="lbl">ذمم موردين متبقية</div><div class="val red">${fmt(ap)}</div></div>`;

  const aging = agingRows();
  const ab = $('#aging-body');
  ab.innerHTML = aging.length ? aging.map(r => `<tr>
    <td>${esc(r.party)}</td><td class="num">${esc(r.no)}</td><td class="num">${fmtDate(r.date)}</td>
    <td class="num">${fmt(r.remain)}</td>
    <td class="num">${r.days > 30 ? '<span class="badge draft">' + r.days + '</span>' : r.days}</td>
  </tr>`).join('') : '<tr><td colspan="5" class="empty-state">لا توجد ذمم مفتوحة</td></tr>';

  const taxS = round2(sales.reduce((s, i) => s + Number(i.tax || 0), 0));
  const taxP = round2(purch.reduce((s, i) => s + Number(i.tax || 0), 0));
  $('#tax-box').innerHTML = `<p>ضريبة المخرجات (مبيعات): <b style="color:var(--gold)">${fmt(taxS)}</b></p>
    <p>ضريبة المدخلات (مشتريات): <b style="color:var(--teal)">${fmt(taxP)}</b></p>
    <p>الصافي المستحق: <b style="color:var(--green)">${fmt(taxS - taxP)}</b></p>`;
  $('#tax-body').innerHTML = `
    <tr><td>مبيعات</td><td class="num">${fmt(sales.reduce((s, i) => s + i.subtotal, 0))}</td><td class="num">${fmt(taxS)}</td><td class="num">${fmt(sales.reduce((s, i) => s + i.total, 0))}</td></tr>
    <tr><td>مشتريات</td><td class="num">${fmt(purch.reduce((s, i) => s + i.subtotal, 0))}</td><td class="num">${fmt(taxP)}</td><td class="num">${fmt(purch.reduce((s, i) => s + i.total, 0))}</td></tr>`;
});
