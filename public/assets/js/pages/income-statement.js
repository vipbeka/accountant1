'use strict';

let LAST_REP = null;
function secRow(label) { return `<tr style="background:var(--line);"><td colspan="3" style="padding:8px 12px;font-weight:700;color:var(--ink)">${esc(label)}</td></tr>`; }
function totRow(label, val) { return `<tr><td colspan="2" style="text-align:center;font-weight:700;background:var(--border)">${esc(label)}</td><td class="num">${val === '' || val == null ? '' : fmt(val)}</td></tr>`; }

async function loadRep() {
  try {
    const d = await DB.incomeStatement($('#flt-from').value, $('#flt-to').value, $('#flt-region').value);
    LAST_REP = d;
    const rows = [];
    rows.push(secRow('أولاً: الإيرادات'));
    d.revenues.forEach(r => rows.push(`<tr><td class="num">${esc(r.acc_no)}</td><td>${esc(r.name)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td></tr>`));
    rows.push(totRow('إجمالي الإيرادات', d.revenues_total));
    rows.push(secRow('ثانياً: المصروفات'));
    d.expenses.forEach(r => rows.push(`<tr><td class="num">${esc(r.acc_no)}</td><td>${esc(r.name)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td></tr>`));
    rows.push(totRow('إجمالي المصروفات', d.expenses_total));
    const netCls = d.net >= 0 ? 'style="color:var(--green);font-weight:700"' : 'style="color:var(--red);font-weight:700"';
    rows.push(`<tr><td colspan="2" style="text-align:center;font-weight:700;background:var(--border)">صافي الدخل / (الخسارة)</td><td class="num" ${netCls}>${fmt(d.net)}</td></tr>`);
    $('#result').innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="num">رقم الحساب</th><th>البيان</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!LAST_REP) return toast('اعرض التقرير أولًا', 'err');
  const rows = [['رقم الحساب', 'البيان', 'المبلغ']];
  rows.push(['', 'الإيرادات', '']);
  LAST_REP.revenues.forEach(r => rows.push([r.acc_no, r.name, r.amount]));
  rows.push(['', 'إجمالي الإيرادات', LAST_REP.revenues_total]);
  rows.push(['', 'المصروفات', '']);
  LAST_REP.expenses.forEach(r => rows.push([r.acc_no, r.name, r.amount]));
  rows.push(['', 'إجمالي المصروفات', LAST_REP.expenses_total]);
  rows.push(['', 'صافي الدخل', LAST_REP.net]);
  exportExcel('قائمة الدخل.xlsx', 'قائمة الدخل', rows);
}

APP.requireAuth({ activePath: 'income-statement.html' }).then(() => {
  $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' + APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#flt-from').value = APP.settings.period_from;
  $('#flt-to').value = APP.settings.period_to;
  loadRep();
});
