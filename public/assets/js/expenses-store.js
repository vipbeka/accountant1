'use strict';

const EXPENSES_KEY = 'expenses_store_v1';
const EXPENSES = {
  cache: null,
  uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); },
  empty() { return { items: [], seq: 0 }; },
  async hydrate() {
    if (this.cache) return this.cache;
    const { data, error } = await supabase.from('settings').select('value').eq('key', EXPENSES_KEY).maybeSingle();
    if (error) throw error;
    try { this.cache = data && data.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : this.empty(); }
    catch (_) { this.cache = this.empty(); }
    this.cache.items = this.cache.items || [];
    this.cache.sheets = Array.isArray(this.cache.sheets) ? this.cache.sheets : [];
    this.cache.seq = Number(this.cache.seq || 0);
    this.cache.sheetSeq = Number(this.cache.sheetSeq || 0);
    return this.cache;
  },
  async persist() {
    const { error } = await supabase.from('settings').upsert({ key: EXPENSES_KEY, value: JSON.stringify(this.cache) }, { onConflict: 'key' });
    if (error) throw error;
  },
  nextNo() { this.cache.seq += 1; return 'EXP-' + new Date().getFullYear() + '-' + String(this.cache.seq).padStart(4, '0'); },
  get(id) { return this.cache.items.find(x => x.id === id) || null; },
  async save(item) {
    await this.hydrate();
    if (!item.date || !item.amount || Number(item.amount) <= 0) throw new Error('التاريخ والمبلغ مطلوبان');
    if (!item.account_id || !item.cash_account_id) throw new Error('اختر حساب المصروف وحساب الدفع');
    item.amount = Math.round(Number(item.amount) * 100) / 100;
    item.id = item.id || this.uid();
    if (!item.no) item.no = this.nextNo();
    const old = this.get(item.id);
    if (old && old.status === 'posted') throw new Error('لا يمكن تعديل مصروف مرحّل');
    if (old) this.cache.items[this.cache.items.findIndex(x => x.id === item.id)] = { ...old, ...item };
    else this.cache.items.push({ ...item, status: 'draft', created_at: new Date().toISOString(), created_by: APP.profile.full_name });
    await this.persist();
    return this.get(item.id);
  },
  /* حفظ دفعة واحدة لصفوف الاستيراد: كتابة واحدة لقاعدة البيانات بدل كتابة لكل صف.
     المسودات المستوردة قد تصل بلا حسابات إن تعذرت مطابقتها — تُستكمل قبل الترحيل. */
  async saveMany(items) {
    await this.hydrate();
    const now = new Date().toISOString();
    const by = (APP.profile && APP.profile.full_name) || '';
    const added = [];
    const seqBefore = this.cache.seq;
    for (const it of items) {
      if (!it.date || !(Number(it.amount) > 0)) continue;
      const item = { ...it, id: this.uid(), amount: Math.round(Number(it.amount) * 100) / 100, status: 'draft', created_at: now, created_by: by };
      item.no = this.nextNo();
      this.cache.items.push(item);
      added.push(item);
    }
    if (added.length) {
      try { await this.persist(); }
      catch (e) { // تراجع: لا تبقِ صفوفاً غير محفوظة في الذاكرة
        const ids = new Set(added.map(x => x.id));
        this.cache.items = this.cache.items.filter(x => !ids.has(x.id));
        this.cache.seq = seqBefore;
        throw e;
      }
    }
    return added;
  },
  /* ---------- كشوف المصروفات (مستند واحد بسطور متعددة) ---------- */
  sheet(id) { return (this.cache.sheets || []).find(x => x.id === id) || null; },
  nextSheetNo() {
    const year = new Date().getFullYear();
    let max = this.cache.sheetSeq || 0;
    (this.cache.sheets || []).forEach(x => { const m = String(x.no || '').match(new RegExp('^EXS-' + year + '-(\\d+)$')); if (m) max = Math.max(max, Number(m[1])); });
    this.cache.sheetSeq = max + 1;
    return 'EXS-' + year + '-' + String(this.cache.sheetSeq).padStart(4, '0');
  },
  async saveSheet(sh) {
    await this.hydrate();
    const lines = (sh.lines || []).map(l => ({
      date: String(l.date || ''), statement: String(l.statement || '').trim(),
      income: Math.round(Math.abs(Number(l.income) || 0) * 100) / 100,
      expense: Math.round(Math.abs(Number(l.expense) || 0) * 100) / 100,
      account_id: l.account_id ? String(l.account_id) : '',
    })).filter(l => l.income || l.expense || l.statement || l.date);
    if (!lines.some(l => l.income || l.expense)) throw new Error('أضف حركة واحدة على الأقل بمبلغ وارد أو مصروف');
    const noDate = lines.findIndex(l => (l.income || l.expense) && !/^\d{4}-\d{2}-\d{2}$/.test(l.date));
    if (noDate >= 0) throw new Error('السطر ' + (noDate + 1) + ': التاريخ مطلوب');
    const now = new Date().toISOString();
    const by = (APP.profile && APP.profile.full_name) || '';
    const base = {
      title: String(sh.title || '').trim() || 'كشف مصروفات',
      opening: Math.round((Number(sh.opening) || 0) * 100) / 100,
      cash_account_id: sh.cash_account_id || '', expense_account_id: sh.expense_account_id || '', funding_account_id: sh.funding_account_id || '',
      notes: String(sh.notes || '').trim(), lines, updated_at: now, updated_by: by,
    };
    let rec;
    if (sh.id && this.sheet(sh.id)) {
      rec = this.sheet(sh.id);
      if (rec.status === 'posted') throw new Error('الكشف مرحّل — ألغِ الترحيل أولاً ثم عدّل');
      Object.assign(rec, base);
    } else {
      rec = { ...base, id: this.uid(), no: this.nextSheetNo(), status: 'draft', journal_mv: '', created_at: now, created_by: by, imported_from: sh.imported_from || '' };
      this.cache.sheets.push(rec);
    }
    try { await this.persist(); }
    catch (e) { if (!sh.id) this.cache.sheets = this.cache.sheets.filter(x => x !== rec); throw e; }
    return rec;
  },
  async markSheet(id, patch) {
    const rec = this.sheet(id);
    if (!rec) throw new Error('الكشف غير موجود');
    Object.assign(rec, patch, { updated_at: new Date().toISOString() });
    await this.persist();
    return rec;
  },
  async removeSheet(id) {
    await this.hydrate();
    const rec = this.sheet(id);
    if (!rec) throw new Error('الكشف غير موجود');
    if (rec.status === 'posted') throw new Error('ألغِ ترحيل الكشف قبل حذفه');
    await this.backupDeleted([{ type: 'expense_sheet', item: rec }]);
    this.cache.sheets = this.cache.sheets.filter(x => x.id !== id);
    await this.persist();
    try { await supabase.rpc('log_audit', { p_action: 'حذف كشف مصروفات', p_details: rec.no + ' — ' + rec.title }); } catch (_) {}
  },
  /* حذف كل المسودات المستوردة من ملف واحد (لإزالة دفعة استيراد خاطئة). المرحّل لا يُمس. */
  async removeImportedBatch(fileName) {
    await this.hydrate();
    const victims = this.cache.items.filter(x => x.imported_from === fileName && x.status !== 'posted');
    if (!victims.length) return 0;
    await this.backupDeleted(victims.map(item => ({ type: 'expense', item })));
    const ids = new Set(victims.map(x => x.id));
    this.cache.items = this.cache.items.filter(x => !ids.has(x.id));
    await this.persist();
    try { await supabase.rpc('log_audit', { p_action: 'حذف دفعة مصاريف مستوردة', p_details: fileName + ' — ' + victims.length }); } catch (_) {}
    return victims.length;
  },
  async backupDeleted(entries) {
    const { data } = await supabase.from('settings').select('value').eq('key', 'expenses_deleted_v1').maybeSingle();
    let deleted = [];
    try { deleted = data && data.value ? JSON.parse(data.value) : []; } catch (_) { deleted = []; }
    deleted = Array.isArray(deleted) ? deleted : [];
    const at = new Date().toISOString();
    entries.forEach(e => deleted.unshift({ deleted_at: at, type: e.type, item: JSON.parse(JSON.stringify(e.item)) }));
    const { error } = await supabase.from('settings').upsert({ key: 'expenses_deleted_v1', value: JSON.stringify(deleted.slice(0, 300)) }, { onConflict: 'key' });
    if (error) throw error;
  },
  async remove(id) {
    await this.hydrate();
    const item = this.get(id);
    if (!item) throw new Error('المصروف غير موجود');
    const { data: deletedRow } = await supabase.from('settings').select('value').eq('key', 'expenses_deleted_v1').maybeSingle();
    let deleted = [];
    try { deleted = deletedRow && deletedRow.value ? JSON.parse(deletedRow.value) : []; } catch (_) { deleted = []; }
    deleted = Array.isArray(deleted) ? deleted : [];
    deleted.unshift({ deleted_at: new Date().toISOString(), item: JSON.parse(JSON.stringify(item)) });
    await supabase.from('settings').upsert({ key: 'expenses_deleted_v1', value: JSON.stringify(deleted.slice(0, 100)) }, { onConflict: 'key' });
    this.cache.items = this.cache.items.filter(x => x.id !== id);
    await this.persist();
    try { await supabase.rpc('log_audit', { p_action: 'حذف مصروف', p_details: JSON.stringify({ restore_type: 'expense', item }) }); } catch (_) {}
  },
  async restoreDeleted(itemId) {
    const { data, error } = await supabase.from('settings').select('value').eq('key', 'expenses_deleted_v1').maybeSingle();
    if (error) throw error;
    let deleted = [];
    try { deleted = data && data.value ? JSON.parse(data.value) : []; } catch (_) { deleted = []; }
    const idx = (Array.isArray(deleted) ? deleted : []).findIndex(x => x.item && x.item.id === itemId);
    if (idx < 0) throw new Error('بيانات المصروف المحذوف غير موجودة');
    const snapshot = deleted[idx].item;
    snapshot.status = 'draft'; snapshot.journal_mv = '';
    await this.hydrate();
    if (deleted[idx].type === 'expense_sheet') { if (!this.sheet(snapshot.id)) this.cache.sheets.push(snapshot); }
    else if (!this.get(snapshot.id)) this.cache.items.push(snapshot);
    await this.persist();
    deleted.splice(idx, 1);
    await supabase.from('settings').upsert({ key: 'expenses_deleted_v1', value: JSON.stringify(deleted) }, { onConflict: 'key' });
    try { await supabase.rpc('log_audit', { p_action: 'استرجاع مصروف', p_details: snapshot.no || snapshot.id }); } catch (_) {}
    return snapshot;
  },
  async markPosted(id, movement) {
    const item = this.get(id);
    if (!item) throw new Error('المصروف غير موجود');
    item.status = 'posted'; item.journal_mv = movement;
    await this.persist();
  }
};
