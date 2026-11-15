'use strict';

/* استيراد المصاريف من Excel/CSV — دوال نقية قابلة للاختبار.
   أسباب ظهور «تم جلب 0 صفاً» سابقاً، وكلها معالجة هنا:
   1) كان يُفترض أن العناوين في الصف الأول دائماً (ملف التصدير نفسه يبدأ بصف «الشركة» ثم صف فارغ).
   2) الأرقام العربية (١٥٠٠) والفواصل العربية (٫ ٬) والعملة داخل الخلية كانت تعطي NaN.
   3) عمود «ضريبة القيمة المضافة» كان يُلتقط بدل عمود المبلغ لأنه يحتوي «القيمة».
   4) الحفظ كان يرفض كل صف لأن الملف لا يحوي معرّف حساب المصروف/الدفع الداخلي —
      الآن تُطابَق الحسابات بالرقم أو الاسم أو تُستخدم حسابات افتراضية. */

const EXPENSE_TYPES = ['إيجار', 'كهرباء ومياه', 'اتصالات', 'نقل', 'صيانة', 'أدوات مكتبية', 'ضيافة', 'أخرى'];

/* أسماء الأعمدة المقبولة لكل حقل. exact: تُطابق فقط إن كان العنوان مساوياً لها تماماً
   (كلمات عامة مثل «المصروف» قد تظهر داخل «حساب المصروف»). */
const EXP_COLS = {
  amount: { names: ['المبلغ', 'مبلغ', 'المبلغ المدفوع', 'قيمة المصروف', 'القيمة', 'قيمه', 'الاجمالي', 'اجمالي', 'الإجمالي', 'إجمالي', 'التكلفة', 'مدين', 'amount', 'total', 'value', 'debit', 'cost', 'sum'],
    exact: ['المصروف', 'المصاريف', 'مصروف', 'مصاريف'],
    reject: ['ضريبه', 'ضريبة', 'مضافه', 'مضافة', 'vat', 'tax', 'حساب', 'account', 'رقم', 'no', 'نوع', 'type', 'نسبه', 'نسبة', '%'] },
  date: { names: ['التاريخ', 'تاريخ', 'تاريخ الصرف', 'date', 'day'], reject: [] },
  type: { names: ['النوع', 'نوع المصروف', 'نوع', 'التصنيف', 'تصنيف', 'البند', 'الفئه', 'الفئة', 'category', 'type'], reject: ['حساب', 'account'] },
  party: { names: ['الجهة', 'الجهه', 'المستفيد', 'المورد', 'اسم المورد', 'الطرف', 'المدفوع له', 'party', 'vendor', 'supplier', 'payee'], reject: [] },
  description: { names: ['البيان', 'الوصف', 'التفاصيل', 'ملاحظات', 'ملاحظه', 'شرح', 'description', 'details', 'memo', 'notes', 'narration'], reject: [] },
  account: { names: ['حساب المصروف', 'رقم حساب المصروف', 'expense account', 'الحساب', 'account'], reject: ['الدفع', 'صندوق', 'بنك', 'cash', 'bank'] },
  cash: { names: ['الدفع من', 'حساب الدفع', 'الصندوق', 'صندوق', 'البنك', 'بنك', 'طريقة الدفع', 'paid from', 'cash', 'bank', 'payment'], reject: [] },
};

/* توحيد النص العربي: أ/إ/آ→ا، ة→ه، ى→ي، حذف التشكيل والتطويل */
function expNorm(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .toLowerCase().replace(/[_\-\/\\:()\[\]*.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* أرقام عربية/فارسية → لاتينية */
function expDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/* "١٬٥٠٠٫٥٠ ج.م" / "EGP 1,500.50" / "1.500,50" / "(250)" → رقم أو NaN */
function expParseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let s = expDigits(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/٫/g, '.').replace(/[٬،]/g, ','); // ٫ عشري، ٬ و، آلاف
  s = s.replace(/[^\d.,\-]/g, '');                                 // إزالة العملة والمسافات
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  s = s.replace(/-/g, '');
  if (!/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // الفاصل الأخير هو العشري: 1.500,50 أو 1,500.50
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // 1,500 (آلاف) أو 12,5 (عشري أوروبي)
    const parts = s.split(',');
    s = (parts.length === 2 && parts[1].length !== 3) ? parts[0] + '.' + parts[1] : parts.join('');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ''); // 1.500.000
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function expPad(n) { return String(n).padStart(2, '0'); }
function expValidYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return y + '-' + expPad(m) + '-' + expPad(d);
}

/* Date / رقم تسلسلي من Excel / نص بصيغ شائعة → YYYY-MM-DD أو '' */
function expParseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    // SheetJS ينشئ التاريخ بتوقيت الجهاز؛ نضيف نصف دقيقة لتفادي أخطاء التقريب عند منتصف الليل
    const d = new Date(v.getTime() + 30000);
    return expValidYmd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // رقم تسلسلي Excel (1954..2119)
      const d = new Date(Math.round((v - 25569) * 86400000));
      return expValidYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return '';
  }
  const s = expDigits(v).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return expValidYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    // الافتراضي يوم/شهر (الصيغة المستخدمة في مصر والمنطقة)؛ إن كان الثاني > 12 فهو شهر/يوم
    if (b > 12 && a <= 12) return expValidYmd(y, a, b);
    return expValidYmd(y, b, a);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return expParseDate(Number(s));
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return expValidYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return '';
}

/* يطابق عمود حقل: تطابق تام أولاً بترتيب الأولوية، ثم «يحتوي». */
function expFindCol(headers, field, used) {
  const spec = EXP_COLS[field];
  const H = headers.map(expNorm);
  const free = i => !(used && used.has(i)) && H[i];
  const rejected = h => spec.reject.some(r => h.includes(expNorm(r)) || h === expNorm(r));
  for (const n of spec.names.concat(spec.exact || [])) {
    const i = H.findIndex((h, k) => free(k) && h === expNorm(n));
    if (i >= 0) return i;
  }
  for (const n of spec.names) {
    const nn = expNorm(n);
    if (nn.length < 3) continue;
    const i = H.findIndex((h, k) => free(k) && h.includes(nn) && !rejected(h));
    if (i >= 0) return i;
  }
  return -1;
}

/* يبحث عن صف العناوين في أول 20 صفاً (قد تسبقه صفوف عنوان الشركة أو فراغات) */
function expDetectHeader(all) {
  let best = -1, bestScore = 0;
  const limit = Math.min(all.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = (all[r] || []).map(x => (x instanceof Date ? '' : String(x == null ? '' : x)));
    if (!row.some(x => x.trim())) continue;
    let score = 0;
    const used = new Set();
    ['amount', 'date', 'description', 'type', 'party', 'account', 'cash'].forEach(f => {
      const i = expFindCol(row, f, used);
      if (i >= 0) { used.add(i); score += f === 'amount' ? 3 : 1; }
    });
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 3 ? best : -1; // يجب على الأقل التعرف على عمود المبلغ
}

function expMapColumns(headers) {
  const used = new Set();
  const map = {};
  // المبلغ أولاً حتى لا يأخذ حقل آخر عموده
  ['amount', 'date', 'account', 'cash', 'type', 'party', 'description'].forEach(f => {
    const i = expFindCol(headers, f, used);
    map[f] = i;
    if (i >= 0) used.add(i);
  });
  return map;
}

/* مطابقة الحساب: بالمعرّف، أو رقم الحساب، أو الاسم (تام ثم جزئي)، أو "1101 - الصندوق" */
function expMatchAccount(value, accounts) {
  if (value == null || value === '' || !accounts || !accounts.length) return null;
  const raw = expDigits(value).trim();
  const byId = accounts.find(a => String(a.id) === raw);
  if (byId) return byId;
  const code = (raw.match(/^\d+/) || [''])[0];
  if (code) { const a = accounts.find(x => String(x.acc_no) === code); if (a) return a; }
  const name = expNorm(raw.replace(/^\d+\s*[-–—:]?\s*/, ''));
  if (!name) return null;
  return accounts.find(a => expNorm(a.name) === name)
    || accounts.find(a => expNorm(a.name).includes(name) || name.includes(expNorm(a.name)))
    || null;
}

function expMatchType(value) {
  const v = expNorm(value);
  if (!v) return '';
  return EXPENSE_TYPES.find(t => expNorm(t) === v)
    || EXPENSE_TYPES.find(t => expNorm(t).includes(v) || v.includes(expNorm(t)))
    || '';
}

/* الدالة الرئيسية: صفوف الورقة (header:1, raw:true) → { items, skipped, headers, headerRow, columns, error } */
function expBuildImport(all, opts) {
  opts = opts || {};
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const accounts = opts.accounts || [];
  const res = { items: [], skipped: [], headers: [], headerRow: -1, columns: null, error: '' };
  if (!Array.isArray(all) || !all.length) { res.error = 'الملف فارغ'; return res; }
  const hr = expDetectHeader(all);
  if (hr < 0) {
    const sample = (all.find(r => (r || []).some(x => String(x == null ? '' : x).trim())) || []).map(String).filter(Boolean).slice(0, 8).join('، ');
    res.error = 'لم يتم العثور على عمود المبلغ. سمِّ العمود «المبلغ» أو «Amount». العناوين الموجودة: ' + (sample || '—');
    return res;
  }
  const headers = all[hr].map(x => String(x == null ? '' : x).trim());
  const col = expMapColumns(headers);
  res.headers = headers; res.headerRow = hr; res.columns = col;
  const cell = (row, k) => (col[k] >= 0 ? row[col[k]] : '');
  const text = v => (v instanceof Date ? expParseDate(v) : String(v == null ? '' : v).trim());

  for (let r = hr + 1; r < all.length; r++) {
    const row = all[r] || [];
    if (!row.some(v => String(v == null ? '' : v).trim() !== '')) continue;
    const excelRow = r + 1;
    const amountRaw = cell(row, 'amount');
    const amount = expParseAmount(amountRaw);
    const desc = text(cell(row, 'description'));
    // صفوف الإجمالي في نهاية الجدول
    const label = expNorm(row.filter(v => typeof v === 'string').join(' '));
    if (/(^| )(الاجمالي|اجمالي|المجموع|total|grand total)( |$)/.test(label) && !text(cell(row, 'date'))) {
      res.skipped.push({ row: excelRow, reason: 'صف إجمالي' }); continue;
    }
    if (!(amount > 0)) {
      res.skipped.push({ row: excelRow, reason: amountRaw === '' || amountRaw == null ? 'المبلغ فارغ' : 'مبلغ غير صالح: ' + text(amountRaw) });
      continue;
    }
    const dateRaw = cell(row, 'date');
    const date = expParseDate(dateRaw) || today;
    const typeText = text(cell(row, 'type'));
    const type = expMatchType(typeText) || 'أخرى';
    const accRaw = text(cell(row, 'account'));
    const cashRaw = text(cell(row, 'cash'));
    const acc = expMatchAccount(accRaw, accounts) || opts.defaultAccount || null;
    const cash = expMatchAccount(cashRaw, accounts) || opts.defaultCash || null;
    const notes = [];
    if (typeText && type === 'أخرى' && expNorm(typeText) !== expNorm('أخرى')) notes.push('النوع في الملف: ' + typeText);
    if (dateRaw !== '' && dateRaw != null && !expParseDate(dateRaw)) notes.push('تاريخ غير مفهوم: ' + text(dateRaw));
    res.items.push({
      date, type,
      party: text(cell(row, 'party')),
      amount: Math.round(amount * 100) / 100,
      description: [desc].concat(notes).filter(Boolean).join(' — '),
      account_id: acc ? acc.id : '',
      cash_account_id: cash ? cash.id : '',
      status: 'draft',
      imported_row: row.map(v => (v instanceof Date ? expParseDate(v) : v)),
      imported_headers: headers,
      import_row_no: excelRow,
    });
  }
  return res;
}

if (typeof module !== 'undefined') module.exports = { expParseAmount, expParseDate, expDetectHeader, expMapColumns, expMatchAccount, expMatchType, expBuildImport, expNorm };
