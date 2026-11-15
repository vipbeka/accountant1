'use strict';

/**
 * طبقة الذكاء المحاسبي — تعمل على الجداول الحالية بدون جداول جديدة.
 * استخدم SMART.validate قبل الحفظ، وSMART.analyze للوحة الذكاء.
 */
const SMART = (() => {
  const ASSET = ['أصول'];
  const LIAB = ['خصوم'];
  const EQUITY = ['حقوق ملكية'];
  const REV = ['إيرادات'];
  const EXP = ['مصروفات'];

  const TEMPLATES = [
    { key: 'capital_cash', title: 'إثبات رأس مال نقدي', hint: 'رأس مال صندوق نقد',
      lines: [['1101', 'd'], ['3101', 'c']] },
    { key: 'capital_bank', title: 'إثبات رأس مال بنك', hint: 'رأس مال إيداع بنك',
      lines: [['1102', 'd'], ['3101', 'c']] },
    { key: 'sales_cash', title: 'مبيعات نقدية', hint: 'بيع نقد مبيعات صندوق',
      lines: [['1101', 'd'], ['4101', 'c']] },
    { key: 'sales_credit', title: 'مبيعات آجلة', hint: 'بيع آجل عملاء مبيعات',
      lines: [['1201', 'd'], ['4101', 'c']] },
    { key: 'purchase_cash', title: 'مشتريات نقدية', hint: 'شراء نقد مخزون صندوق',
      lines: [['1301', 'd'], ['1101', 'c']] },
    { key: 'purchase_credit', title: 'مشتريات آجلة', hint: 'شراء آجل مخزون موردين',
      lines: [['1301', 'd'], ['2101', 'c']] },
    { key: 'rent_cash', title: 'إيجار نقدًا', hint: 'إيجار صندوق نقد',
      lines: [['5102', 'd'], ['1101', 'c']] },
    { key: 'salary_cash', title: 'رواتب نقدًا', hint: 'راتب أجور صندوق',
      lines: [['5101', 'd'], ['1101', 'c']] },
    { key: 'collect_ar', title: 'تحصيل من عميل', hint: 'تحصيل عميل صندوق بنك',
      lines: [['1101', 'd'], ['1201', 'c']] },
    { key: 'pay_ap', title: 'سداد لمورد', hint: 'سداد مورد صندوق بنك',
      lines: [['2101', 'd'], ['1101', 'c']] },
    { key: 'bank_deposit', title: 'إيداع صندوق في البنك', hint: 'إيداع بنك صندوق',
      lines: [['1102', 'd'], ['1101', 'c']] },
    { key: 'withdraw', title: 'مسحوبات شخصية', hint: 'مسحوبات صندوق مالك',
      lines: [['3102', 'd'], ['1101', 'c']] },
  ];

  const BAD_PAIRS = [
    { a: 'إيرادات', b: 'حقوق ملكية', msg: 'إيراد يُقفَل عادة على ملخص الدخل لا مباشرة على رأس المال' },
    { a: 'مصروفات', b: 'حقوق ملكية', msg: 'مصروف يُقفَل في نهاية الفترة لا مباشرة على رأس المال إلا بتوثيق' },
    { a: 'إيرادات', b: 'إيرادات', msg: 'مدين ودائن على حسابات إيراد فقط يلغي الإيراد ولا يمثّل بيعًا' },
  ];

  function typeOf(acc) { return (acc && acc.type) || ''; }
  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function validate(payload, accounts) {
    const errors = [];
    const warns = [];
    const accById = Object.fromEntries((accounts || []).map(a => [String(a.id), a]));
    const lines = (payload.lines || []).filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));

    if (!payload.entry_date) errors.push('التاريخ مطلوب');
    if (!payload.movement_no) errors.push('رقم الحركة مطلوب');
    if (!String(payload.description || '').trim() || String(payload.description).trim().length < 3)
      errors.push('البيان قصير جدًا — اكتب وصف العملية (مثال: مبيعات نقدية للعميل س)');
    if (lines.length < 2) errors.push('القيد يحتاج سطرين على الأقل');

    let td = 0, tc = 0;
    const used = [];
    lines.forEach((l, i) => {
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      if (d > 0 && c > 0) errors.push(`السطر ${i + 1}: لا يجوز مدين ودائن معًا`);
      if (d < 0 || c < 0) errors.push(`السطر ${i + 1}: مبلغ سالب`);
      td += d; tc += c;
      const acc = accById[String(l.account_id)];
      if (!acc) errors.push(`السطر ${i + 1}: حساب غير موجود`);
      else used.push({ acc, d, c });
    });
    td = r2(td); tc = r2(tc);
    if (r2(td - tc) !== 0) errors.push(`القيد غير متوازن: مدين ${td} ≠ دائن ${tc}`);
    if (td <= 0) errors.push('إجمالي القيد يجب أن يكون أكبر من صفر');

    if (used.length === 2 && used[0].acc.id === used[1].acc.id)
      errors.push('مدين ودائن على نفس الحساب — القيد يلغي نفسه ولا يغيّر أي رصيد');

    const typesD = used.filter(u => u.d > 0).map(u => typeOf(u.acc));
    const typesC = used.filter(u => u.c > 0).map(u => typeOf(u.acc));
    BAD_PAIRS.forEach(p => {
      const hit = (typesD.includes(p.a) && typesC.includes(p.b)) || (typesD.includes(p.b) && typesC.includes(p.a));
      if (hit) warns.push(p.msg);
    });

    const periodFrom = (window.APP && APP.settings && APP.settings.period_from) || '';
    const periodTo = (window.APP && APP.settings && APP.settings.period_to) || '';
    if (periodFrom && payload.entry_date < periodFrom)
      warns.push('التاريخ قبل بداية الفترة المحددة في الإعدادات');
    if (periodTo && payload.entry_date > periodTo)
      warns.push('التاريخ بعد نهاية الفترة المحددة في الإعدادات');

    const desc = String(payload.description || '');
    if (/^[A-Za-z0-9]{1,4}$/.test(desc.trim()))
      warns.push('البيان يبدو تجريبيًا وليس وصف عملية');

    return { ok: errors.length === 0, errors, warns, totals: { debit: td, credit: tc } };
  }

  function suggest(text, accounts) {
    const q = String(text || '').trim();
    if (q.length < 2) return [];
    const scored = TEMPLATES.map(t => {
      let score = 0;
      t.hint.split(/\s+/).forEach(w => { if (q.includes(w)) score += 2; });
      if (q.includes(t.title.split(' ')[0])) score += 1;
      return { ...t, score };
    }).filter(t => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);

    return scored.map(t => ({
      title: t.title,
      key: t.key,
      lines: t.lines.map(([no, side]) => {
        const acc = (accounts || []).find(a => a.acc_no === no);
        return { acc_no: no, name: acc ? acc.name : no, account_id: acc ? acc.id : '', side };
      }),
    }));
  }

  function analyze(entries, accounts) {
    const flags = [];
    const posted = (entries || []).filter(e => e.status === 'posted');
    let td = 0, tc = 0;
    const byAcc = {};
    posted.forEach(e => {
      const lines = e.lines || [];
      const ed = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const ec = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      td += ed; tc += ec;
      if (Math.abs(ed - ec) > 0.005) flags.push({ level: 'err', title: `قيد غير متزن ${e.movement_no}`, detail: `${ed} ≠ ${ec}` });
      if (lines.length === 2 && lines[0].acc_no && lines[0].acc_no === lines[1].acc_no)
        flags.push({ level: 'err', title: `قيد يلغي نفسه ${e.movement_no}`, detail: `الحساب ${lines[0].acc_no} مدين ودائن` });
      if (!e.description || String(e.description).trim().length < 3)
        flags.push({ level: 'warn', title: `بيان ضعيف ${e.movement_no}`, detail: e.description || 'فارغ' });
      lines.forEach(l => {
        const k = l.acc_no || l.account_id;
        if (!byAcc[k]) byAcc[k] = { acc_no: l.acc_no, name: l.name, d: 0, c: 0 };
        byAcc[k].d += Number(l.debit || 0);
        byAcc[k].c += Number(l.credit || 0);
      });
    });

    const balances = Object.values(byAcc).map(a => {
      const net = r2(a.d - a.c);
      return { ...a, net, side: net > 0 ? 'مدين' : net < 0 ? 'دائن' : 'صفر' };
    });

    const accByNo = Object.fromEntries((accounts || []).map(a => [a.acc_no, a]));
    let assets = 0, liab = 0, equity = 0, rev = 0, exp = 0;
    balances.forEach(b => {
      const t = (accByNo[b.acc_no] || {}).type;
      if (ASSET.includes(t)) assets += b.net;
      else if (LIAB.includes(t)) liab += -b.net;
      else if (EQUITY.includes(t)) equity += -b.net;
      else if (REV.includes(t)) rev += -b.net;
      else if (EXP.includes(t)) exp += b.net;
    });
    assets = r2(assets); liab = r2(liab); equity = r2(equity); rev = r2(rev); exp = r2(exp);
    const netIncome = r2(rev - exp);
    const equation = r2(assets - (liab + equity + netIncome));
    if (Math.abs(equation) > 0.05)
      flags.push({ level: 'err', title: 'معادلة الميزانية غير متزنة', detail: `أصول ${assets} ≠ التزامات+حقوق+صافي دخل ${r2(liab + equity + netIncome)}` });
    else
      flags.push({ level: 'ok', title: 'معادلة الميزانية متزنة', detail: `أصول ${assets} = التزامات ${liab} + حقوق ${equity} + صافي دخل ${netIncome}` });

    const zeroBalancedMove = balances.filter(b => b.d && b.c && Math.abs(b.net) < 0.005 && b.d >= 100);
    zeroBalancedMove.forEach(b => flags.push({
      level: 'warn',
      title: `حركة بلا رصيد: ${b.acc_no} ${b.name || ''}`,
      detail: `مدين ${r2(b.d)} ودائن ${r2(b.c)} — قيود عكسية أو إلغاء ذاتي`,
    }));

    const drafts = (entries || []).filter(e => e.status !== 'posted');
    if (drafts.length) flags.push({ level: 'warn', title: `${drafts.length} قيد غير مرحّل`, detail: 'لن يظهر في الأستاذ والميزان' });

    return {
      flags,
      kpis: {
        entries: (entries || []).length,
        posted: posted.length,
        drafts: drafts.length,
        movement: r2(td),
        assets, liabilities: liab, equity, revenue: rev, expenses: exp, netIncome,
        equationOk: Math.abs(equation) < 0.05,
      },
      balances: balances.sort((a, b) => String(a.acc_no).localeCompare(String(b.acc_no))),
      templates: TEMPLATES.map(t => t.title),
    };
  }

  return { TEMPLATES, validate, suggest, analyze };
})();
