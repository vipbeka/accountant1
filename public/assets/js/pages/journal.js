'use strict';

let ACCOUNTS = [], editingId = null, ENTRIES = [], originalMovementNo = '';

function setMvLocked(locked) {
  const el = $('#e-mv');
  if (!el) return;
  el.readOnly = !!locked;
  el.style.opacity = locked ? '0.75' : '';
  el.title = locked ? 'رقم الحركة ثابت عند التعديل ولن يُنشأ قيد جديد' : '';
}

function today() { return new Date().toISOString().slice(0, 10); }

function accOptions(selected) {
  return `<option value="">— اختر الحساب —</option>` + ACCOUNTS.map(a =>
    `<option value="${a.id}" ${Number(selected) === a.id ? 'selected' : ''}>${esc(a.acc_no)} - ${esc(a.name)}</option>`
  ).join('');
}

function buildToolbar() {
  let html = '';
  if (APP.canWrite()) html += `<button class="btn btn-gold btn-sm" onclick="newEntry()">➕ قيد جديد</button>`;
  if (APP.canWrite()) html += `<button class="btn btn-dark btn-sm" onclick="openModal('impModal')">📥 استيراد</button>`;
  if (APP.isAdmin()) html += `<button class="btn btn-red btn-sm" onclick="openModal('wipeModal')">🧹 مسح قيود</button>`;
  $('#toolbar').innerHTML = html;
}

function fillRegionSelects() {
  const opts = APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' + opts;
  $('#e-region').innerHTML = opts;
  $('#jimp-region').innerHTML = opts;
}

function filters() {
  return {
    from: $('#flt-from').value || undefined,
    to: $('#flt-to').value || undefined,
    region: $('#flt-region').value || undefined,
    status: $('#flt-status').value || undefined,
    type: $('#flt-type').value || undefined,
    query: $('#flt-q').value.trim() || undefined,
    limit: 500,
  };
}

async function loadEntries() {
  try {
    ENTRIES = await DB.journalList(filters());
    const tb = $('#entries-body');
    if (!ENTRIES.length) {
      tb.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="big">📒</div>لا توجد قيود مطابقة</td></tr>';
      return;
    }
    const canWrite = APP.canWrite();
    tb.innerHTML = ENTRIES.map(e => `
      <tr>
        <td class="num">${esc(e.movement_no)}</td>
        <td class="num">${fmtDate(e.entry_date)}</td>
        <td>${esc(e.description || '—')}</td>
        <td class="num"><span class="badge region">${esc(e.region)}</span>
            ${e.entry_type && e.entry_type !== 'عادي' ? `<span class="badge draft">${esc(e.entry_type)}</span>` : ''}</td>
        <td><span class="acc-lines">
          ${e.lines.map(l => `${esc(l.acc_no)} ${esc(l.name)} <b class="${l.debit > 0 ? 'amt-d' : 'amt-c'}">${l.debit > 0 ? fmt(l.debit) + ' مد' : fmt(l.credit) + ' دا'}</b>`).join('<br>')}
        </span></td>
        <td class="num" style="color:var(--green)">${fmt(e.total_debit)}</td>
        <td class="num" style="color:var(--red)">${fmt(e.total_credit)}</td>
        <td class="num">${e.status === 'posted' ? '<span class="badge posted">مرحل</span>' : '<span class="badge draft">مسودة</span>'}</td>
        <td class="num">
          ${canWrite ? `<div class="j-actions">
            <button class="btn btn-sm btn-dark act-btn" title="تعديل نفس القيد" onclick="editEntry(${e.id})">✏️</button>
            ${e.status === 'draft' ? `
              <button class="btn btn-sm btn-green act-btn" title="ترحيل" onclick="postEntry(${e.id})">✔</button>` :
              `<button class="btn btn-sm btn-dark act-btn" title="إلغاء الترحيل" onclick="unpostEntry(${e.id})">↩️</button>`}
            <button class="btn btn-sm btn-gold act-btn" title="كرر القيد" onclick="repeatEntry(${e.id})">📋</button>
            <button class="btn btn-sm btn-red act-btn" title="حذف" onclick="delEntry(${e.id})">🗑️</button>
          </div>` : '<span class="badge gray">عرض فقط</span>'}
        </td>
      </tr>`).join('');
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  const rows = [['رقم الحركة', 'التاريخ', 'البيان', 'المنطقة', 'الحساب', 'مدين', 'دائن', 'الحالة']];
  ENTRIES.forEach(e => e.lines.forEach(l => rows.push([
    e.movement_no, e.entry_date, e.description || '', e.region, `${l.acc_no} ${l.name}`,
    l.debit || '', l.credit || '', e.status === 'posted' ? 'مرحل' : 'مسودة',
  ])));
  exportExcel('دفتر اليومية.xlsx', 'القيود', rows);
}

/* ===== محرر القيد ===== */
function newEntry() {
  editingId = null;
  originalMovementNo = '';
  setMvLocked(false);
  $('#entry-modal-title').textContent = 'قيد يومية جديد';
  $('#e-desc').value = ''; $('#e-mv').value = ''; $('#e-type').value = 'عادي'; $('#e-date').value = today();
  $('#lines-body').innerHTML = '';
  addLine(); addLine();
  suggestFromDesc();
  openModal('entryModal');
}

let lineSeq = 0;
function addLine(accId = '', debit = '', credit = '') {
  const tr = document.createElement('tr');
  tr.dataset.seq = ++lineSeq;
  tr.innerHTML = `
    <td><select class="ln-acc">${accOptions(Number(accId))}</select></td>
    <td><input class="ln-debit num" type="number" step="0.01" min="0" value="${debit}"></td>
    <td><input class="ln-credit num" type="number" step="0.01" min="0" value="${credit}"></td>
    <td><button class="line-del" onclick="delLine(this)" title="حذف السطر">🗑️</button></td>`;
  $('#lines-body').appendChild(tr);
  recalc();
}
function delLine(btn) { btn.closest('tr').remove(); recalc(); }

function getLines() {
  return $$('#lines-body tr').map(tr => ({
    account_id: $('.ln-acc', tr).value,
    debit: parseFloat($('.ln-debit', tr).value || 0),
    credit: parseFloat($('.ln-credit', tr).value || 0),
  }));
}

function recalc() {
  let td = 0, tc = 0;
  $$('#lines-body tr').forEach(tr => {
    const d = parseFloat($('.ln-debit', tr).value || 0);
    const c = parseFloat($('.ln-credit', tr).value || 0);
    td += d; tc += c;
    $('.ln-credit', tr).style.borderColor = (d > 0 && c > 0) ? 'var(--red)' : '';
  });
  $('#t-debit').textContent = fmt(td);
  $('#t-credit').textContent = fmt(tc);
  const diff = Math.round((td - tc) * 100) / 100;
  $('#diff-box').innerHTML = diff === 0
    ? '<span class="badge posted">متوازن ✔</span>'
    : `<span class="badge draft">فرق: ${fmt(Math.abs(diff))}</span>`;
}
document.addEventListener('input', e => {
  if (e.target.closest('#lines-body')) recalc();
  if (e.target && e.target.id === 'e-desc') suggestFromDesc();
});

function entryPayload(status) {
  const typed = $('#e-mv').value.trim();
  return {
    movement_no: editingId ? (originalMovementNo || typed) : typed,
    entry_date: $('#e-date').value, region: $('#e-region').value,
    description: $('#e-desc').value.trim(), entry_type: $('#e-type').value, status,
    lines: getLines().filter(l => l.account_id && (l.debit > 0 || l.credit > 0)),
  };
}

function validateClient(p) {
  if (typeof SMART !== 'undefined') {
    const r = SMART.validate(p, ACCOUNTS);
    (r.warns || []).forEach(w => toast(w, 'err'));
    if (!r.ok) return (r.errors && r.errors[0]) || 'القيد مرفوض';
    return null;
  }
  if (!p.entry_date) return 'اختر التاريخ';
  if (!p.movement_no) return 'أدخل رقم الحركة';
  if (p.lines.length < 2) return 'القيد يحتاج سطرين على الأقل';
  for (const l of p.lines) if (l.debit > 0 && l.credit > 0) return 'السطر لا يمكن أن يكون مدينًا ودائنًا معًا';
  const td = p.lines.reduce((s, l) => s + l.debit, 0);
  const tc = p.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.round((td - tc) * 100) / 100 !== 0) return 'القيد غير متوازن';
  if (td <= 0) return 'إجمالي القيد يجب أن يكون أكبر من صفر';
  return null;
}

function suggestFromDesc() {
  const box = document.getElementById('smart-suggest');
  if (!box || typeof SMART === 'undefined') return;
  const list = SMART.suggest($('#e-desc') ? $('#e-desc').value : '', ACCOUNTS);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map((s, i) =>
    `<button type="button" class="btn btn-sm btn-dark" onclick="applySmartTemplate(${i})">${esc(s.title)}</button>`
  ).join(' ');
  window.__smartSuggest = list;
}

function applySmartTemplate(i) {
  const s = (window.__smartSuggest || [])[i];
  if (!s) return;
  $('#lines-body').innerHTML = '';
  s.lines.forEach(l => addLine(l.account_id || '', l.side === 'd' ? '' : '', l.side === 'c' ? '' : ''));
  toast('تم تعبئة الحسابات من القالب — أدخل المبلغ');
}

async function saveEntry(status) {
  const p = entryPayload(status);
  const err = validateClient(p);
  if (err) return toast(err, 'err');
  if (!editingId) {
    const dup = ENTRIES.find(x => String(x.movement_no) === String(p.movement_no));
    if (dup) return toast('رقم الحركة موجود بالفعل — هذا يعدّل قيدًا قديمًا لا ينشئ قيدًا جديدًا. اضغط أيقونة التعديل على نفس الصف', 'err');
  }
  try {
    if (editingId) {
      const cur = ENTRIES.find(x => x.id === editingId);
      if (cur && cur.status === 'posted') await DB.unpostEntry(editingId);
      await DB.updateEntry(editingId, p);
      if (status === 'posted') await DB.postEntry(editingId);
    } else {
      await DB.createEntry(p);
    }
    closeModal('entryModal');
    toast(editingId ? 'تم تعديل نفس القيد بدون إنشاء حركة جديدة' : (status === 'posted' ? 'تم حفظ وترحيل القيد' : 'تم حفظ القيد كمسودة'));
    editingId = null;
    originalMovementNo = '';
    loadEntries();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function editEntry(id) {
  const e = ENTRIES.find(x => x.id === id);
  if (!e) return toast('القيد غير موجود', 'err');
  editingId = id;
  originalMovementNo = e.movement_no;
  openEntryEditor(e, `تعديل القيد رقم الحركة ${e.movement_no}`, false);
}

function repeatEntry(id) {
  const e = ENTRIES.find(x => x.id === id);
  if (!e) return toast('القيد غير موجود', 'err');
  editingId = null;
  originalMovementNo = '';
  openEntryEditor(e, `قيد جديد متكرر — الأصل: رقم حركة ${e.movement_no}`, true);
  toast('هذا قيد جديد منسوخ — اكتب رقم حركة مختلفًا عن الأصل');
}
function openEntryEditor(e, title, clearMv) {
  $('#entry-modal-title').textContent = title;
  $('#e-mv').value = clearMv ? '' : e.movement_no;
  setMvLocked(!clearMv && !!editingId);
  $('#e-date').value = clearMv ? today() : e.entry_date;
  $('#e-region').value = e.region;
  $('#e-type').value = e.entry_type || 'عادي';
  $('#e-desc').value = e.description || '';
  $('#lines-body').innerHTML = '';
  e.lines.forEach(l => addLine(l.account_id, l.debit || '', l.credit || ''));
  recalc();
  suggestFromDesc();
  openModal('entryModal');
}

async function postEntry(id) {
  if (!await confirmDlg('ترحيل هذا القيد؟ سيظهر في الأستاذ العام وميزان المراجعة.')) return;
  try { await DB.postEntry(id); toast('تم الترحيل ✔'); loadEntries(); }
  catch (e) { toast(errMsg(e), 'err'); }
}
async function unpostEntry(id) {
  if (!await confirmDlg('إلغاء ترحيل القيد؟')) return;
  try { await DB.unpostEntry(id); toast('تم إلغاء الترحيل'); loadEntries(); }
  catch (e) { toast(errMsg(e), 'err'); }
}
async function delEntry(id) {
  if (!await confirmDlg('حذف القيد نهائيًا؟')) return;
  try { await DB.deleteEntry(id); toast('تم الحذف'); loadEntries(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

async function doWipe() {
  const scope = $('input[name=wipe-scope]:checked').value;
  const month = $('#wipe-month').value;
  if (scope === 'month' && !month) return toast('اختر الشهر أولًا', 'err');
  const label = scope === 'month' ? `كل قيود شهر ${month}` : 'جميع القيود بلا استثناء';
  if (!await confirmDlg(`تحذير نهائي ⚠️ هتحذف ${label} نهائيًا. متأكد؟`)) return;
  if (!await confirmDlg('تأكيد أخير: نفّذ المسح الآن؟')) return;
  try {
    const n = await DB.bulkDeleteJournal(scope, month);
    closeModal('wipeModal');
    toast(`تم مسح ${n} قيد`);
    loadEntries();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function doJournalImport() {
  const f = $('#jimp-file').files[0];
  if (!f) return toast('اختر ملفًا أولًا', 'err');
  const defaultRegion = $('#jimp-region').value;
  const post = $('#jimp-post').value === '1';
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const groups = {};
    for (const r of rows) {
      const mv = String(r['رقم الحركة'] ?? r['movement_no'] ?? '').trim();
      if (!mv) continue;
      (groups[mv] ||= []).push(r);
    }
    let added = 0, newAccounts = 0, drafts = 0; const errors = [];
    for (const [mv, lines] of Object.entries(groups)) {
      try {
        const first = lines[0];
        const entry_date = String(first['التاريخ'] ?? first['entry_date'] ?? today()).slice(0, 10);
        const description = String(first['البيان'] ?? first['description'] ?? '');
        const region = String(first['المنطقة'] ?? '').trim() || defaultRegion;
        const entryLines = [];
        for (const r of lines) {
          const acc_no = String(r['رقم الحساب'] ?? r['acc_no'] ?? '').trim();
          const name = String(r['اسم الحساب'] ?? r['name'] ?? '').trim();
          const debit = parseFloat(r['مدين'] ?? r['debit'] ?? 0) || 0;
          const credit = parseFloat(r['دائن'] ?? r['credit'] ?? 0) || 0;
          if (!acc_no) continue;
          let acc = ACCOUNTS.find(a => a.acc_no === acc_no);
          if (!acc) {
            acc = await DB.createAccount({ acc_no, name: name || acc_no, type: '', opening_balance: 0, budget: 0 });
            ACCOUNTS.push(acc); newAccounts++;
          }
          entryLines.push({ account_id: acc.id, debit, credit });
        }
        const check = typeof SMART !== 'undefined'
          ? SMART.validate({ movement_no: mv, entry_date, description, lines: entryLines }, ACCOUNTS)
          : { ok: Math.abs(entryLines.reduce((s, l) => s + l.debit, 0) - entryLines.reduce((s, l) => s + l.credit, 0)) < 0.01, errors: [], warns: [] };
        const td = entryLines.reduce((s, l) => s + l.debit, 0);
        const tc = entryLines.reduce((s, l) => s + l.credit, 0);
        const balanced = Math.abs(td - tc) < 0.01;
        if (!balanced || !check.ok) drafts++;
        await DB.createEntry({ movement_no: mv, entry_date, description, region, entry_type: 'عادي',
          status: (post && balanced && check.ok) ? 'posted' : 'draft', lines: entryLines });
        added++;
      } catch (e) { errors.push(`${mv}: ${errMsg(e)}`); }
    }
    let html = `<div class="alert ok">✔ تم استيراد <b>${added}</b> قيد` +
      (newAccounts ? ` وإنشاء <b>${newAccounts}</b> حساب جديد تلقائيًا` : '') +
      (drafts ? `<br>⚠️ <b>${drafts}</b> قيد غير متوازن أو مرفوض محاسبيًا أُضيف كمسودة` : '') + `</div>`;
    if (errors.length) html += `<div class="alert warn" style="max-height:180px;overflow:auto">${errors.map(esc).join('<br>')}</div>`;
    $('#jimp-result').innerHTML = html;
    toast('تم الاستيراد بنجاح');
    loadEntries();
  } catch (e) {
    $('#jimp-result').innerHTML = `<div class="alert err">${esc(errMsg(e))}</div>`;
  }
}

APP.requireAuth({ activePath: 'journal.html' }).then(async () => {
  buildToolbar();
  fillRegionSelects();
  $('#wipe-month').value = today().slice(0, 7);
  try {
    ACCOUNTS = await DB.accounts();
    await loadEntries();
  } catch (e) { toast(errMsg(e), 'err'); }
});
