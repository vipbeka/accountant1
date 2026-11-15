'use strict';

/* موارد بشرية — تُحفظ في settings (hr_store_v1) مثل بقية الإضافات،
   والقيود تُرحَّل عبر DB.createEntry. */

const HR_KEY = 'hr_store_v1';

function hrRound(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function hrMonthLast(month) {
  const [y, m] = String(month).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return month + '-' + String(last).padStart(2, '0');
}

function hrDaysInclusive(from, to) {
  if (!from || !to || from > to) return 0;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

function hrDatesInMonth(from, to, month) {
  const start = month + '-01';
  const end = hrMonthLast(month);
  const out = [];
  if (!from || !to) return out;
  let d = from > start ? from : start;
  const stop = to < end ? to : end;
  if (d > stop) return out;
  const cur = new Date(d + 'T00:00:00');
  const last = new Date(stop + 'T00:00:00');
  while (cur <= last) {
    const iso = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
    out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function hrEosPreview(emp, endDate, reason) {
  if (!emp || !emp.hire_date || !endDate || emp.hire_date > endDate) {
    return { years: 0, months: 0, factor: 0, amount: 0 };
  }
  const days = hrDaysInclusive(emp.hire_date, endDate) - 1;
  const years = days / 365.25;
  const basic = Number(emp.basic_salary || 0);
  const serviceMonths = Math.min(years, 5) * 0.5 + Math.max(0, years - 5);
  let factor = 1;
  if (reason === 'resign') {
    if (years < 2) factor = 0;
    else if (years < 5) factor = 1 / 3;
    else if (years < 10) factor = 2 / 3;
  }
  return {
    years: hrRound(years),
    months: hrRound(serviceMonths),
    factor,
    amount: hrRound(basic * serviceMonths * factor),
  };
}

/* قاعدة الـ 24 ساعة: سجل الراتب لا يظهر في كشف الطباعة إلا بعد مرور يوم كامل
   على إنشائه. المقارنة بلحظات زمنية مطلقة (ميلي ثانية منذ epoch بتوقيت UTC)
   فلا تتأثر بالمنطقة الزمنية للجهاز أو التوقيت الصيفي. */
const HR_PRINT_DELAY_MS = 24 * 60 * 60 * 1000;

function hrParseTs(ts) {
  if (ts === null || ts === undefined || ts === '') return NaN;
  if (typeof ts === 'number') return ts;
  let s = String(ts).trim();
  // Postgres: "2026-11-12 15:11:14.096437+00" -> ISO صالح لكل المتصفحات
  s = s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (s.includes('T')) s = s.replace(/(T[\d:.]+[+-]\d{2})$/, '$1:00');
  // تاريخ/وقت بلا منطقة زمنية يُفسَّر UTC (وليس توقيت الجهاز)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  return Date.parse(s);
}

/* لحظة السماح بالطباعة. السجلات القديمة بلا أي طابع زمني (أُنشئت قبل هذه القاعدة)
   تعتبر قديمة ومتاحة فوراً. */
function hrPrintableAt(p) {
  const t = hrParseTs(p && (p.created_at || p.posted_at));
  return Number.isFinite(t) ? t + HR_PRINT_DELAY_MS : 0;
}

function hrIsPrintable(p, now) {
  return (now === undefined ? Date.now() : now) >= hrPrintableAt(p);
}

const HR = {
  cache: null,

  empty() {
    return { jobs: [], employees: [], attendance: [], leaves: [], advances: [], payrolls: [], seq: {} };
  },

  uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  nextNo(prefix) {
    const year = new Date().getFullYear();
    const all = []
      .concat(this.cache.employees.map(e => e.code))
      .concat(this.cache.advances.map(a => a.no))
      .concat(this.cache.payrolls.map(p => p.no))
      .concat(this.cache.jobs.map(j => j.code));
    const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
    let max = this.cache.seq[prefix] || 0;
    all.forEach(n => {
      const m = String(n || '').match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
    this.cache.seq[prefix] = max + 1;
    return prefix + '-' + year + '-' + String(this.cache.seq[prefix]).padStart(4, '0');
  },

  async hydrate() {
    if (this.cache) return this.cache;
    const { data, error } = await supabase.from('settings').select('value').eq('key', HR_KEY).maybeSingle();
    if (error) throw error;
    const base = this.empty();
    if (data && data.value) {
      try {
        const d = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        Object.assign(base, d);
        base.jobs = base.jobs || [];
        base.employees = base.employees || [];
        base.attendance = base.attendance || [];
        base.leaves = base.leaves || [];
        base.advances = base.advances || [];
        base.payrolls = base.payrolls || [];
        base.seq = base.seq || {};
      } catch { /* keep empty */ }
    }
    this.cache = base;
    return base;
  },

  async persist() {
    const row = { key: HR_KEY, value: JSON.stringify(this.cache) };
    let res = await supabase.from('settings').upsert(row, { onConflict: 'key' });
    if (res.error) res = await supabase.from('settings').upsert(row);
    if (res.error) throw res.error;
  },

  job(id) { return this.cache.jobs.find(j => j.id === id) || null; },
  employee(id) { return this.cache.employees.find(e => e.id === id) || null; },

  async saveJob(j) {
    if (!j.title || !String(j.title).trim()) throw new Error('اسم الوظيفة مطلوب');
    await this.hydrate();
    if (!j.id) {
      j.id = this.uid();
      j.code = this.nextNo('JOB');
      this.cache.jobs.push(j);
    } else {
      const i = this.cache.jobs.findIndex(x => x.id === j.id);
      if (i < 0) throw new Error('الوظيفة غير موجودة');
      this.cache.jobs[i] = Object.assign({}, this.cache.jobs[i], j);
      j = this.cache.jobs[i];
    }
    j.title = String(j.title).trim();
    j.department = String(j.department || '').trim();
    j.basic_salary = hrRound(j.basic_salary || 0);
    j.description = String(j.description || '').trim();
    await this.persist();
    return j;
  },

  async deleteJob(id) {
    await this.hydrate();
    if (this.cache.employees.some(e => e.job_id === id && e.status !== 'ended')) {
      throw new Error('لا تحذف وظيفة مرتبطة بموظف نشط');
    }
    this.cache.jobs = this.cache.jobs.filter(j => j.id !== id);
    await this.persist();
  },

  async saveEmployee(e) {
    if (!e.name || !String(e.name).trim()) throw new Error('اسم الموظف مطلوب');
    if (!e.hire_date) throw new Error('تاريخ التعيين مطلوب');
    await this.hydrate();
    // لا حد لحجم السيرة: الملف نفسه في Supabase Storage، وهنا مرجع صغير فقط (cv_path).
    let replacedPath = '';
    if (!e.id) {
      e.id = this.uid();
      e.code = this.nextNo('HR');
      e.status = e.status || 'active';
      this.cache.employees.push(e);
    } else {
      const i = this.cache.employees.findIndex(x => x.id === e.id);
      if (i < 0) throw new Error('الموظف غير موجود');
      const prev = this.cache.employees[i];
      if (e.cv_path) {
        // سيرة جديدة مرفوعة: احذف القديمة (من التخزين أو المضمّنة) بعد نجاح الحفظ
        if (prev.cv_path && prev.cv_path !== e.cv_path) replacedPath = prev.cv_path;
        e.cv_data = '';
      } else if (!e.cv_data) {
        e.cv_name = prev.cv_name;
        e.cv_type = prev.cv_type;
        e.cv_size = prev.cv_size;
        e.cv_path = prev.cv_path;
        e.cv_data = prev.cv_data;
      }
      this.cache.employees[i] = Object.assign({}, prev, e);
      e = this.cache.employees[i];
    }
    e.name = String(e.name).trim();
    e.national_id = String(e.national_id || '').trim();
    e.phone = String(e.phone || '').trim();
    e.basic_salary = hrRound(e.basic_salary || 0);
    e.allowances = hrRound(e.allowances || 0);
    e.insurable_wage = hrRound(e.insurable_wage || e.basic_salary);
    e.insurance_pct = Number(e.insurance_pct || 0);
    e.tax_pct = Number(e.tax_pct || 0);
    e.annual_leave_days = Number(e.annual_leave_days || 21);
    await this.persist();
    if (replacedPath && typeof CV !== 'undefined') await CV.remove(replacedPath);
    try {
      if (window.EXT) {
        await EXT.hydrate();
        const party = await EXT.saveParty({
          id: e.party_id || undefined,
          kind: 'employee',
          name: e.name,
          phone: e.phone,
          salary: e.basic_salary,
          notes: 'موارد بشرية ' + e.code,
        });
        if (e.party_id !== party.id) {
          e.party_id = party.id;
          await this.persist();
        }
      }
    } catch (err) {
      if (window.toast) toast('حُفظ ملف الموظف. تعذر ربطه بدليل الأطراف: ' + (err.message || err), 'err');
    }
    return e;
  },

  async clearCv(id) {
    const e = this.employee(id);
    if (!e) return;
    const path = e.cv_path;
    e.cv_name = '';
    e.cv_type = '';
    e.cv_data = '';
    e.cv_path = '';
    e.cv_size = 0;
    await this.persist();
    if (path && typeof CV !== 'undefined') await CV.remove(path);
  },

  async deleteEmployee(id) {
    await this.hydrate();
    const emp = this.employee(id);
    if (!emp) throw new Error('الموظف غير موجود');
    const postedPay = this.cache.payrolls.some(p => p.status === 'posted' && (p.lines || []).some(l => l.employee_id === id));
    const postedAdv = this.cache.advances.some(a => a.employee_id === id && a.status === 'posted');
    if (postedPay || postedAdv || emp.eos_journal) {
      throw new Error('لا يمكن حذف الموظف لأن له مسير رواتب أو سلفة أو مكافأة نهاية خدمة مرحّلة. أنهِ الخدمة بدل الحذف حتى يبقى القيد صحيحاً.');
    }
    this.cache.employees = this.cache.employees.filter(e => e.id !== id);
    this.cache.attendance = this.cache.attendance.filter(a => a.employee_id !== id);
    this.cache.leaves = this.cache.leaves.filter(l => l.employee_id !== id);
    this.cache.advances = this.cache.advances.filter(a => a.employee_id !== id);
    await this.persist();
    if (emp.party_id && window.EXT) {
      try { await EXT.deleteParty(emp.party_id); } catch (_) { /* الطرف يبقى إن ارتبط بسند */ }
    }
    if (emp.cv_path && typeof CV !== 'undefined') await CV.remove(emp.cv_path);
  },

  leaveDaysUsed(empId, year, kind) {
    return this.cache.leaves
      .filter(l => l.employee_id === empId && l.status === 'approved' && l.kind === kind && String(l.from || '').slice(0, 4) === String(year))
      .reduce((s, l) => s + Number(l.days || 0), 0);
  },

  async saveLeave(l) {
    await this.hydrate();
    if (!l.employee_id) throw new Error('اختر الموظف');
    if (!l.from || !l.to) throw new Error('حدد تاريخ الإجازة');
    l.days = hrDaysInclusive(l.from, l.to);
    if (l.days <= 0) throw new Error('تاريخ النهاية قبل البداية');
    const emp = this.employee(l.employee_id);
    if (l.kind === 'annual' && l.status === 'approved' && emp) {
      const used = this.leaveDaysUsed(emp.id, l.from.slice(0, 4), 'annual');
      const already = l.id ? (this.cache.leaves.find(x => x.id === l.id) || {}).days || 0 : 0;
      const wasApproved = l.id && (this.cache.leaves.find(x => x.id === l.id) || {}).status === 'approved';
      const base = wasApproved ? used - Number(already) : used;
      if (base + l.days > Number(emp.annual_leave_days || 21)) {
        throw new Error('رصيد الإجازة السنوية لا يكفي. المتبقي ' + hrRound(Number(emp.annual_leave_days || 21) - base) + ' يوم');
      }
    }
    if (!l.id) {
      l.id = this.uid();
      l.status = l.status || 'pending';
      this.cache.leaves.push(l);
    } else {
      const i = this.cache.leaves.findIndex(x => x.id === l.id);
      if (i < 0) throw new Error('الإجازة غير موجودة');
      this.cache.leaves[i] = Object.assign({}, this.cache.leaves[i], l);
    }
    await this.persist();
  },

  async setLeaveStatus(id, status) {
    const l = this.cache.leaves.find(x => x.id === id);
    if (!l) throw new Error('الإجازة غير موجودة');
    if (status === 'approved' && l.kind === 'annual' && l.status !== 'approved') {
      const emp = this.employee(l.employee_id);
      const others = this.cache.leaves
        .filter(x => x.id !== l.id && x.employee_id === l.employee_id && x.status === 'approved' && x.kind === 'annual' && String(x.from).slice(0, 4) === String(l.from).slice(0, 4))
        .reduce((s, x) => s + Number(x.days || 0), 0);
      if (others + Number(l.days) > Number((emp && emp.annual_leave_days) || 21)) {
        throw new Error('رصيد الإجازة السنوية لا يكفي');
      }
    }
    l.status = status;
    await this.persist();
  },

  async saveAttendance(row) {
    await this.hydrate();
    if (!row.employee_id || !row.date) throw new Error('اختر الموظف والتاريخ');
    const dup = this.cache.attendance.find(a => a.employee_id === row.employee_id && a.date === row.date && a.id !== row.id);
    if (dup) {
      dup.status = row.status;
      dup.note = row.note || '';
    } else if (!row.id) {
      row.id = this.uid();
      this.cache.attendance.push(row);
    } else {
      const i = this.cache.attendance.findIndex(a => a.id === row.id);
      if (i < 0) throw new Error('السجل غير موجود');
      this.cache.attendance[i] = Object.assign({}, this.cache.attendance[i], row);
    }
    await this.persist();
  },

  async deleteAttendance(id) {
    this.cache.attendance = this.cache.attendance.filter(a => a.id !== id);
    await this.persist();
  },

  advanceRemain(a) {
    return hrRound(Math.max(0, Number(a.amount || 0) - Number(a.paid || 0)));
  },

  async saveAdvance(a) {
    await this.hydrate();
    if (!a.employee_id) throw new Error('اختر الموظف');
    if (!(Number(a.amount) > 0)) throw new Error('أدخل مبلغ السلفة');
    if (!a.date) throw new Error('حدد التاريخ');
    a.amount = hrRound(a.amount);
    a.installments = Math.max(1, parseInt(a.installments, 10) || 1);
    a.installment_amount = hrRound(a.amount / a.installments);
    a.paid = hrRound(a.paid || 0);
    if (!a.id) {
      a.id = this.uid();
      a.no = this.nextNo('ADV');
      a.status = 'draft';
      this.cache.advances.push(a);
    } else {
      const i = this.cache.advances.findIndex(x => x.id === a.id);
      if (i < 0) throw new Error('السلفة غير موجودة');
      if (this.cache.advances[i].status === 'posted') throw new Error('لا تعدّل سلفة مرحّلة');
      this.cache.advances[i] = Object.assign({}, this.cache.advances[i], a);
    }
    await this.persist();
    return this.cache.advances.find(x => x.id === a.id);
  },

  deductionDates(empId, month) {
    const dates = new Set();
    this.cache.attendance
      .filter(a => a.employee_id === empId && a.status === 'absent' && String(a.date).slice(0, 7) === month)
      .forEach(a => dates.add(a.date));
    this.cache.leaves
      .filter(l => l.employee_id === empId && l.status === 'approved' && l.kind === 'unpaid')
      .forEach(l => hrDatesInMonth(l.from, l.to, month).forEach(d => dates.add(d)));
    return dates;
  },

  previewPayroll(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('اختر الشهر');
    const last = hrMonthLast(month);
    const lines = [];
    this.cache.employees.filter(e => e.status !== 'ended' && e.hire_date && e.hire_date <= last).forEach(emp => {
      const basic = hrRound(emp.basic_salary || 0);
      const allowances = hrRound(emp.allowances || 0);
      const gross = hrRound(basic + allowances);
      const days = this.deductionDates(emp.id, month).size;
      const daily = basic / 30;
      const absenceDeduction = hrRound(daily * days);
      let earned = hrRound(Math.max(0, gross - absenceDeduction));
      const baseIns = hrRound(emp.insurable_wage || basic);
      let insurance = hrRound(baseIns * Number(emp.insurance_pct || 0) / 100);
      if (insurance > earned) insurance = earned;
      let tax = hrRound(Math.max(0, earned - insurance) * Number(emp.tax_pct || 0) / 100);
      let room = hrRound(earned - insurance - tax);
      if (room < 0) { tax = hrRound(Math.max(0, tax + room)); room = 0; }
      const splits = [];
      this.cache.advances
        .filter(a => a.employee_id === emp.id && a.status === 'posted' && this.advanceRemain(a) > 0)
        .forEach(a => {
          if (room <= 0) return;
          const due = Math.min(this.advanceRemain(a), Number(a.installment_amount || a.amount));
          const take = hrRound(Math.min(due, room));
          if (take > 0) {
            splits.push({ advance_id: a.id, amount: take });
            room = hrRound(room - take);
          }
        });
      const advanceDeduction = hrRound(splits.reduce((s, x) => s + x.amount, 0));
      const net = hrRound(earned - insurance - tax - advanceDeduction);
      lines.push({
        employee_id: emp.id,
        name: emp.name,
        code: emp.code,
        basic, allowances, gross, days, absenceDeduction, earned, insurance, tax, advanceDeduction, net, splits,
      });
    });
    const sum = (k) => hrRound(lines.reduce((s, l) => s + Number(l[k] || 0), 0));
    return {
      month,
      lines,
      totals: {
        earned: sum('earned'),
        insurance: sum('insurance'),
        tax: sum('tax'),
        advance: sum('advanceDeduction'),
        net: sum('net'),
      },
    };
  },

  /* مزامنة سندات صرف الرواتب مع سجل الرواتب في الموارد البشرية — في الاتجاهين.
     سابقاً كانت تُضيف فقط، فإذا حُذف السند (أو أُلغي ترحيله) يبقى الراتب «شبحاً»
     في كشف الموظف ويظهر في الطباعة. الآن أي نسخة مصدرها سند لم يعد موجوداً
     أو لم يعد مرحّلاً تُحذف فوراً. opts.fresh يعيد قراءة hr_store_v1 من القاعدة
     قبل التعديل حتى لا تُكتب نسخة قديمة فوق تغييرات صفحة أخرى. */
  async syncSalaryVouchers(vouchers, parties, opts) {
    if (!Array.isArray(vouchers)) return false; // لا تحذف شيئاً إن تعذر تحميل السندات
    if (opts && opts.fresh) this.cache = null;
    await this.hydrate();
    const posted = vouchers.filter(v => v && v.kind === 'salary' && v.status === 'posted');
    const postedById = new Map(posted.map(v => [String(v.id), v]));
    const partyList = parties || [];
    let changed = false;

    // 1) احذف الرواتب التي حُذف سندها أو أُلغي ترحيله
    const before = this.cache.payrolls.length;
    this.cache.payrolls = this.cache.payrolls.filter(p => {
      if (p.source !== 'voucher' || !p.source_voucher_id) return true;
      return postedById.has(String(p.source_voucher_id));
    });
    if (this.cache.payrolls.length !== before) changed = true;

    // 2) أضف السندات المرحّلة الجديدة، وأكمل created_at للسجلات القديمة
    for (const v of posted) {
      const existing = this.cache.payrolls.find(p => (p.source === 'voucher' && String(p.source_voucher_id) === String(v.id)) || p.no === v.no);
      if (existing) {
        if (!existing.created_at && v.created_at) { existing.created_at = v.created_at; changed = true; }
        continue;
      }
      const party = partyList.find(p => p.id === v.party_id) || null;
      let emp = this.cache.employees.find(e => e.party_id && e.party_id === v.party_id);
      if (!emp && party) emp = this.cache.employees.find(e => String(e.name || '').trim().toLowerCase() === String(party.name || '').trim().toLowerCase());
      if (!emp) continue;
      const amount = hrRound(v.amount);
      const month = String(v.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const nowIso = new Date().toISOString();
      this.cache.payrolls.push({
        id: this.uid(), no: v.no, month, status: 'posted', posted_at: nowIso,
        created_at: v.created_at || nowIso,
        source_voucher_id: v.id, source_voucher_no: v.no, source: 'voucher',
        lines: [{ employee_id: emp.id, name: emp.name, code: emp.code,
          basic: amount, allowances: 0, gross: amount, days: 0, absenceDeduction: 0,
          earned: amount, insurance: 0, tax: 0, advanceDeduction: 0, net: amount, splits: [] }],
        totals: { earned: amount, insurance: 0, tax: 0, advance: 0, net: amount },
      });
      changed = true;
    }
    if (changed) await this.persist();
    return changed;
  },

  /* ---- قاعدة الـ 24 ساعة لطباعة كشف الراتب ---- */
  printableAt(p) { return hrPrintableAt(p); },
  isPrintable(p, now) { return hrIsPrintable(p, now); },

};

if (typeof module !== 'undefined') module.exports = { hrEosPreview, hrDaysInclusive, hrDatesInMonth, hrRound, hrMonthLast, hrParseTs, hrPrintableAt, hrIsPrintable, HR_PRINT_DELAY_MS, HR };
