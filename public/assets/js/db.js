'use strict';

/* طبقة الوصول للبيانات — تلتف حول Supabase (جداول + دوال RPC) */
const DB = {
  /* ---------------- الحسابات ---------------- */
  async accounts(q = '') {
    let query = supabase.from('accounts').select('*');
    if (q) query = query.or(`acc_no.ilike.%${q}%,name.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).sort((a, b) => (a.acc_no.length - b.acc_no.length) || a.acc_no.localeCompare(b.acc_no));
  },
  async accountByNo(acc_no) {
    const { data, error } = await supabase.from('accounts').select('*').eq('acc_no', acc_no).maybeSingle();
    if (error) throw error;
    return data;
  },
  async createAccount(d) {
    const dup = await this.accountByNo(d.acc_no);
    if (dup) throw new Error(`رقم الحساب ${d.acc_no} موجود بالفعل`);
    const { data, error } = await supabase.from('accounts').insert({
      acc_no: d.acc_no, name: d.name, type: d.type || '',
      opening_balance: Number(d.opening_balance || 0), budget: Number(d.budget || 0),
    }).select().single();
    if (error) throw error;
    await supabase.rpc('log_audit', { p_action: 'إضافة حساب', p_details: `${d.acc_no} - ${d.name}` });
    return data;
  },
  async updateAccount(id, d) {
    const { data: dup } = await supabase.from('accounts').select('id').eq('acc_no', d.acc_no).neq('id', id).maybeSingle();
    if (dup) throw new Error(`رقم الحساب ${d.acc_no} مستخدم بالفعل في حساب آخر`);
    const { error } = await supabase.from('accounts').update({
      acc_no: d.acc_no, name: d.name, type: d.type || '',
      opening_balance: Number(d.opening_balance || 0), budget: Number(d.budget || 0),
    }).eq('id', id);
    if (error) throw error;
    await supabase.rpc('log_audit', { p_action: 'تعديل حساب', p_details: `${d.acc_no} - ${d.name}` });
  },
  async deleteAccount(id) {
    const { error } = await supabase.rpc('delete_account_safe', { p_id: id });
    if (error) throw error;
  },
  async wipeAccounts() {
    const { data, error } = await supabase.rpc('wipe_accounts');
    if (error) throw error;
    return data;
  },
  async bulkBudget(items) {
    for (const it of items) {
      await supabase.from('accounts').update({ budget: Number(it.budget || 0) }).eq('id', it.id);
    }
    await supabase.rpc('log_audit', { p_action: 'تحديث ميزانيات', p_details: `${items.length} حساب` });
  },
  async accountsTree() {
    const { data, error } = await supabase.rpc('accounts_tree');
    if (error) throw error;
    return data.tree;
  },

  /* ---------------- دفتر اليومية ---------------- */
  async journalList(filters = {}) {
    let q = supabase.from('journal_entries').select('*, journal_lines(id, account_id, debit, credit, accounts(acc_no, name))');
    if (filters.from) q = q.gte('entry_date', filters.from);
    if (filters.to) q = q.lte('entry_date', filters.to);
    if (filters.region) q = q.eq('region', filters.region);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.type) q = q.eq('entry_type', filters.type);
    if (filters.query) q = q.or(`movement_no.ilike.%${filters.query}%,description.ilike.%${filters.query}%`);
    q = q.order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(filters.limit || 500);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(e => ({
      ...e,
      lines: (e.journal_lines || []).map(l => ({
        id: l.id, account_id: l.account_id, acc_no: l.accounts?.acc_no, name: l.accounts?.name,
        debit: l.debit, credit: l.credit,
      })),
      total_debit: round2((e.journal_lines || []).reduce((s, l) => s + Number(l.debit || 0), 0)),
      total_credit: round2((e.journal_lines || []).reduce((s, l) => s + Number(l.credit || 0), 0)),
    }));
  },
  async createEntry(payload) {
    const { data, error } = await supabase.rpc('create_journal_entry', { payload });
    if (error) throw error;
    return data;
  },
  async updateEntry(id, payload) {
    const { error } = await supabase.rpc('update_journal_entry', { p_id: id, payload });
    if (error) throw error;
  },
  async deleteEntry(id) {
    const { error } = await supabase.rpc('delete_journal_entry', { p_id: id });
    if (error) throw error;
  },
  async deleteEntryByMovement(movementNo) {
    const { data, error } = await supabase.from('journal_entries').select('id').eq('movement_no', movementNo).limit(1).maybeSingle();
    if (error) throw error;
    if (data && data.id) await this.deleteEntry(data.id);
  },
  async postEntry(id) {
    const { error } = await supabase.rpc('post_journal_entry', { p_id: id });
    if (error) throw error;
  },
  async unpostEntry(id) {
    const { error } = await supabase.rpc('unpost_journal_entry', { p_id: id });
    if (error) throw error;
  },
  async bulkDeleteJournal(scope, month) {
    const { data, error } = await supabase.rpc('bulk_delete_journal', { p_scope: scope, p_month: month || null });
    if (error) throw error;
    return data;
  },

  /* ---------------- الأستاذ / ميزان المراجعة / الموازنة / التقارير ---------------- */
  async ledger(acc_no, from, to, region) {
    const { data, error } = await supabase.rpc('ledger_query', {
      p_acc_no: acc_no, p_from: from || null, p_to: to || null, p_region: region || null,
    });
    if (error) throw error;
    if (data.error) throw new Error(data.error);
    return data;
  },
  async trialBalance(from, to, region) {
    const { data, error } = await supabase.rpc('trial_query', { p_from: from || null, p_to: to || null, p_region: region || null });
    if (error) throw error;
    return data;
  },
  async budget(from, to, region, type) {
    const { data, error } = await supabase.rpc('budget_query', {
      p_from: from || null, p_to: to || null, p_region: region || null, p_type: type || null,
    });
    if (error) throw error;
    return data;
  },
  async incomeStatement(from, to, region) {
    const { data, error } = await supabase.rpc('income_query', { p_from: from || null, p_to: to || null, p_region: region || null });
    if (error) throw error;
    return data;
  },
  async balanceSheet(from, to, region) {
    const { data, error } = await supabase.rpc('balance_query', { p_from: from || null, p_to: to || null, p_region: region || null });
    if (error) throw error;
    return data;
  },
  async cashFlow(from, to, region) {
    const { data, error } = await supabase.rpc('cashflow_query', { p_from: from || null, p_to: to || null, p_region: region || null });
    if (error) throw error;
    return data;
  },
  async dashboard() {
    const { data, error } = await supabase.rpc('dashboard_stats');
    if (error) throw error;
    return data;
  },

  /* ---------------- المناطق ---------------- */
  async regionsAll() {
    const { data, error } = await supabase.from('regions').select('*').order('id');
    if (error) throw error;
    const withUsage = await Promise.all((data || []).map(async r => {
      const { count } = await supabase.from('journal_entries').select('id', { count: 'exact', head: true }).eq('region', r.name);
      return { ...r, usage_count: count || 0 };
    }));
    return withUsage;
  },
  async addRegion(name) {
    const { error } = await supabase.from('regions').insert({ name });
    if (error) throw new Error(`المنطقة «${name}» موجودة بالفعل`);
    await supabase.rpc('log_audit', { p_action: 'إضافة منطقة', p_details: name });
  },
  async renameRegion(id, name) {
    const { error } = await supabase.rpc('rename_region', { p_id: id, p_name: name });
    if (error) throw error;
  },
  async setRegionActive(id, active) {
    const { error } = await supabase.from('regions').update({ is_active: active }).eq('id', id);
    if (error) throw error;
    await supabase.rpc('log_audit', { p_action: active ? 'تفعيل منطقة' : 'تعطيل منطقة', p_details: String(id) });
  },
  async deleteRegion(id) {
    const { error } = await supabase.rpc('delete_region_safe', { p_id: id });
    if (error) throw error;
  },

  /* ---------------- الإعدادات ---------------- */
  async saveSettings(d) {
    const company = (d.company_name || '').trim() || 'اسم الشركة';
    await supabase.from('settings').upsert({ key: 'company_name', value: company });
    if (d.period_from) await supabase.from('settings').upsert({ key: 'period_from', value: d.period_from });
    if (d.period_to) await supabase.from('settings').upsert({ key: 'period_to', value: d.period_to });
    if (Array.isArray(d.signatures)) {
      const clean = d.signatures.filter(s => s.title && s.name).map(s => ({ title: s.title.trim(), name: s.name.trim() }));
      await supabase.from('settings').upsert({ key: 'signatures', value: JSON.stringify(clean) });
    }
    await supabase.rpc('log_audit', { p_action: 'تعديل الإعدادات', p_details: company });
  },

  /* ---------------- المستخدمون ---------------- */
  async usersList() {
    const { data, error } = await supabase.from('profiles').select('id, username, full_name, role, security_question, created_at').order('created_at');
    if (error) throw error;
    return data;
  },
  async callManageUsers(body) {
    const roleAliases = { 'مسؤول الحسابات': 'accounts_manager', 'مدير النظام': 'admin', 'محاسب': 'accountant', 'مشاهدة فقط': 'viewer' };
    const request = Object.assign({}, body, body && body.role ? { role: roleAliases[body.role] || body.role } : {});
    const { data: edgeData, error: edgeError } = await supabase.functions.invoke('manage-users', { body: request });
    if (!edgeError && edgeData) {
      if (edgeData.error) throw new Error(edgeData.error);
      return edgeData;
    }
    const args = {
      p_action: request.action,
      p_user_id: request.user_id || null,
      p_username: request.username || null,
      p_password: request.password || null,
      p_full_name: request.full_name || null,
      p_role: request.role || null,
      p_security_question: request.security_question || null,
      p_security_answer: request.security_answer || null,
    };
    const { data, error } = await supabase.rpc('admin_manage_user', args);
    if (error) {
      const raw = error.message || '';
      if (/Could not find the function|PGRST202|does not exist/i.test(raw)) {
        const setupErr = new Error('SETUP_SQL_REQUIRED');
        setupErr.code = 'SETUP_SQL_REQUIRED';
        throw setupErr;
      }
      throw new Error(raw);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  },
  async recoverAccount(body) {
    const { data, error } = await supabase.rpc('recover_account', {
      p_action: body.action,
      p_username: body.username,
      p_answer: body.answer || null,
      p_new_password: body.new_password || null,
    });
    if (error) throw new Error(error.message);
    if (data && data.error) throw new Error(data.error);
    return data;
  },
  async changeMyPassword(oldPwd, newPwd) {
    if (newPwd.length < 8) throw new Error('كلمة المرور الجديدة 8 أحرف على الأقل');
    if (newPwd === oldPwd) throw new Error('كلمة المرور الجديدة مختلفة عن الحالية');
    if (!/[A-Za-z]/.test(newPwd) || !/\d/.test(newPwd)) throw new Error('كلمة المرور يجب أن تحتوي على حروف وأرقام');
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: APP.user.email, password: oldPwd,
    });
    if (reauthErr) throw new Error('كلمة المرور الحالية غير صحيحة');
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) throw error;
    await supabase.rpc('log_audit', { p_action: 'تغيير كلمة مروره الشخصية', p_details: '' });
  },
  async updateMyProfile(d) {
    const { data, error } = await supabase.from('profiles').update({
      full_name: String(d.full_name || '').trim(),
      phone: String(d.phone || '').trim(),
      job_title: String(d.job_title || '').trim(),
    }).eq('id', APP.user.id).select('id, username, full_name, role, phone, job_title, created_at').single();
    if (error) throw error;
    await supabase.rpc('log_audit', { p_action: 'تعديل الملف الشخصي', p_details: data.username });
    return data;
  },

  /* ---------------- سجل العمليات ---------------- */
  async auditLog() {
    const { data, error } = await supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(300);
    if (error) throw error;
    return data;
  },
};

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
