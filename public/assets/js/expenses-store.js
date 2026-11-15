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
    this.cache.seq = Number(this.cache.seq || 0);
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
    if (!this.get(snapshot.id)) this.cache.items.push(snapshot);
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
