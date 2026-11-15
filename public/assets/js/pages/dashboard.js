'use strict';

APP.requireAuth({ activePath: 'index.html' }).then(async () => {
  document.getElementById('period-info').innerHTML = `
    <p style="margin-bottom:10px">📅 فترة التقارير: <b style="color:var(--text)">${esc(APP.settings.period_from)}</b> إلى <b style="color:var(--text)">${esc(APP.settings.period_to)}</b></p>
    <p style="margin-bottom:10px">🏢 الشركة: <b style="color:var(--text)">${esc(APP.settings.company_name)}</b></p>
    <p style="margin-bottom:10px">🗺️ المناطق: ${esc(APP.regions.join('، '))}</p>
    <p>💡 القيود غير المرحلة لا تظهر في الأستاذ العام وميزان المراجعة حتى يتم ترحيلها من صفحة دفتر اليومية.</p>`;

  try {
    const d = await DB.dashboard();
    $('#st-accounts').textContent = d.stats.accounts;
    $('#st-entries').textContent = d.stats.entries;
    $('#st-debit').textContent = fmt(d.stats.total_debit);
    $('#st-credit').textContent = fmt(d.stats.total_credit);
    $('#st-drafts').textContent = d.stats.drafts;
    const invs = typeof EXT !== 'undefined' ? (await EXT.hydrate(), EXT.invoices().filter(i => i.status === 'posted')) : [];
    const vchs = typeof EXT !== 'undefined' ? EXT.vouchers() : [];
    const pts = typeof EXT !== 'undefined' ? EXT.parties() : [];
    const elInv = document.getElementById('st-invoices');
    const elV = document.getElementById('st-vouchers');
    const elP = document.getElementById('st-parties');
    if (elInv) elInv.textContent = invs.length;
    if (elV) elV.textContent = vchs.length;
    if (elP) elP.textContent = pts.filter(p => p.kind === 'customer').length + ' / ' + pts.filter(p => p.kind === 'employee').length;
    const tb = $('#recent-body');
    if (!d.recent.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="big">📭</div>لا توجد قيود بعد</td></tr>';
    } else {
      const withTotals = await Promise.all(d.recent.map(async e => {
        const { data: lines } = await supabase.from('journal_lines').select('debit').eq('entry_id', e.id);
        return { ...e, total_debit: (lines || []).reduce((s, l) => s + Number(l.debit || 0), 0) };
      }));
      tb.innerHTML = withTotals.map(e => `
        <tr>
          <td class="num">${esc(e.movement_no)}</td>
          <td class="num">${fmtDate(e.entry_date)}</td>
          <td>${esc(e.description || '—')}</td>
          <td class="num">${fmt(e.total_debit)}</td>
          <td>${e.status === 'posted' ? '<span class="badge posted">مرحل</span>' : '<span class="badge draft">مسودة</span>'}</td>
        </tr>`).join('');
    }
  } catch (err) { toast(errMsg(err), 'err'); }
});
