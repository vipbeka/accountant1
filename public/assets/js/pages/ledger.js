'use strict';

let LAST_LEDGER = null;

async function init() {
  try {
    const accounts = await DB.accounts();
    $('#flt-acc').innerHTML = '<option value="">— اختر الحساب —</option>' +
      accounts.map(a => `<option value="${esc(a.acc_no)}">${esc(a.acc_no)} - ${esc(a.name)}</option>`).join('');
    $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' + APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    $('#flt-from').value = APP.settings.period_from;
    $('#flt-to').value = APP.settings.period_to;
    loadLedger();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function loadLedger() {
  const accNo = $('#flt-acc').value.trim();
  const box = $('#result');
  if (!accNo) {
    box.innerHTML = '<div class="empty-state"><div class="big">📖</div>اختر رقم الحساب ثم اضغط «عرض الكشف»</div>';
    LAST_LEDGER = null;
    return;
  }
  try {
    const d = await DB.ledger(accNo, $('#flt-from').value, $('#flt-to').value, $('#flt-region').value);
    LAST_LEDGER = d;
    let rowsHtml;
    if (!d.rows.length) {
      rowsHtml = '<tr><td colspan="7" class="empty-state">لا توجد حركات في هذه الفترة</td></tr>';
    } else {
      rowsHtml = d.rows.map(r => `
        <tr>
          <td class="num">${fmtDate(r.date)}</td><td class="num">${esc(r.movement_no)}</td>
          <td>${esc(r.description || '—')}</td><td><span class="badge region">${esc(r.region)}</span></td>
          <td class="num" style="color:var(--green)">${r.debit ? fmt(r.debit) : ''}</td>
          <td class="num" style="color:var(--red)">${r.credit ? fmt(r.credit) : ''}</td>
          <td class="num" style="font-weight:700">${fmt(r.balance)}</td>
        </tr>`).join('');
    }
    const balColor = d.totals.balance >= 0 ? 'var(--green)' : 'var(--red)';
    box.innerHTML = `
      <div class="cards-grid" style="margin:20px">
        <div class="card"><div class="lbl">الحساب</div><div class="val gold" style="font-size:18px">${esc(d.account.name)}</div></div>
        <div class="card teal"><div class="lbl">رقم الحساب</div><div class="val teal" style="font-size:18px;direction:ltr">${esc(d.account.acc_no)}</div></div>
        <div class="card green"><div class="lbl">الرصيد الافتتاحي</div><div class="val green" style="font-size:18px">${fmt(d.opening)}</div></div>
        <div class="card"><div class="lbl">الرصيد النهائي</div><div class="val" style="font-size:18px;color:${balColor}">${fmt(d.totals.balance)}</div></div>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="num">التاريخ</th><th class="num">رقم الحركة</th><th>البيان</th><th>المنطقة</th>
          <th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="4" style="text-align:center">إجمالي الحركة${d.opening ? ` (بدون الرصيد الافتتاحي ${fmt(d.opening)})` : ''}</td>
          <td class="num">${fmt(d.totals.debit)}</td><td class="num">${fmt(d.totals.credit)}</td>
          <td class="num" style="color:${balColor}">${fmt(d.totals.balance)}</td>
        </tr></tfoot>
      </table></div>`;
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!LAST_LEDGER) return toast('اختر الحساب واعرض الكشف أولًا', 'err');
  const rows = [['التاريخ', 'رقم الحركة', 'البيان', 'المنطقة', 'مدين', 'دائن', 'الرصيد']];
  rows.push(['', '', 'رصيد افتتاحي', '', '', '', LAST_LEDGER.opening]);
  LAST_LEDGER.rows.forEach(r => rows.push([r.date, r.movement_no, r.description || '', r.region, r.debit || '', r.credit || '', r.balance]));
  exportExcel(`كشف حساب ${LAST_LEDGER.account.acc_no}.xlsx`, 'كشف الحساب', rows);
}

APP.requireAuth({ activePath: 'ledger.html' }).then(init);
