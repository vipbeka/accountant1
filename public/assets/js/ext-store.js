'use strict';

/* الأقسام الجديدة — تُحفظ في قاعدة Supabase مثل القيود والحسابات.
   1) جداول parties / invoices / vouchers إن وُجدت (بعد تشغيل supabase-ext.sql)
   2) وإلا جدول settings بنفس قاعدة البيانات (مفتاح ext_store_v1)
   يُرحَّل قيد اليومية عبر DB.createEntry كما هو. */

const EXT_SETTINGS_KEY = 'ext_store_v1';

const EXT = {
  mode: 'settings',
  cache: null,
  _ready: false,

  empty() {
    return {
      parties: [],
      invoices: [],
      vouchers: [],
      seq: { INV: 0, PUR: 0, RCP: 0, PAY: 0, SAL: 0, EMP: 0, CUS: 0, VEN: 0 },
    };
  },
  uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },
  isNoTable(err) {
    const m = String((err && (err.message || err.details || err.code)) || '');
    return err && (err.code === 'PGRST205' || err.code === '42P01' || /could not find the table|does not exist|schema cache|relation .* does not exist/i.test(m));
  },

  localKey() {
    const uid = (window.APP && APP.user && APP.user.id) || 'anon';
    return 'accsys_ext_v1_' + uid;
  },

  async hydrate() {
    if (this._ready && this.cache) return this.cache;
    let fromTables = null;
    try {
      fromTables = await this.readTables();
      this.mode = 'tables';
      this.cache = fromTables;
    } catch (e) {
      if (!this.isNoTable(e)) throw e;
      this.mode = 'settings';
      this.cache = await this.readSettings();
    }

    const local = this.readLocal();
    const localHas = local && (local.parties.length || local.invoices.length || local.vouchers.length);
    const remoteEmpty = !this.cache.parties.length && !this.cache.invoices.length && !this.cache.vouchers.length;
    if (localHas && remoteEmpty) {
      this.cache = local;
      await this.persistAll();
      try { localStorage.removeItem(this.localKey()); } catch { /* ignore */ }
      toast('نُقلت بيانات الفواتير والأطراف إلى قاعدة البيانات');
    }
    this._ready = true;
    return this.cache;
  },

  readLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(this.localKey()) || '');
      if (d && typeof d === 'object') {
        d.parties = d.parties || [];
        d.invoices = d.invoices || [];
        d.vouchers = d.vouchers || [];
        d.seq = Object.assign(this.empty().seq, d.seq || {});
        return d;
      }
    } catch { /* ignore */ }
    return null;
  },

  async readSettings() {
    const { data, error } = await supabase.from('settings').select('value').eq('key', EXT_SETTINGS_KEY).maybeSingle();
    if (error) throw error;
    if (!data || !data.value) return this.empty();
    try {
      const d = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      d.parties = d.parties || [];
      d.invoices = d.invoices || [];
      d.vouchers = d.vouchers || [];
      d.seq = Object.assign(this.empty().seq, d.seq || {});
      return d;
    } catch {
      return this.empty();
    }
  },

  mapParty(r) {
    return {
      id: r.id, code: r.code, kind: r.kind, name: r.name, phone: r.phone || '',
      tax_no: r.tax_no || '', address: r.address || '', salary: Number(r.salary || 0),
      notes: r.notes || '', created_at: r.created_at,
    };
  },
  mapInv(r) {
    return {
      id: r.id, no: r.no, kind: r.kind, date: r.entry_date, region: r.region || '',
      party_id: r.party_id || '', description: r.description || '',
      tax_pct: Number(r.tax_pct || 0), subtotal: Number(r.subtotal || 0),
      tax: Number(r.tax || 0), total: Number(r.total || 0), status: r.status || 'draft',
      party_account_id: r.party_account_id || '', income_account_id: r.income_account_id || '',
      expense_account_id: r.expense_account_id || '', tax_account_id: r.tax_account_id || '',
      journal_mv: r.journal_mv || '', lines: r.lines || [],
    };
  },
  mapV(r) {
    return {
      id: r.id, no: r.no, kind: r.kind, date: r.entry_date, region: r.region || '',
      party_id: r.party_id || '', invoice_id: r.invoice_id || '',
      amount: Number(r.amount || 0), description: r.description || '',
      cash_account_id: r.cash_account_id || '', offset_account_id: r.offset_account_id || '',
      status: r.status || 'draft', journal_mv: r.journal_mv || '',
    };
  },

  async readTables() {
    const [p, i, v] = await Promise.all([
      supabase.from('parties').select('*').order('created_at'),
      supabase.from('invoices').select('*').order('entry_date', { ascending: false }),
      supabase.from('vouchers').select('*').order('entry_date', { ascending: false }),
    ]);
    if (p.error) throw p.error;
    if (i.error) throw i.error;
    if (v.error) throw v.error;
    return {
      parties: (p.data || []).map(r => this.mapParty(r)),
      invoices: (i.data || []).map(r => this.mapInv(r)),
      vouchers: (v.data || []).map(r => this.mapV(r)),
      seq: this.empty().seq,
    };
  },

  async persistSettings() {
    const { error } = await supabase.from('settings').upsert(
      { key: EXT_SETTINGS_KEY, value: JSON.stringify(this.cache) },
      { onConflict: 'key' }
    );
    if (error) throw error;
    try { await supabase.rpc('log_audit', { p_action: 'حفظ فواتير/أطراف/سندات', p_details: EXT_SETTINGS_KEY }); } catch (_) {}
  },

  async persistAll() {
    if (this.mode === 'tables') {
      for (const p of this.cache.parties) await this.upsertPartyRow(p);
      for (const inv of this.cache.invoices) await this.upsertInvoiceRow(inv);
      for (const v of this.cache.vouchers) await this.upsertVoucherRow(v);
    } else {
      await this.persistSettings();
    }
  },

  partyRow(p) {
    return {
      id: p.id, code: p.code, kind: p.kind, name: p.name, phone: p.phone || '',
      tax_no: p.tax_no || '', address: p.address || '', salary: Number(p.salary || 0),
      notes: p.notes || '', updated_at: new Date().toISOString(),
      created_by: (window.APP && APP.user && APP.user.id) || null,
    };
  },
  invoiceRow(inv) {
    return {
      id: inv.id, no: inv.no, kind: inv.kind, entry_date: inv.date, region: inv.region || '',
      party_id: inv.party_id || null, description: inv.description || '',
      tax_pct: Number(inv.tax_pct || 0), subtotal: Number(inv.subtotal || 0),
      tax: Number(inv.tax || 0), total: Number(inv.total || 0), status: inv.status || 'draft',
      party_account_id: inv.party_account_id ? Number(inv.party_account_id) : null,
      income_account_id: inv.income_account_id ? Number(inv.income_account_id) : null,
      expense_account_id: inv.expense_account_id ? Number(inv.expense_account_id) : null,
      tax_account_id: inv.tax_account_id ? Number(inv.tax_account_id) : null,
      journal_mv: inv.journal_mv || null, lines: inv.lines || [],
      updated_at: new Date().toISOString(),
      created_by: (window.APP && APP.user && APP.user.id) || null,
    };
  },
  voucherRow(v) {
    return {
      id: v.id, no: v.no, kind: v.kind, entry_date: v.date, region: v.region || '',
      party_id: v.party_id || null, invoice_id: v.invoice_id || null,
      amount: Number(v.amount || 0), description: v.description || '',
      cash_account_id: v.cash_account_id ? Number(v.cash_account_id) : null,
      offset_account_id: v.offset_account_id ? Number(v.offset_account_id) : null,
      status: v.status || 'draft', journal_mv: v.journal_mv || null,
      updated_at: new Date().toISOString(),
      created_by: (window.APP && APP.user && APP.user.id) || null,
    };
  },

  async upsertPartyRow(p) {
    const { error } = await supabase.from('parties').upsert(this.partyRow(p));
    if (error) throw error;
  },
  async upsertInvoiceRow(inv) {
    const { error } = await supabase.from('invoices').upsert(this.invoiceRow(inv));
    if (error) throw error;
  },
  async upsertVoucherRow(v) {
    const { error } = await supabase.from('vouchers').upsert(this.voucherRow(v));
    if (error) throw error;
  },

  async persistOne(kind, row) {
    if (this.mode === 'tables') {
      if (kind === 'party') await this.upsertPartyRow(row);
      else if (kind === 'invoice') await this.upsertInvoiceRow(row);
      else await this.upsertVoucherRow(row);
      try {
        await supabase.rpc('log_audit', {
          p_action: 'حفظ ' + (kind === 'party' ? 'طرف' : kind === 'invoice' ? 'فاتورة' : 'سند'),
          p_details: row.no || row.code || row.name || row.id,
        });
      } catch (_) {}
    } else {
      await this.persistSettings();
    }
  },

  nextNo(prefix) {
    const all = [
      ...this.cache.parties.map(p => p.code),
      ...this.cache.invoices.map(i => i.no),
      ...this.cache.vouchers.map(v => v.no),
    ];
    const year = new Date().getFullYear();
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    let max = this.cache.seq[prefix] || 0;
    all.forEach(n => {
      const m = String(n || '').match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
    this.cache.seq[prefix] = max + 1;
    return prefix + '-' + year + '-' + String(this.cache.seq[prefix]).padStart(4, '0');
  },

  parties() { return this.cache.parties; },
  party(id) { return this.cache.parties.find(p => p.id === id) || null; },
  invoices() { return this.cache.invoices; },
  invoice(id) { return this.cache.invoices.find(x => x.id === id) || null; },
  vouchers() { return this.cache.vouchers; },
  voucher(id) { return this.cache.vouchers.find(x => x.id === id) || null; },

  async saveParty(p) {
    if (!p.name || !String(p.name).trim()) throw new Error('اسم الطرف مطلوب');
    if (!this.cache) await this.hydrate();
    if (!p.id) {
      p.id = this.uid();
      p.code = p.code || this.nextNo(p.kind === 'employee' ? 'EMP' : p.kind === 'vendor' ? 'VEN' : 'CUS');
      p.created_at = new Date().toISOString();
      this.cache.parties.push(p);
    } else {
      const i = this.cache.parties.findIndex(x => x.id === p.id);
      if (i < 0) throw new Error('الطرف غير موجود');
      this.cache.parties[i] = Object.assign({}, this.cache.parties[i], p);
      p = this.cache.parties[i];
    }
    await this.persistOne('party', p);
    return p;
  },
  async deleteParty(id) {
    if (this.cache.invoices.some(x => x.party_id === id) || this.cache.vouchers.some(x => x.party_id === id)) {
      throw new Error('لا يمكن حذف طرف له فواتير أو سندات');
    }
    this.cache.parties = this.cache.parties.filter(p => p.id !== id);
    if (this.mode === 'tables') {
      const { error } = await supabase.from('parties').delete().eq('id', id);
      if (error) throw error;
    } else await this.persistSettings();
  },

  normalizeInvoice(inv) {
    if (!inv.kind) throw new Error('حدد نوع الفاتورة');
    if (!inv.date) throw new Error('حدد التاريخ');
    const lines = (inv.lines || []).filter(l => (l.desc || '').trim() && Number(l.qty) > 0 && Number(l.price) >= 0);
    if (!lines.length) throw new Error('أضف بندًا واحدًا على الأقل');
    inv.lines = lines.map(l => ({
      item_no: l.item_no || '',
      sku: String(l.sku || '').trim(),
      desc: String(l.desc).trim(),
      unit: String(l.unit || '').trim(),
      qty: round2(l.qty),
      price: round2(l.price),
      amount: round2(Number(l.qty) * Number(l.price)),
    }));
    inv.subtotal = round2(inv.lines.reduce((s, l) => s + l.amount, 0));
    inv.tax_pct = Number(inv.tax_pct || 0);
    inv.tax = round2(inv.subtotal * inv.tax_pct / 100);
    inv.total = round2(inv.subtotal + inv.tax);
    return inv;
  },

  async saveInvoice(inv) {
    if (!this.cache) await this.hydrate();
    this.normalizeInvoice(inv);
    if (!inv.id) {
      inv.id = this.uid();
      inv.no = inv.no || this.nextNo(inv.kind === 'purchase' ? 'PUR' : 'INV');
      inv.status = inv.status || 'draft';
      this.cache.invoices.push(inv);
    } else {
      const i = this.cache.invoices.findIndex(x => x.id === inv.id);
      if (i < 0) throw new Error('الفاتورة غير موجودة');
      if (this.cache.invoices[i].status === 'posted' && inv.status !== 'void') {
        throw new Error('لا تعدّل فاتورة مرحلة — ألغِ الترحيل أولًا');
      }
      inv.no = this.cache.invoices[i].no;
      inv.journal_mv = this.cache.invoices[i].journal_mv;
      this.cache.invoices[i] = Object.assign({}, this.cache.invoices[i], inv);
      inv = this.cache.invoices[i];
    }
    await this.persistOne('invoice', inv);
    return inv;
  },
  async deleteInvoice(id) {
    const inv = this.invoice(id);
    if (!inv) return;
    if (inv.status === 'posted') throw new Error('لا تحذف فاتورة مرحلة — ألغِ الترحيل أولًا');
    const backup = Object.assign({}, inv, { status: 'draft', journal_mv: '' });
    try { await supabase.rpc('log_audit', { p_action: 'حذف فاتورة', p_details: JSON.stringify({ restore_type: 'invoice', item: backup }) }); } catch (_) {}
    this.cache.invoices = this.cache.invoices.filter(x => x.id !== id);
    if (this.mode === 'tables') {
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
    } else await this.persistSettings();
  },
  async markInvoice(id, patch) {
    const i = this.cache.invoices.findIndex(x => x.id === id);
    if (i < 0) throw new Error('الفاتورة غير موجودة');
    Object.assign(this.cache.invoices[i], patch);
    await this.persistOne('invoice', this.cache.invoices[i]);
    return this.cache.invoices[i];
  },

  async saveVoucher(v) {
    if (!this.cache) await this.hydrate();
    if (!v.kind) throw new Error('حدد نوع السند');
    if (!v.date) throw new Error('حدد التاريخ');
    if (!(Number(v.amount) > 0)) throw new Error('أدخل مبلغًا أكبر من صفر');
    v.amount = round2(v.amount);
    if (!v.id) {
      v.id = this.uid();
      const pref = v.kind === 'receipt' ? 'RCP' : v.kind === 'salary' ? 'SAL' : 'PAY';
      v.no = v.no || this.nextNo(pref);
      v.status = v.status || 'draft';
      this.cache.vouchers.push(v);
    } else {
      const i = this.cache.vouchers.findIndex(x => x.id === v.id);
      if (i < 0) throw new Error('السند غير موجود');
      if (this.cache.vouchers[i].status === 'posted') throw new Error('لا تعدّل سندًا مرحلًا');
      v.no = this.cache.vouchers[i].no;
      this.cache.vouchers[i] = Object.assign({}, this.cache.vouchers[i], v);
      v = this.cache.vouchers[i];
    }
    await this.persistOne('voucher', v);
    return v;
  },
  async deleteVoucher(id) {
    const v = this.voucher(id);
    if (!v) return;
    if (v.status === 'posted') throw new Error('لا تحذف سندًا مرحلًا');
    this.cache.vouchers = this.cache.vouchers.filter(x => x.id !== id);
    if (this.mode === 'tables') {
      const { error } = await supabase.from('vouchers').delete().eq('id', id);
      if (error) throw error;
    } else await this.persistSettings();
  },
  async markVoucher(id, patch) {
    const i = this.cache.vouchers.findIndex(x => x.id === id);
    if (i < 0) throw new Error('السند غير موجود');
    Object.assign(this.cache.vouchers[i], patch);
    await this.persistOne('voucher', this.cache.vouchers[i]);
    return this.cache.vouchers[i];
  },

  paidOnInvoice(invId) {
    return round2(this.vouchers()
      .filter(v => v.status === 'posted' && v.invoice_id === invId)
      .reduce((s, v) => s + Number(v.amount || 0), 0));
  },
  invoiceRemain(inv) {
    return round2(Number(inv.total || 0) - this.paidOnInvoice(inv.id));
  },
  partyBalance(partyId) {
    let bal = 0;
    this.invoices().filter(i => i.party_id === partyId && i.status === 'posted').forEach(inv => {
      const rem = this.invoiceRemain(inv);
      if (inv.kind === 'sale') bal += rem; else bal -= rem;
    });
    this.vouchers().filter(v => v.status === 'posted' && v.party_id === partyId && !v.invoice_id).forEach(v => {
      if (v.kind === 'salary') return;
      if (v.kind === 'receipt') bal -= Number(v.amount); else bal += Number(v.amount);
    });
    return round2(bal);
  },
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

function accOptionsHtml(accounts, selected) {
  return '<option value="">— اختر الحساب —</option>' + (accounts || []).map(a =>
    `<option value="${a.id}" ${String(selected) === String(a.id) ? 'selected' : ''}>${esc(a.acc_no)} - ${esc(a.name)}</option>`
  ).join('');
}

function partyOptionsHtml(kind, selected) {
  const list = EXT.parties().filter(p => !kind || p.kind === kind);
  return '<option value="">— اختر —</option>' + list.map(p =>
    `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.code)} — ${esc(p.name)}</option>`
  ).join('');
}

function findAccHint(accounts, keywords) {
  const ks = keywords.map(k => k.toLowerCase());
  return (accounts || []).find(a => ks.some(k => String(a.name || '').toLowerCase().includes(k) || String(a.acc_no || '').startsWith(k)));
}

async function postExtJournal(payload) {
  if (!payload.movement_no) throw new Error('رقم الحركة مطلوب');
  if (!payload.entry_date) throw new Error('التاريخ مطلوب');
  if (!payload.region) throw new Error('اختر المنطقة');
  const lines = (payload.lines || []).filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
  if (lines.length < 2) throw new Error('القيد يحتاج حسابين على الأقل');
  const td = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const tc = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (Math.abs(td - tc) > 0.009) throw new Error('القيد غير متوازن: مدين ' + fmt(td) + ' ≠ دائن ' + fmt(tc));
  payload.lines = lines;
  payload.entry_type = payload.entry_type || 'عادي';
  payload.status = payload.status || 'posted';
  await DB.createEntry(payload);
  return payload.movement_no;
}

function invoiceJournalLines(inv) {
  const sub = round2(inv.subtotal || 0);
  const tax = round2(inv.tax || 0);
  const total = round2(sub + tax);
  const party = Number(inv.party_account_id);
  const taxAcc = Number(inv.tax_account_id);
  if (inv.kind === 'purchase') {
    const lines = [
      { account_id: Number(inv.expense_account_id), debit: sub, credit: 0 },
      { account_id: party, debit: 0, credit: total },
    ];
    if (tax > 0) lines.splice(1, 0, { account_id: taxAcc, debit: tax, credit: 0 });
    return lines;
  }
  const lines = [
    { account_id: party, debit: total, credit: 0 },
    { account_id: Number(inv.income_account_id), debit: 0, credit: tax > 0 ? sub : total },
  ];
  if (tax > 0) lines.push({ account_id: taxAcc, debit: 0, credit: tax });
  return lines;
}

async function ensureVatAccount(kind) {
  const sale = kind !== 'purchase';
  const accNo = sale ? '2202' : '1302';
  const name = sale ? 'ضريبة القيمة المضافة - مخرجات' : 'ضريبة القيمة المضافة - مدخلات';
  const type = sale ? 'خصوم' : 'أصول';
  const list = await DB.accounts();
  let acc = list.find(a => String(a.acc_no) === accNo)
    || list.find(a => /قيمة مضافة/.test(a.name || '') && (!sale || a.type === 'خصوم') && (sale || a.type === 'أصول'));
  if (acc) return acc;
  const { data, error } = await supabase.from('accounts').insert({
    acc_no: accNo, name, type, opening_balance: 0, budget: 0,
  }).select().single();
  if (error) {
    const again = await DB.accountByNo(accNo);
    if (again) return again;
    throw new Error('تعذر إضافة حساب الضريبة ' + accNo + ' — أضفه من دليل الحسابات ثم أعد الترحيل');
  }
  return data;
}

function voucherJournalLines(v) {
  const amt = Number(v.amount);
  if (v.kind === 'receipt') {
    return [
      { account_id: v.cash_account_id, debit: amt, credit: 0 },
      { account_id: v.offset_account_id, debit: 0, credit: amt },
    ];
  }
  return [
    { account_id: v.offset_account_id, debit: amt, credit: 0 },
    { account_id: v.cash_account_id, debit: 0, credit: amt },
  ];
}

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
function twoWords(n) {
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (o ? ONES[o] + ' و' : '') + TENS[t];
}
function tafqeet(n, currency = 'EGP') {
  n = round2(n);
  const whole = Math.floor(n);
  const fils = Math.round((n - whole) * 100);
  function chunk(x) {
    if (!x) return '';
    if (x < 100) return twoWords(x);
    if (x < 200) return 'مائة' + (x % 100 ? ' و' + twoWords(x % 100) : '');
    if (x < 1000) return ONES[Math.floor(x / 100)] + 'مائة' + (x % 100 ? ' و' + twoWords(x % 100) : '');
    if (x < 2000) return 'ألف' + (x % 1000 ? ' و' + chunk(x % 1000) : '');
    if (x < 1000000) {
      const th = Math.floor(x / 1000);
      const rest = x % 1000;
      const thW = th === 2 ? 'ألفان' : th < 11 ? twoWords(th) + ' آلاف' : chunk(th) + ' ألف';
      return thW + (rest ? ' و' + chunk(rest) : '');
    }
    const m = Math.floor(x / 1000000);
    const rest = x % 1000000;
    return chunk(m) + ' مليون' + (rest ? ' و' + chunk(rest) : '');
  }
  let s = chunk(whole) || 'صفر';
  const units = { USD: ['دولار أمريكي', 'سنت'], EGP: ['جنيه مصري', 'قرش'], SAR: ['ريال سعودي', 'هللة'], AED: ['درهم إماراتي', 'فلس'], EUR: ['يورو', 'سنت'] };
  const u = units[String(currency || 'EGP').toUpperCase()] || [String(currency || 'EGP').toUpperCase(), 'جزء من العملة'];
  s += ' ' + u[0];
  if (fils) s += ' و' + twoWords(fils) + ' ' + u[1];
  return s + ' فقط لا غير';
}

function money(n, currency = 'EGP') { return fmt(n) + ' ' + String(currency || 'EGP').toUpperCase(); }

function showDoc(html) {
  if (!document.getElementById('doc-print-style')) {
    const css = document.createElement('style');
    css.id = 'doc-print-style';
    css.textContent = ''
      + '#doc-print{display:none}'
      + '#doc-print.open{display:block!important;position:fixed;inset:0;z-index:400;overflow:auto;background:#e7e2d6;color:#1c1a14}'
      + '#doc-print .doc-toolbar{position:sticky;top:0;z-index:2;display:flex;gap:10px;justify-content:center;padding:12px;background:#16120c}'
      + '#doc-print .doc-sheet{max-width:900px;margin:16px auto 48px;background:#fff;color:#1c1a14;border:1px solid #d8d0be}'
      + '#doc-print .doc-sheet,#doc-print .doc-sheet *{color:#1c1a14}'
      + '#doc-print h1,#doc-print h3,#doc-print .amt,#doc-print .badge b{color:#8a6416!important}'
      + '#doc-print .bar{height:8px;background:linear-gradient(90deg,#b9862b,#e8c56a,#b9862b)}'
      + '#doc-print .head{display:flex;justify-content:space-between;gap:16px;padding:22px 28px 10px}'
      + '#doc-print .badge{display:block;border-radius:0;border:2px solid #c9a24a;padding:10px 14px;background:#fff;text-align:left}'
      + '#doc-print .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 28px 18px}'
      + '#doc-print .box{border:1px solid #e3dccb;border-radius:10px;padding:12px 14px;background:#fbf8f1}'
      + '#doc-print table.doc-table{width:calc(100% - 56px);margin:0 28px 12px;border-collapse:collapse;background:#fff}'
      + '#doc-print .tot{display:flex;justify-content:flex-end;padding:0 28px 12px}'
      + '#doc-print .tot table.doc-table{width:280px;margin:0}'
      + '#doc-print table.doc-table th,#doc-print table.doc-table td{border:1px solid #e3dccb;padding:8px 10px;background:#fff}'
      + '#doc-print table.doc-table th{background:#f4efe3}'
      + '#doc-print .num{text-align:center;direction:ltr}'
      + '#doc-print .words{margin:0 28px 12px;background:#f4efe3;border:1px dashed #c9a24a;padding:10px 14px}'
      + '#doc-print .sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:8px 28px 24px;text-align:center}'
      + '#doc-print .line{border-top:1px solid #333;margin:36px 8px 8px}'
      + '#doc-print .foot{text-align:center;padding:0 28px 18px;color:#666!important}'
      + '#doc-print .pad{padding:22px 28px}'
      + '@media print{body.doc-open .layout,body.doc-open #sidebar-backdrop,body.doc-open .menu-btn{display:none!important}'
      + '#doc-print.open{position:static!important;background:#fff!important;overflow:visible!important}'
      + '#doc-print .doc-toolbar{display:none!important}'
      + '#doc-print .doc-sheet{margin:0!important;border:none!important;max-width:none!important}}';
    document.head.appendChild(css);
  }
  let root = document.getElementById('doc-print');
  if (!root) {
    root = document.createElement('div');
    root.id = 'doc-print';
    document.body.appendChild(root);
  }
  root.innerHTML =
    '<div class="doc-toolbar">' +
      '<button type="button" class="btn btn-gold" id="doc-print-btn">طباعة</button>' +
      '<button type="button" class="btn btn-dark" id="doc-close-btn">إغلاق</button>' +
    '</div>' +
    '<div class="doc-sheet">' + html + '</div>';
  root.classList.add('open');
  document.body.classList.add('doc-open');
  document.getElementById('doc-close-btn').onclick = closeDoc;
  document.getElementById('doc-print-btn').onclick = function () { window.print(); };
}
function closeDoc() {
  const root = document.getElementById('doc-print');
  if (root) {
    root.classList.remove('open');
    root.innerHTML = '';
  }
  document.body.classList.remove('doc-open');
}

// ملفات الموارد البشرية تستخدم window.EXT لربط الموظف بدليل الأطراف.
// const لا تُنشئ خاصية على window في المتصفح، لذلك نصدّر الكائن صراحةً.
window.EXT = EXT;
