'use strict';

let LAST_BS = null;
function secRow(label) { return `<tr style="background:var(--line);"><td colspan="3" style="padding:8px 12px;font-weight:700;color:var(--ink)">${esc(label)}</td></tr>`; }
function totRow(label, val) { return `<tr><td colspan="2" style="text-align:center;font-weight:700;background:var(--border)">${esc(label)}</td><td class="num">${val === '' || val == null ? '' : fmt(val)}</td></tr>`; }

async function loadRep() {
  try {
    const d = await DB.balanceSheet($('#flt-from').value, $('#flt-to').value, $('#flt-region').value);
    LAST_BS = d;
    const rows = [];
    rows.push(secRow('أولاً: الموجودات (الأصول)'));
    d.assets.forEach(r => rows.push(`<tr><td class="num">${esc(r.acc_no)}</td><td>${esc(r.name)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td></tr>`));
    rows.push(totRow('إجمالي الموجودات', d.assets_total));
    rows.push(secRow('ثانياً: الالتزامات وحقوق الملكية'));
    d.liabilities_equity.forEach(r => rows.push(`<tr><td class="num">${esc(r.acc_no)}</td><td>${esc(r.name)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td></tr>`));
    rows.push(totRow('إجمالي الالتزامات وحقوق الملكية (بدون الأرباح)', d.liab_equity_total));
    rows.push(totRow('الأرباح / (الخسائر) المتراكمة', d.net_cumulative));
    rows.push(totRow('إجمالي الالتزامات وحقوق الملكية (بعد الأرباح المتراكمة)', d.total_with_income));

    const badge = d.balanced
      ? '<span class="balance-pill ok">✔ المركز المالي متوازن — الموجودات = الالتزامات + حقوق الملكية</span>'
      : `<span class="balance-pill bad">✖ المركز المالي غير متوازن (فرق: ${fmt(d.difference)})</span>`;

    $('#result').innerHTML = `<div style="padding:18px 20px;display:flex;gap:14px;align-items:center;border-bottom:1px solid var(--border)">${badge}</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="num">رقم الحساب</th><th>البيان</th><th class="num">المبلغ</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>`;
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!LAST_BS) return toast('اعرض التقرير أولًا', 'err');
  const rows = [['رقم الحساب', 'البيان', 'المبلغ']];
  rows.push(['', 'الموجودات', '']);
  LAST_BS.assets.forEach(r => rows.push([r.acc_no, r.name, r.amount]));
  rows.push(['', 'إجمالي الموجودات', LAST_BS.assets_total]);
  rows.push(['', 'الالتزامات وحقوق الملكية', '']);
  LAST_BS.liabilities_equity.forEach(r => rows.push([r.acc_no, r.name, r.amount]));
  rows.push(['', 'إجمالي الالتزامات وحقوق الملكية', LAST_BS.liab_equity_total]);
  rows.push(['', 'الأرباح المتراكمة', LAST_BS.net_cumulative]);
  rows.push(['', 'الإجمالي بعد الأرباح', LAST_BS.total_with_income]);
  exportExcel('المركز المالي.xlsx', 'المركز المالي', rows);
}

APP.requireAuth({ activePath: 'balance-sheet.html' }).then(() => {
  $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' + APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#flt-from').value = APP.settings.period_from;
  $('#flt-to').value = APP.settings.period_to;
  loadRep();
});
