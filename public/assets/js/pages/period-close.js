'use strict';

let ACCOUNTS = [];
let PACK = null;

function periodNo(from, to) {
  return 'CLOSE-' + String(from).replace(/-/g, '') + '-' + String(to).replace(/-/g, '');
}

function isCloseEntry(e) {
  return e.entry_type === 'إقفال' || String(e.movement_no || '').indexOf('CLOSE-') === 0;
}

async function loadPack() {
  const from = $('#c-from').value;
  const to = $('#c-to').value;
  const region = $('#c-region').value;
  if (!from || !to) throw new Error('حدد بداية الفترة ونهايتها');
  if (from > to) throw new Error('بداية الفترة بعد نهايتها');
  let q = supabase.from('journal_entries')
    .select('id,movement_no,entry_date,description,region,status,entry_type')
    .gte('entry_date', from).lte('entry_date', to)
    .eq('status', 'posted')
    .order('entry_date');
  if (region) q = q.eq('region', region);
  const ent = await q;
  if (ent.error) throw ent.error;
  const entries = ent.data || [];
  let lines = [];
  const ids = entries.map(e => e.id);
  for (let i = 0; i < ids.length; i += 80) {
    const part = await supabase.from('journal_lines').select('entry_id,account_id,debit,credit').in('entry_id', ids.slice(i, i + 80));
    if (part.error) throw part.error;
    lines = lines.concat(part.data || []);
  }
  const byAcc = {};
  const accMap = {};
  ACCOUNTS.forEach(a => { accMap[a.id] = a; });
  lines.forEach(l => {
    const e = entries.find(x => x.id === l.entry_id);
    if (!e || isCloseEntry(e)) return;
    const id = l.account_id;
    if (!byAcc[id]) byAcc[id] = { debit: 0, credit: 0 };
    byAcc[id].debit = round2(byAcc[id].debit + Number(l.debit || 0));
    byAcc[id].credit = round2(byAcc[id].credit + Number(l.credit || 0));
  });
  const rows = [];
  let revenue = 0, expense = 0;
  Object.keys(byAcc).forEach(id => {
    const a = accMap[id];
    if (!a) return;
    const d = byAcc[id].debit, c = byAcc[id].credit;
    const type = a.type || '';
    if (type === 'إيرادات') revenue = round2(revenue + (c - d));
    if (type === 'مصروفات') expense = round2(expense + (d - c));
    rows.push({ id: a.id, no: a.acc_no, name: a.name, type, debit: d, credit: c });
  });
  rows.sort((a, b) => String(a.no).localeCompare(String(b.no), 'en'));
  const re = ACCOUNTS.find(a => String(a.acc_no) === '3103') || ACCOUNTS.find(a => /أرباح محتجزة|أرباح مرحلة/.test(a.name || ''));
  PACK = { from, to, region, entries, lines, rows, revenue, expense, profit: round2(revenue - expense), re, accMap };
  return PACK;
}

function renderPack() {
  const p = PACK;
  $('#sum-rev').textContent = fmt(p.revenue);
  $('#sum-exp').textContent = fmt(p.expense);
  $('#sum-net').textContent = fmt(p.profit);
  $('#sum-cnt').textContent = String(p.entries.length);
  const tb = $('#close-lines');
  if (!p.entries.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty-state">لا توجد قيود مرحلة في هذه الفترة</td></tr>';
  } else {
    const chunks = [];
    p.entries.forEach(e => {
      const ls = p.lines.filter(l => l.entry_id === e.id);
      if (!ls.length) {
        chunks.push(`<tr><td class="num">${esc(e.movement_no)}</td><td class="num">${fmtDate(e.entry_date)}</td><td>${esc(e.description || '')}</td><td>${esc(e.region || '')}</td><td>—</td><td class="num"></td><td class="num"></td></tr>`);
        return;
      }
      ls.forEach((l, i) => {
        const a = p.accMap[l.account_id];
        chunks.push(`<tr>
          <td class="num">${i === 0 ? esc(e.movement_no) : ''}</td>
          <td class="num">${i === 0 ? fmtDate(e.entry_date) : ''}</td>
          <td>${i === 0 ? esc(e.description || '') : ''}</td>
          <td>${esc(a ? a.acc_no + ' — ' + a.name : l.account_id)}</td>
          <td>${esc(a ? a.type : '')}</td>
          <td class="num">${Number(l.debit) ? fmt(l.debit) : ''}</td>
          <td class="num">${Number(l.credit) ? fmt(l.credit) : ''}</td>
        </tr>`);
      });
    });
    tb.innerHTML = chunks.join('');
  }
  const pl = p.rows.filter(r => r.type === 'إيرادات' || r.type === 'مصروفات');
  $('#pl-body').innerHTML = pl.length ? pl.map(r => {
    const net = r.type === 'إيرادات' ? round2(r.credit - r.debit) : round2(r.debit - r.credit);
    return `<tr><td class="num">${esc(r.no)}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td class="num">${fmt(net)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-state">لا حركة على الإيرادات أو المصروفات</td></tr>';
  const already = p.entries.some(e => e.movement_no === periodNo(p.from, p.to));
  $('#close-note').textContent = already
    ? 'هذه الفترة مُقفلة مسبقاً بقيد ' + periodNo(p.from, p.to) + '. يمكن الطباعة والتصدير، ولن يُنشأ قيد ثانٍ.'
    : (p.re ? 'الإقفال ينقل الصافي إلى ' + p.re.acc_no + ' — ' + p.re.name : 'لم يُعثر على حساب الأرباح المحتجزة 3103');
}

async function showPeriod() {
  try {
    await loadPack();
    renderPack();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function exportPeriod() {
  if (!PACK) return toast('اعرض الفترة أولاً', 'err');
  const head = ['رقم الحركة', 'التاريخ', 'البيان', 'الحساب', 'النوع', 'مدين', 'دائن', 'المنطقة'];
  const aoa = [head];
  PACK.entries.forEach(e => {
    const ls = PACK.lines.filter(l => l.entry_id === e.id);
    if (!ls.length) aoa.push([e.movement_no, e.entry_date, e.description || '', '', '', '', '', e.region || '']);
    ls.forEach(l => {
      const a = PACK.accMap[l.account_id];
      aoa.push([e.movement_no, e.entry_date, e.description || '', a ? a.acc_no + ' ' + a.name : l.account_id, a ? a.type : '', Number(l.debit) || 0, Number(l.credit) || 0, e.region || '']);
    });
  });
  aoa.push([]);
  aoa.push(['ملخص الإقفال', PACK.from, PACK.to, '', '', PACK.expense, PACK.revenue, '']);
  aoa.push(['صافي الربح / (الخسارة)', PACK.profit]);
  exportExcel('إقفال-الفترة-' + PACK.from + '.xlsx', 'قيود الفترة', aoa);
}

function printPeriod() {
  if (!PACK) return toast('اعرض الفترة أولاً', 'err');
  const p = PACK;
  const body = p.entries.map(e => {
    const ls = p.lines.filter(l => l.entry_id === e.id);
    return ls.map((l, i) => {
      const a = p.accMap[l.account_id];
      return `<tr>
        <td>${i === 0 ? esc(e.movement_no) : ''}</td>
        <td>${i === 0 ? fmtDate(e.entry_date) : ''}</td>
        <td>${i === 0 ? esc(e.description || '') : ''}</td>
        <td>${esc(a ? a.acc_no + ' — ' + a.name : '')}</td>
        <td class="num">${Number(l.debit) ? fmt(l.debit) : ''}</td>
        <td class="num">${Number(l.credit) ? fmt(l.credit) : ''}</td>
      </tr>`;
    }).join('');
  }).join('');
  const html = `
    <div class="bar"></div>
    <div class="pad">
      <h1>${esc(APP.settings.company_name || '')}</h1>
      <p class="sub">إقفال الفترة من ${fmtDate(p.from)} إلى ${fmtDate(p.to)}${p.region ? ' — ' + esc(p.region) : ''}</p>
      <p>الرقم الضريبي: ${esc(APP.settings.tax_no || '—')} — السجل التجاري: ${esc(APP.settings.commercial_reg || '—')}</p>
      <p>العنوان: ${esc(APP.settings.company_address || '—')}</p>
      <div class="row">إيرادات الفترة: <b>${fmt(p.revenue)}</b> — مصروفات الفترة: <b>${fmt(p.expense)}</b> — الصافي: <b>${fmt(p.profit)}</b></div>
      <table class="doc-table">
        <thead><tr><th>رقم الحركة</th><th>التاريخ</th><th>البيان</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6">لا قيود</td></tr>'}</tbody>
      </table>
      <div class="foot">عدد القيود المرحلة: ${p.entries.length} — الجنيه المصري</div>
    </div>`;
  if (typeof showDoc === 'function') showDoc(html);
  else {
    const w = window.open('', '_blank');
    if (!w) return toast('اسمح بالنوافذ المنبثقة للطباعة', 'err');
    w.document.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إقفال الفترة</title></head><body>' + html + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }
}

async function postClose() {
  if (!APP.canWrite()) return toast('ليست لديك صلاحية الترحيل', 'err');
  try {
    await loadPack();
    renderPack();
    const p = PACK;
    if (!p.re) return toast('أضف حساب 3103 الأرباح المحتجزة في الدليل أولاً', 'err');
    const mv = periodNo(p.from, p.to);
    if (p.entries.some(e => e.movement_no === mv)) return toast('الفترة مُقفلة بهذا الرقم بالفعل', 'err');
    const lines = [];
    p.rows.forEach(r => {
      if (r.type === 'إيرادات') {
        const net = round2(r.credit - r.debit);
        if (net > 0) lines.push({ account_id: r.id, debit: net, credit: 0 });
        else if (net < 0) lines.push({ account_id: r.id, debit: 0, credit: -net });
      } else if (r.type === 'مصروفات') {
        const net = round2(r.debit - r.credit);
        if (net > 0) lines.push({ account_id: r.id, debit: 0, credit: net });
        else if (net < 0) lines.push({ account_id: r.id, debit: -net, credit: 0 });
      }
    });
    if (!lines.length) return toast('لا توجد إيرادات أو مصروفات لإقفالها في هذه الفترة', 'err');
    if (p.profit > 0) lines.push({ account_id: p.re.id, debit: 0, credit: p.profit });
    else if (p.profit < 0) lines.push({ account_id: p.re.id, debit: -p.profit, credit: 0 });
    else lines.push({ account_id: p.re.id, debit: 0, credit: 0 });
    const usable = lines.filter(l => Number(l.debit) > 0 || Number(l.credit) > 0);
    const td = round2(usable.reduce((s, l) => s + Number(l.debit || 0), 0));
    const tc = round2(usable.reduce((s, l) => s + Number(l.credit || 0), 0));
    if (td !== tc) return toast('قيد الإقفال غير متوازن ' + fmt(td) + ' / ' + fmt(tc), 'err');
    if (!await confirmDlg('ترحيل قيد الإقفال ' + mv + ' بصافي ' + fmt(p.profit) + ' إلى الأرباح المحتجزة؟')) return;
    await DB.createEntry({
      movement_no: mv,
      entry_date: p.to,
      region: p.region || (APP.regions[0] || ''),
      description: 'إقفال الفترة من ' + p.from + ' إلى ' + p.to,
      entry_type: 'إقفال',
      status: 'posted',
      lines: usable,
    });
    toast('تم ترحيل قيد الإقفال ' + mv);
    await showPeriod();
  } catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({ activePath: 'period-close.html' }).then(async () => {
  try {
    ACCOUNTS = await DB.accounts();
    const sel = $('#c-region');
    sel.innerHTML = '<option value="">كل المناطق</option>' + (APP.regions || []).map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    const now = new Date();
    const y = now.getFullYear();
    $('#c-from').value = APP.settings.period_from || (y + '-01-01');
    $('#c-to').value = APP.settings.period_to || now.toISOString().slice(0, 10);
    if (APP.canWrite()) $('#btn-close').style.display = '';
    await showPeriod();
  } catch (e) { toast(errMsg(e), 'err'); }
});
