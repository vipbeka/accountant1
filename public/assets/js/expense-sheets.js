'use strict';

/* ============================================================================
   كشوف المصروفات (دفتر الصندوق) — مستند واحد بسطور متعددة مثل الفاتورة.
   مطابق لملف Excel «Financial accounts»:
     التاريخ | البيان | الوارد (Income) | المصروف (Expenses) | الرصيد بعد الحركة
   + ملخص: إجمالي الوارد / إجمالي المصروفات / الرصيد الحالي.
   هذا الملف منطق نقي (بدون DOM) حتى يُختبر في Node:
     exsCompute       — الرصيد الجاري والإجماليات
     exsParseLedger   — قراءة ملف Excel/CSV بنفس الشكل (مع تصحيح تواريخ Excel المقلوبة)
     exsJournalLines  — قيد يومية واحد للكشف كله
     exsBuildWorkbook — ملف Excel بنفس الألوان والخطوط والصيغ والتنسيق الشرطي
   ============================================================================ */

/* تعتمد على expParseAmount / expParseDate / expNorm من expenses-import.js */
const _exp = (typeof module !== 'undefined' && typeof expParseAmount === 'undefined')
  ? require('./expenses-import.js')
  : { expParseAmount, expParseDate, expNorm };

function exsRound(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function exsNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ---------- الحساب ---------- */
function exsCompute(sheet) {
  const opening = exsRound(exsNum(sheet && sheet.opening));
  let bal = opening, income = 0, expense = 0, count = 0;
  const rows = ((sheet && sheet.lines) || []).map(l => {
    const inc = exsRound(Math.abs(exsNum(l.income)));
    const out = exsRound(Math.abs(exsNum(l.expense)));
    const empty = !inc && !out && !String(l.statement || '').trim() && !l.date;
    if (!empty) { bal = exsRound(bal + inc - out); income = exsRound(income + inc); expense = exsRound(expense + out); count++; }
    return { ...l, income: inc, expense: out, balance: empty ? null : bal, empty };
  });
  const dates = rows.filter(r => !r.empty && r.date).map(r => r.date).sort();
  return {
    opening, income, expense, balance: exsRound(opening + income - expense), count, rows,
    from: dates[0] || '', to: dates[dates.length - 1] || '',
  };
}

/* ---------- الاستيراد ---------- */
const EXS_COLS = {
  date: ['date', 'التاريخ', 'تاريخ', 'تاريخ الحركه', 'day'],
  statement: ['statement', 'البيان', 'بيان', 'الوصف', 'التفاصيل', 'description', 'details', 'memo', 'narration', 'particulars', 'ملاحظات'],
  income: ['income', 'الوارد', 'وارد', 'ايراد', 'ايرادات', 'الايرادات', 'مقبوضات', 'المقبوضات', 'قبض', 'داخل', 'in', 'deposit', 'deposits', 'receipts', 'cash in', 'تمويل', 'عهده', 'العهده'],
  expense: ['expenses', 'expense', 'المصروفات', 'مصروفات', 'المصروف', 'مصروف', 'المصاريف', 'مصاريف', 'منصرف', 'المنصرف', 'صرف', 'out', 'withdrawal', 'withdrawals', 'payments', 'cash out', 'المبلغ', 'مبلغ', 'amount'],
  balance: ['balance after transaction', 'balance', 'الرصيد بعد الحركه', 'الرصيد', 'رصيد', 'running balance'],
};

function exsIsNumericCell(v) {
  if (typeof v === 'number' || v instanceof Date) return true;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return !!s && !isNaN(_exp.expParseAmount(s)) && /^[\s\d٠-٩۰-۹.,٬٫()\-+ج\.مEGPegp$£€]+$/.test(s);
}

/* عمود لكل حقل: تطابق تام أولاً ثم بداية العنوان (حتى لا يُطابق Total Expenses مثلاً) */
function exsMapHeader(row) {
  const H = row.map(v => (typeof v === 'string' ? _exp.expNorm(v) : ''));
  const map = {}, used = new Set();
  ['balance', 'date', 'income', 'expense', 'statement'].forEach(f => {
    const names = EXS_COLS[f].map(_exp.expNorm);
    let idx = -1;
    for (const n of names) { idx = H.findIndex((h, i) => !used.has(i) && h === n); if (idx >= 0) break; }
    if (idx < 0) for (const n of names) {
      if (n.length < 3) continue;
      idx = H.findIndex((h, i) => !used.has(i) && h && (h.startsWith(n + ' ') || h.startsWith(n)) && !/^(total|اجمالي|الاجمالي|مجموع|المجموع)/.test(h));
      if (idx >= 0) break;
    }
    map[f] = idx;
    if (idx >= 0) used.add(idx);
  });
  return map;
}

function exsFindHeader(all) {
  let best = -1, bestScore = 0, bestMap = null;
  for (let r = 0; r < Math.min(all.length, 25); r++) {
    const row = all[r] || [];
    const nonEmpty = row.filter(v => String(v == null ? '' : v).trim() !== '');
    if (nonEmpty.length < 2) continue;
    // صف العناوين نصي: صف الملخص (Total Income 35,900 ...) فيه أرقام فيُستبعد
    if (row.filter(exsIsNumericCell).length >= 1) continue;
    const m = exsMapHeader(row);
    if (m.income < 0 && m.expense < 0) continue;
    const score = (m.expense >= 0 ? 3 : 0) + (m.income >= 0 ? 2 : 0) + (m.date >= 0 ? 2 : 0) + (m.statement >= 0 ? 1 : 0) + (m.balance >= 0 ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = r; bestMap = m; }
  }
  return bestScore >= 3 ? { row: best, map: bestMap } : null;
}

function exsYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* مرشحات التاريخ: النص يُقرأ يوم/شهر. خلية تاريخ حقيقية قد يكون Excel قلب فيها اليوم والشهر
   (إعدادات لغة أمريكية: 1/11/26 → 11 يناير بدل 1 نوفمبر) فنعطي الاحتمالين ونختار بالتسلسل الزمني. */
function exsDateCandidates(v) {
  if (v instanceof Date && !isNaN(v)) {
    const asIs = _exp.expParseDate(v);
    const d = new Date(v.getTime() + 30000);
    const day = d.getDate(), mon = d.getMonth() + 1;
    if (day <= 12 && day !== mon) {
      const sw = _exp.expParseDate(d.getFullYear() + '-' + String(day).padStart(2, '0') + '-' + String(mon).padStart(2, '0'));
      if (sw) return [asIs, sw];
    }
    return asIs ? [asIs] : [];
  }
  const p = _exp.expParseDate(v);
  return p ? [p] : [];
}

function exsResolveDates(cands) {
  const out = cands.map(c => (c.length === 1 ? c[0] : ''));
  const fixed = [];
  for (let i = 0; i < cands.length; i++) {
    if (cands[i].length < 2) continue;
    let prev = '', next = '';
    for (let j = i - 1; j >= 0; j--) if (out[j]) { prev = out[j]; break; }
    for (let j = i + 1; j < cands.length; j++) if (cands[j].length === 1) { next = cands[j][0]; break; }
    const fits = c => (!prev || c >= prev) && (!next || c <= next);
    const [asIs, sw] = cands[i];
    let pick = asIs;
    if (!fits(asIs) && fits(sw)) pick = sw;
    else if (!fits(asIs) && !fits(sw) && prev) {
      const dist = c => Math.abs(Date.parse(c) - Date.parse(prev));
      pick = dist(sw) < dist(asIs) ? sw : asIs;
    }
    out[i] = pick;
    if (pick !== asIs) fixed.push(i);
  }
  return { dates: out, fixed };
}

/* all = sheet_to_json(header:1, raw:true, cellDates:true) */
function exsParseLedger(all, opts) {
  opts = opts || {};
  const res = { title: '', lines: [], opening: 0, warnings: [], error: '', check: null, headerRow: -1 };
  if (!Array.isArray(all) || !all.length) { res.error = 'الملف فارغ'; return res; }
  const h = exsFindHeader(all);
  if (!h) {
    res.error = 'لم يتم العثور على صف العناوين. يجب أن يحتوي الملف على عمود «Expenses / المصروفات» أو «Income / الوارد»، ويفضل «Date / التاريخ» و«Statement / البيان».';
    return res;
  }
  const { map } = h;
  res.headerRow = h.row;
  // العنوان: أول نص فوق صف العناوين ليس تسمية إجمالي
  for (let r = 0; r < h.row && !res.title; r++) {
    const t = (all[r] || []).find(v => typeof v === 'string' && v.trim() && !/^(total|current|اجمالي|إجمالي|الرصيد|column\d*)/i.test(v.trim()));
    if (t) res.title = t.trim();
  }
  // ملخص الملف (إن وجد) للتحقق: Total Income / Total Expenses / Current Balance
  const summary = {};
  for (let r = 0; r < h.row; r++) {
    const row = all[r] || [];
    row.forEach((v, i) => {
      if (typeof v !== 'string') return;
      const k = _exp.expNorm(v);
      const val = _exp.expParseAmount(row[i + 1]);
      if (isNaN(val)) return;
      if (/total income|اجمالي الوارد|اجمالي الايرادات/.test(k)) summary.income = val;
      else if (/total expense|اجمالي المصروفات|اجمالي المصاريف/.test(k)) summary.expense = val;
      else if (/current balance|الرصيد الحالي/.test(k)) summary.balance = val;
      else if (/opening|رصيد افتتاحي|الرصيد الافتتاحي|رصيد سابق/.test(k)) res.opening = val;
    });
  }

  const raw = [];
  const GAP = 15; // فجوة كبيرة من الصفوف الفارغة = نهاية الجدول
  let blank = 0, started = false;
  const stray = [];
  for (let r = h.row + 1; r < all.length; r++) {
    const row = all[r] || [];
    const isBlank = !row.slice(0, Math.max(map.date, map.statement, map.income, map.expense) + 1).some(v => String(v == null ? '' : v).trim() !== '');
    if (isBlank) { blank++; continue; }
    if (started && blank >= GAP) { stray.push(r + 1); continue; } // بيانات معزولة بعيداً عن الجدول (مكررة غالباً)
    blank = 0; started = true;
    const g = i => (i >= 0 ? row[i] : '');
    const stmt = String(g(map.statement) == null ? '' : g(map.statement)).trim();
    if (/^(total|grand total|الاجمالي|اجمالي|المجموع|الإجمالي|إجمالي)\b/i.test(_exp.expNorm(stmt)) && !g(map.date)) continue;
    const inc = map.income >= 0 ? _exp.expParseAmount(g(map.income)) : NaN;
    const out = map.expense >= 0 ? _exp.expParseAmount(g(map.expense)) : NaN;
    const bal = map.balance >= 0 ? _exp.expParseAmount(g(map.balance)) : NaN;
    if (!(Math.abs(inc) > 0) && !(Math.abs(out) > 0) && !stmt) continue; // صف رصيد فقط أو فارغ
    raw.push({ excelRow: r + 1, cands: exsDateCandidates(g(map.date)), dateRaw: g(map.date), statement: stmt,
      income: Math.abs(inc) > 0 ? exsRound(Math.abs(inc)) : 0, expense: Math.abs(out) > 0 ? exsRound(Math.abs(out)) : 0, fileBalance: bal });
  }
  if (stray.length) res.warnings.push('تم تجاهل ' + stray.length + ' صف منفصل بعيداً عن الجدول (الصف ' + stray.slice(0, 5).join('، ') + ') — غير محسوب في إجماليات الملف');
  res.ignoredRows = stray;
  const { dates, fixed } = exsResolveDates(raw.map(x => x.cands));
  if (fixed.length) res.warnings.push('تم تصحيح ' + fixed.length + ' تاريخ قلب Excel فيه اليوم والشهر (مثل 1/11 = 1 نوفمبر)');
  const badDates = raw.filter((x, i) => !dates[i] && String(x.dateRaw || '').trim()).length;
  if (badDates) res.warnings.push(badDates + ' تاريخ غير مفهوم — راجعها قبل الحفظ');

  // الرصيد الافتتاحي من عمود الرصيد في أول حركة إن لم يُذكر صراحة
  const first = raw.find(x => !isNaN(x.fileBalance));
  if (!res.opening && first && raw.indexOf(first) === 0) res.opening = exsRound(first.fileBalance - first.income + first.expense);

  res.lines = raw.map((x, i) => ({ date: dates[i] || '', statement: x.statement, income: x.income, expense: x.expense, account_id: '',
    _row: x.excelRow, _fileBalance: isNaN(x.fileBalance) ? null : x.fileBalance, _dateFixed: fixed.includes(i) }));

  // تحقق: الرصيد المحسوب مقابل عمود الرصيد وملخص الملف
  const c = exsCompute({ opening: res.opening, lines: res.lines });
  let mismatches = 0;
  c.rows.forEach((row, i) => { const fb = res.lines[i]._fileBalance; if (fb !== null && Math.abs(fb - row.balance) > 0.009) mismatches++; });
  res.check = {
    rows: res.lines.length, mismatches,
    income: c.income, expense: c.expense, balance: c.balance,
    fileIncome: summary.income, fileExpense: summary.expense, fileBalance: summary.balance,
    matches: mismatches === 0
      && (summary.income === undefined || Math.abs(summary.income - c.income) < 0.01)
      && (summary.expense === undefined || Math.abs(summary.expense - c.expense) < 0.01)
      && (summary.balance === undefined || Math.abs(summary.balance - c.balance) < 0.01),
  };
  if (!res.title) res.title = opts.fallbackTitle || 'Financial accounts';
  return res;
}

/* ---------- القيد المحاسبي (قيد واحد للكشف) ----------
   المصروفات: مدين حساب المصروف (لكل سطر حسابه أو الافتراضي) / دائن الصندوق
   الوارد:    مدين الصندوق / دائن حساب التمويل
   يُجمع الصندوق في سطر واحد بالصافي. */
function exsJournalLines(sheet) {
  const c = exsCompute(sheet);
  const errors = [];
  if (!sheet.cash_account_id) errors.push('اختر حساب الصندوق');
  if (c.income > 0 && !sheet.funding_account_id) errors.push('اختر حساب التمويل (مصدر الوارد)');
  const perAcc = new Map();
  c.rows.forEach((r, i) => {
    if (r.empty || !r.expense) return;
    const acc = r.account_id || sheet.expense_account_id;
    if (!acc) { errors.push('السطر ' + (i + 1) + ': اختر حساب المصروف أو حدد حساباً افتراضياً'); return; }
    perAcc.set(String(acc), exsRound((perAcc.get(String(acc)) || 0) + r.expense));
  });
  if (!c.count) errors.push('الكشف لا يحتوي على حركات');
  c.rows.forEach((r, i) => { if (!r.empty && !r.date) errors.push('السطر ' + (i + 1) + ': التاريخ مطلوب'); });
  if (errors.length) return { errors, lines: [] };
  const lines = [];
  perAcc.forEach((amt, acc) => lines.push({ account_id: Number(acc), debit: amt, credit: 0 }));
  if (c.income > 0) lines.push({ account_id: Number(sheet.funding_account_id), debit: 0, credit: c.income });
  const net = exsRound(c.income - c.expense);
  if (net > 0) lines.push({ account_id: Number(sheet.cash_account_id), debit: net, credit: 0 });
  if (net < 0) lines.push({ account_id: Number(sheet.cash_account_id), debit: 0, credit: -net });
  // دمج أي حساب يظهر مدين ودائن معاً (مثلاً حساب التمويل = حساب مصروف)
  const merged = new Map();
  lines.forEach(l => { const m = merged.get(l.account_id) || { account_id: l.account_id, debit: 0, credit: 0 }; m.debit = exsRound(m.debit + l.debit); m.credit = exsRound(m.credit + l.credit); merged.set(l.account_id, m); });
  const out = [...merged.values()].map(m => { const n = exsRound(m.debit - m.credit); return { account_id: m.account_id, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 }; }).filter(l => l.debit || l.credit);
  if (out.length < 2) return { errors: ['لا يمكن ترحيل قيد بسطر واحد — راجع الحسابات (الصندوق لا يكون نفس حساب المصروف/التمويل)'], lines: [] };
  return { errors: [], lines: out, totals: c };
}

/* ---------- Excel بنفس تصميم الملف الأصلي (ExcelJS) ---------- */
const EXS_STYLE = {
  titleFill: 'FF1F4E78', labelFill: 'FFD9EAF7', valueFill: 'FFE2F0D9', headFill: 'FF4472C4',
  bandFill: 'FFD9E1F2', negFill: 'FFFFC7CE', money: '#,##0.00\\ "ج.م"', num: '#,##0.00', date: 'dd/mm/yyyy',
};

function exsBuildWorkbook(ExcelJS, sheet, opts) {
  opts = opts || {};
  const c = exsCompute(sheet);
  const rows = c.rows.filter(r => !r.empty);
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.company || 'Accounting';
  wb.created = new Date();
  const name = String(opts.sheetName || 'مصروفات الشركة').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
  // طباعة: كل الأعمدة في عرض صفحة A4 واحدة وتكرار صف العناوين في كل صفحة
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }, printTitlesRow: '1:3' };
  ws.columns = [{ width: 30.28515625 }, { width: 32 }, { width: 18 }, { width: 18 }, { width: 27.42578125 }, { width: 18 }];
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const first = 4, last = Math.max(first, first + rows.length - 1);
  const op = c.opening;

  // صف 1: العنوان
  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = sheet.title || 'Financial accounts';
  t.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = fill(EXS_STYLE.titleFill);
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 27.95;

  // صف 2: الملخص بصيغ حية
  const label = (addr, text) => { const x = ws.getCell(addr); x.value = text; x.font = { name: 'Arial', size: 11, bold: true }; x.fill = fill(EXS_STYLE.labelFill); x.alignment = { horizontal: 'center' }; };
  const money = (addr, formula, result) => { const x = ws.getCell(addr); x.value = { formula, result }; x.numFmt = EXS_STYLE.money; x.font = { name: 'Arial', size: 11, bold: true }; x.fill = fill(EXS_STYLE.valueFill); x.alignment = { horizontal: 'center' }; };
  label('A2', 'Total Income'); money('B2', `SUM(C${first}:C${last})`, c.income);
  label('C2', 'Total Expenses'); money('D2', `SUM(D${first}:D${last})`, c.expense);
  label('E2', 'Current Balance'); money('F2', op ? `${op}+B2-D2` : 'B2-D2', c.balance);

  // صف 3: العناوين
  ['Date', 'Statement', 'Income', 'Expenses', 'Balance after transaction'].forEach((h, i) => {
    const x = ws.getRow(3).getCell(i + 1);
    x.value = h;
    x.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    x.fill = fill(EXS_STYLE.headFill);
    x.alignment = { horizontal: 'center', vertical: 'middle' };
    x.border = border;
  });
  ws.getRow(3).height = 30;

  // الحركات + الرصيد الجاري بصيغ (يتحدث تلقائياً عند التعديل في Excel)
  rows.forEach((r, i) => {
    const n = first + i;
    const row = ws.getRow(n);
    const [y, m, d] = String(r.date || '').split('-').map(Number);
    row.getCell(1).value = y ? new Date(Date.UTC(y, m - 1, d)) : '';
    row.getCell(1).numFmt = EXS_STYLE.date;
    row.getCell(2).value = r.statement || '';
    row.getCell(3).value = r.income || null;
    row.getCell(4).value = r.expense || null;
    const prev = i === 0 ? (op ? String(op) : '') : `E${n - 1}`;
    row.getCell(5).value = { formula: i === 0 ? `${prev ? prev + '+' : ''}C${n}-D${n}` : `IF(COUNTA(A${n}:D${n})=0,"",${prev}+C${n}-D${n})`, result: r.balance };
    for (let k = 1; k <= 5; k++) {
      const x = row.getCell(k);
      x.font = { name: 'Arial', size: 10, bold: true };
      x.alignment = { horizontal: 'center', vertical: 'middle' };
      x.border = border;
      if (k >= 3) x.numFmt = EXS_STYLE.num;
      if (i % 2 === 0) x.fill = fill(EXS_STYLE.bandFill);
    }
    row.height = 15;
  });

  ws.autoFilter = { from: 'A3', to: 'E3' };
  ws.addConditionalFormatting({
    ref: `E${first}:E${last}`,
    rules: [{ type: 'cellIs', operator: 'lessThan', formulae: [0], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: EXS_STYLE.negFill } } } }],
  });
  return wb;
}

if (typeof module !== 'undefined') module.exports = { exsCompute, exsParseLedger, exsJournalLines, exsBuildWorkbook, exsResolveDates, exsMapHeader, exsFindHeader };
