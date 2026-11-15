'use strict';

let LAST_CF = null;

async function loadRep() {
  try {
    const d = await DB.cashFlow($('#flt-from').value, $('#flt-to').value, $('#flt-region').value);
    LAST_CF = d;
    const t = d.totals;
    const rowsHtml = d.rows.length ? d.rows.map(r => `
        <tr>
          <td class="num">${esc(r.acc_no)}</td><td>${esc(r.name)}</td>
          <td class="num">${r.opening ? fmt(r.opening) : ''}</td>
          <td class="num" style="color:var(--green)">${r.inflow ? fmt(r.inflow) : ''}</td>
          <td class="num" style="color:var(--red)">${r.outflow ? fmt(r.outflow) : ''}</td>
          <td class="num">${r.closing ? fmt(r.closing) : ''}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty-state">لا توجد حسابات نقدية (صندوق / بنك) في النظام</td></tr>';

    const netFlow = d.net_flow >= 0
      ? `<span class="balance-pill ok">➚ صافي التدفق للفترة: ${fmt(d.net_flow)} (داخل > خارج)</span>`
      : `<span class="balance-pill bad">➘ صافي التدفق للفترة: ${fmt(d.net_flow)} (خارج > داخل)</span>`;

    $('#result').innerHTML = `<div style="padding:18px 20px;display:flex;gap:14px;align-items:center;border-bottom:1px solid var(--border)">${netFlow}</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="num">رقم الحساب</th><th>الحساب</th><th class="num">رصيد افتتاحي</th>
          <th class="num">تدفقات داخلة</th><th class="num">تدفقات خارجة</th><th class="num">رصيد نهائي</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:center">الإجمالي</td>
          <td class="num">${fmt(t.opening)}</td><td class="num">${fmt(t.inflow)}</td>
          <td class="num">${fmt(t.outflow)}</td><td class="num">${fmt(t.closing)}</td></tr></tfoot>
      </table></div>`;
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!LAST_CF) return toast('اعرض التقرير أولًا', 'err');
  const rows = [['رقم الحساب', 'الحساب', 'رصيد افتتاحي', 'تدفقات داخلة', 'تدفقات خارجة', 'رصيد نهائي']];
  LAST_CF.rows.forEach(r => rows.push([r.acc_no, r.name, r.opening, r.inflow, r.outflow, r.closing]));
  exportExcel('التدفقات النقدية.xlsx', 'التدفقات النقدية', rows);
}

APP.requireAuth({ activePath: 'cash-flow.html' }).then(() => {
  $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' + APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#flt-from').value = APP.settings.period_from;
  $('#flt-to').value = APP.settings.period_to;
  loadRep();
});
