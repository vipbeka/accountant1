'use strict';

function parseAuditInvoice(log) {
  if (!log || log.action !== 'حذف فاتورة') return null;
  try { const p = typeof log.details === 'string' ? JSON.parse(log.details || '{}') : log.details; return p && p.restore_type === 'invoice' && p.item ? p.item : null; } catch (_) { return null; }
}

function parseAuditExpense(log) {
  if (!log || log.action !== 'حذف مصروف') return null;
  try {
    const p = typeof log.details === 'string' ? JSON.parse(log.details || '{}') : log.details;
    return p && p.restore_type === 'expense' && p.item ? p.item : null;
  } catch (_) { return null; }
}

async function restoreAuditInvoice(id) {
  if (!await confirmDlg('استرجاع هذه الفاتورة كمسودة؟')) return;
  try {
    const { data: log, error } = await supabase.from('audit_log').select('id,action,details').eq('id', id).single();
    if (error) throw error;
    const item = parseAuditInvoice(log); if (!item) throw new Error('لا توجد نسخة فاتورة قابلة للاسترجاع');
    item.status = 'draft'; item.journal_mv = '';
    await EXT.saveInvoice(item);
    toast('تم استرجاع الفاتورة ' + (item.no || '') + ' كمسودة'); await loadAuditLogs();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function restoreAuditOperation(id) {
  if (!await confirmDlg('استرجاع هذا المصروف؟ سيعود كمسودة، ويمكن ترحيله من صفحة المصاريف عند الحاجة.')) return;
  try {
    const { data: log, error: logError } = await supabase.from('audit_log').select('id,action,details').eq('id', id).single();
    if (logError) throw logError;
    const item = parseAuditExpense(log);
    if (!item) throw new Error('هذه العملية لا تحتوي على نسخة مصروف قابلة للاسترجاع');
    const restored = await EXPENSES.restoreDeleted(item.id);
    toast('تم استرجاع المصروف ' + (restored.no || '') + ' كمسودة');
    await loadAuditLogs();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function loadAuditLogs() {
  const logs = await DB.auditLog();
  const tb = $('#log-body');
  if (!logs.length) { tb.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد عمليات مسجلة بعد</td></tr>'; return; }
  tb.innerHTML = logs.map(l => {
    const item = parseAuditExpense(l); const invoice = parseAuditInvoice(l);
    const details = item ? `حذف المصروف ${esc(item.no || item.id)} — ${esc(item.description || item.type || '')}` : invoice ? `حذف الفاتورة ${esc(invoice.no || invoice.id)} — ${esc(invoice.description || '')}` : esc(l.details || '—');
    const action = item ? '<span class="badge draft">حذف مصروف</span>' : invoice ? '<span class="badge draft">حذف فاتورة</span>' : `<span class="badge region">${esc(l.action)}</span>`;
    const restore = item ? `<button class="btn btn-sm btn-teal" onclick="restoreAuditOperation(${Number(l.id)})">↩️ استعادة</button>` : invoice ? `<button class="btn btn-sm btn-teal" onclick="restoreAuditInvoice(${Number(l.id)})">↩️ استعادة</button>` : '—';
    return `<tr><td class="num">${new Date(l.at).toLocaleString('ar-EG')}</td><td>${esc(l.user)}</td><td>${action}</td><td>${details}</td><td class="num">${restore}</td></tr>`;
  }).join('');
}

APP.requireAuth({ activePath: 'audit.html', allowRoles: ['admin', 'accounts_manager'] }).then(async () => {
  try {
    await EXPENSES.hydrate();
    await loadAuditLogs();
  } catch (e) { toast(errMsg(e), 'err'); }
});
