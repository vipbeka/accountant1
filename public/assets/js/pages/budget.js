'use strict';

let BUDGET_DATA = [], BUDGET_SUMMARY = null;

function buildToolbar() {
  let html = '';
  if (APP.canWrite()) html += `<button class="btn btn-teal btn-sm" onclick="openBudgetModal()">✏️ تحديث الميزانيات</button>`;
  html += `<button class="btn btn-gold btn-sm" onclick="doExport()">📄 تصدير Excel</button>`;
  $('#toolbar').innerHTML = html;
}

async function loadBudget() {
  try {
    const d = await DB.budget($('#f-from').value, $('#f-to').value, $('#f-region').value, $('#f-type').value);
    BUDGET_DATA = d.entries; BUDGET_SUMMARY = d.summary;
    renderBudget(d.entries, d.summary);
  } catch (e) { toast(errMsg(e), 'err'); }
}

function renderBudget(list, summary) {
  const tb = $('#budget-table tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="big">📊</div>لا توجد حسابات لعرضها</td></tr>';
    $('#budget-summary').style.display = 'none';
    return;
  }
  tb.innerHTML = list.map(a => {
    const varClass = a.variance >= 0 ? 'under' : 'over';
    const pctClass = a.pct > 100 ? 'over' : a.pct > 90 ? 'warn' : 'under';
    const statusClass = a.status.includes('تجاوز') ? 'badge-red' : a.status.includes('قريب') ? 'badge-yellow' :
                        a.status.includes('ضمن') ? 'badge-green' : a.status.includes('أقل') ? 'badge-blue' : 'badge-gray';
    return `<tr>
      <td class="num">${esc(a.acc_no)}</td><td>${esc(a.name)}</td><td><span class="badge region">${esc(a.type)}</span></td>
      <td class="num">${fmt(a.budget)}</td><td class="num">${fmt(a.actual)}</td>
      <td class="num ${varClass}">${fmt(a.variance)}</td><td class="num ${pctClass}">${a.pct}%</td>
      <td><span class="badge ${statusClass}">${esc(a.status)}</span></td>
    </tr>`;
  }).join('');
  if (summary) {
    $('#budget-summary').style.display = '';
    $('#sum-budget').textContent = fmt(summary.budget);
    $('#sum-actual').textContent = fmt(summary.actual);
    $('#sum-variance').textContent = fmt(summary.variance);
    $('#sum-variance').className = 'summary-value ' + (summary.variance >= 0 ? 'under' : 'over');
    $('#sum-pct').textContent = summary.pct + '%';
  }
}

function openBudgetModal() {
  $('#alloc-table tbody').innerHTML = BUDGET_DATA.map(a => `
    <tr data-id="${a.id}">
      <td class="num">${esc(a.acc_no)}</td><td>${esc(a.name)}</td><td><span class="badge region">${esc(a.type)}</span></td>
      <td class="num">${fmt(a.budget)}</td>
      <td class="num"><input type="number" step="0.01" class="budget-input" value="${a.budget}" data-id="${a.id}"></td>
    </tr>`).join('');
  openModal('budgetModal');
}

async function saveBudgetAlloc() {
  const items = $$('.budget-input').map(inp => ({ id: parseInt(inp.dataset.id), budget: parseFloat(inp.value || 0) }));
  if (!items.length) return toast('لا توجد بيانات', 'err');
  try {
    await DB.bulkBudget(items);
    closeModal('budgetModal');
    toast('تم تحديث الميزانيات بنجاح');
    loadBudget();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!BUDGET_DATA.length) return toast('اعرض التقرير أولًا', 'err');
  const rows = [['رقم', 'اسم الحساب', 'النوع', 'الميزانية', 'المنفّذ', 'الفرق', 'النسبة%', 'الحالة']];
  BUDGET_DATA.forEach(a => rows.push([a.acc_no, a.name, a.type, a.budget, a.actual, a.variance, a.pct, a.status]));
  exportExcel('الموازنة التقديرية.xlsx', 'الموازنة', rows);
}

APP.requireAuth({ activePath: 'budget.html' }).then(() => {
  buildToolbar();
  $('#f-region').innerHTML = '<option value="">— الكل —</option>' + APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#f-from').value = APP.settings.period_from;
  $('#f-to').value = APP.settings.period_to;
  loadBudget();
});
