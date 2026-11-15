'use strict';

let KIND = '';

const KIND_LABEL = { customer: 'عميل', vendor: 'مورد', employee: 'موظف' };

function buildToolbar() {
  let html = '';
  if (APP.canWrite()) html += `<button class="btn btn-gold btn-sm" onclick="newParty()">➕ إضافة</button>`;
  html += `<button class="btn btn-dark btn-sm" onclick="doExport()">📊 تصدير Excel</button>`;
  $('#toolbar').innerHTML = html;
}

document.getElementById('kind-tabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-k]');
  if (!btn) return;
  KIND = btn.dataset.k;
  $$('#kind-tabs button').forEach(b => {
    b.className = 'btn btn-sm ' + (b === btn ? 'btn-gold' : 'btn-dark');
  });
  renderList();
});

function newParty() {
  $('#p-title').textContent = 'طرف جديد';
  $('#p-id').value = '';
  $('#p-kind').value = KIND || 'customer';
  $('#p-name').value = '';
  $('#p-phone').value = '';
  $('#p-tax').value = '';
  $('#p-addr').value = '';
  $('#p-salary').value = '0';
  $('#p-notes').value = '';
  openModal('pModal');
}

function editParty(id) {
  const p = EXT.party(id);
  if (!p) return;
  $('#p-title').textContent = 'تعديل ' + p.name;
  $('#p-id').value = p.id;
  $('#p-kind').value = p.kind;
  $('#p-name').value = p.name;
  $('#p-phone').value = p.phone || '';
  $('#p-tax').value = p.tax_no || '';
  $('#p-addr').value = p.address || '';
  $('#p-salary').value = p.salary || 0;
  $('#p-notes').value = p.notes || '';
  openModal('pModal');
}

async function saveParty() {
  try {
    await EXT.saveParty({
      id: $('#p-id').value || undefined,
      kind: $('#p-kind').value,
      name: $('#p-name').value.trim(),
      phone: $('#p-phone').value.trim(),
      tax_no: $('#p-tax').value.trim(),
      address: $('#p-addr').value.trim(),
      salary: parseFloat($('#p-salary').value || 0),
      notes: $('#p-notes').value.trim(),
    });
    closeModal('pModal');
    toast('تم الحفظ في قاعدة البيانات');
    renderList();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function delParty(id) {
  if (!await confirmDlg('حذف هذا الطرف؟')) return;
  try { await EXT.deleteParty(id); toast('تم الحذف'); renderList(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

function renderList() {
  const q = ($('#flt-q').value || '').trim();
  let list = EXT.parties();
  if (KIND) list = list.filter(p => p.kind === KIND);
  if (q) list = list.filter(p => (p.name + ' ' + (p.phone || '') + ' ' + (p.code || '') + ' ' + (p.tax_no || '')).includes(q));
  const tb = $('#p-body');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="big">👥</div>لا يوجد أطراف — أضف عميلًا أو موظفًا</td></tr>';
    return;
  }
  const can = APP.canWrite();
  tb.innerHTML = list.map(p => {
    const bal = EXT.partyBalance(p.id);
    const badge = p.kind === 'employee' ? 'gray' : p.kind === 'vendor' ? 'draft' : 'region';
    return `<tr>
      <td class="num">${esc(p.code)}</td>
      <td>${esc(p.name)}</td>
      <td><span class="badge ${badge}">${KIND_LABEL[p.kind] || p.kind}</span></td>
      <td>${esc(p.phone || '—')}</td>
      <td>${esc(p.tax_no || '—')}</td>
      <td class="num">${p.kind === 'employee' ? fmt(p.salary || 0) : '—'}</td>
      <td class="num" style="color:${bal > 0 ? 'var(--green)' : bal < 0 ? 'var(--red)' : 'var(--muted)'}">${fmt(bal)}</td>
      <td class="num">${can ? `<div class="j-actions">
        <button class="btn btn-sm btn-dark act-btn" onclick="editParty('${p.id}')">✏️</button>
        <button class="btn btn-sm btn-red act-btn" onclick="delParty('${p.id}')">🗑️</button>
      </div>` : ''}</td>
    </tr>`;
  }).join('');
}

function doExport() {
  const rows = [['الرمز', 'الاسم', 'النوع', 'الهاتف', 'الرقم الضريبي', 'الراتب', 'الرصيد']];
  EXT.parties().forEach(p => rows.push([p.code, p.name, KIND_LABEL[p.kind], p.phone || '', p.tax_no || '', p.salary || 0, EXT.partyBalance(p.id)]));
  exportExcel('العملاء والموظفون.xlsx', 'الأطراف', rows);
}

APP.requireAuth({ activePath: 'parties.html' }).then(async () => {
  await EXT.hydrate();
  buildToolbar();
  renderList();
});
