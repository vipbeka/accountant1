'use strict';

let LAST_TB = null;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cellAmt(v) {
  const n = num(v);
  return n ? fmt(n) : '';
}

/** يحول رد trial_query لأي شكل شائع إلى صفوف منتظمة */
function normalizeTrial(raw) {
  if (!raw) return { rows: [], totals: emptyTotals(), balanced: true };

  const totalsSrc = raw.totals || raw.total || {};
  const totals = {
    o_debit: num(totalsSrc.o_debit),
    o_credit: num(totalsSrc.o_credit),
    p_debit: num(totalsSrc.p_debit),
    p_credit: num(totalsSrc.p_credit),
    f_debit: num(totalsSrc.f_debit),
    f_credit: num(totalsSrc.f_credit),
  };

  const source = raw.rows || raw.data || raw;
  const rows = parseRows(source).map(finalizeRow);

  if (!totals.p_debit && !totals.p_credit && !totals.f_debit && !totals.f_credit) {
    for (const r of rows) {
      totals.o_debit += r[2]; totals.o_credit += r[3];
      totals.p_debit += r[4]; totals.p_credit += r[5];
      totals.f_debit += r[6]; totals.f_credit += r[7];
    }
  }

  const balanced = Math.abs(round2(totals.p_debit) - round2(totals.p_credit)) < 0.005
    && Math.abs(round2(totals.f_debit) - round2(totals.f_credit)) < 0.005;

  return { rows, totals, balanced };
}

function emptyTotals() {
  return { o_debit: 0, o_credit: 0, p_debit: 0, p_credit: 0, f_debit: 0, f_credit: 0 };
}

function parseRows(source) {
  if (!source) return [];

  if (Array.isArray(source) && source.length && isPlainObject(source[0])) {
    return source.map(objToRow);
  }

  if (Array.isArray(source) && source.length && Array.isArray(source[0])) {
    return source.map(arrToRow);
  }

  if (Array.isArray(source) && source.length && !isPlainObject(source[0])) {
    const out = [];
    for (let i = 0; i + 1 < source.length; ) {
      const acc = source[i];
      const name = source[i + 1];
      if (isAccNo(acc) && isName(name)) {
        out.push(arrToRow(source.slice(i, i + 8)));
        i += 8;
        continue;
      }
      i += 1;
    }
    return out;
  }

  return [];
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function isAccNo(v) {
  return v != null && v !== '' && !isPlainObject(v) && !Array.isArray(v)
    && String(v).length <= 20;
}

function isName(v) {
  return typeof v === 'string' && v.trim() !== '' && !/^-?\d+(\.\d+)?$/.test(v.trim());
}

function arrToRow(a) {
  return [
    a[0] ?? '',
    a[1] ?? '',
    num(a[2]), num(a[3]), num(a[4]), num(a[5]), num(a[6]), num(a[7]),
  ];
}

function objToRow(o) {
  return [
    o.acc_no ?? o.account_no ?? o.code ?? o[0] ?? '',
    o.name ?? o.account_name ?? o[1] ?? '',
    num(o.o_debit ?? o.opening_debit ?? o[2]),
    num(o.o_credit ?? o.opening_credit ?? o[3]),
    num(o.p_debit ?? o.period_debit ?? o.debit ?? o[4]),
    num(o.p_credit ?? o.period_credit ?? o.credit ?? o[5]),
    num(o.f_debit ?? o.closing_debit ?? o[6]),
    num(o.f_credit ?? o.closing_credit ?? o[7]),
  ];
}

function finalizeRow(r) {
  const oD = num(r[2]), oC = num(r[3]), pD = num(r[4]), pC = num(r[5]);
  let fD = num(r[6]), fC = num(r[7]);
  if (!fD && !fC && (oD || oC || pD || pC)) {
    const net = (oD + pD) - (oC + pC);
    if (net > 0) fD = net;
    else if (net < 0) fC = -net;
  }
  return [String(r[0] ?? ''), String(r[1] ?? ''), oD, oC, pD, pC, fD, fC];
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function amtCell(v, extraClass = '') {
  const n = num(v);
  const cls = `num ${extraClass}`.trim();
  return `<td class="${cls}">${n ? fmt(n) : ''}</td>`;
}

async function loadTB() {
  try {
    const raw = await DB.trialBalance($('#flt-from').value, $('#flt-to').value, $('#flt-region').value);
    const d = normalizeTrial(raw);
    LAST_TB = d;
    const t = d.totals;

    const rowsHtml = d.rows.length ? d.rows.map(r => `
      <tr>
        <td class="acc-no">${esc(r[0])}</td>
        <td class="acc-name">${esc(r[1])}</td>
        ${amtCell(r[2])}
        ${amtCell(r[3])}
        ${amtCell(r[4])}
        ${amtCell(r[5])}
        ${amtCell(r[6], 'closing-d')}
        ${amtCell(r[7], 'closing-c')}
      </tr>`).join('') : `<tr><td colspan="8" class="empty-state">لا توجد بيانات في هذه الفترة</td></tr>`;

    const badge = d.balanced
      ? `<span class="balance-pill ok">✔ الميزان متوازن — المدين يساوي الدائن</span>`
      : `<span class="balance-pill bad">✖ الميزان غير متوازن</span>`;

    $('#result').innerHTML = `
      <div class="trial-toolbar">
        ${badge}
        <span class="trial-count">${d.rows.length} حساب</span>
      </div>
      <div class="trial-cards">
        <div class="card"><div class="lbl">حركة مدين</div><div class="val teal">${fmt(t.p_debit)}</div></div>
        <div class="card teal"><div class="lbl">حركة دائن</div><div class="val gold">${fmt(t.p_credit)}</div></div>
        <div class="card green"><div class="lbl">رصيد مدين</div><div class="val green">${fmt(t.f_debit)}</div></div>
        <div class="card red"><div class="lbl">رصيد دائن</div><div class="val red">${fmt(t.f_credit)}</div></div>
      </div>
      <div class="tbl-wrap trial-wrap table-wrap">
        <table class="tbl trial-tbl data">
          <colgroup>
            <col class="col-acc">
            <col class="col-name">
            <col class="col-amt"><col class="col-amt">
            <col class="col-amt"><col class="col-amt">
            <col class="col-amt"><col class="col-amt">
          </colgroup>
          <thead>
            <tr class="trial-grp">
              <th rowspan="2">رقم الحساب</th>
              <th rowspan="2">اسم الحساب</th>
              <th colspan="2">الرصيد الافتتاحي</th>
              <th colspan="2">حركة الفترة</th>
              <th colspan="2">الرصيد الختامي</th>
            </tr>
            <tr class="trial-sub">
              <th class="num">مدين</th>
              <th class="num">دائن</th>
              <th class="num">مدين</th>
              <th class="num">دائن</th>
              <th class="num">مدين</th>
              <th class="num">دائن</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="2">الإجمالي</td>
              <td class="num">${fmt(t.o_debit)}</td>
              <td class="num">${fmt(t.o_credit)}</td>
              <td class="num">${fmt(t.p_debit)}</td>
              <td class="num">${fmt(t.p_credit)}</td>
              <td class="num closing-d">${fmt(t.f_debit)}</td>
              <td class="num closing-c">${fmt(t.f_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  } catch (e) { toast(errMsg(e), 'err'); }
}

function doExport() {
  if (!LAST_TB) return toast('اعرض الميزان أولًا', 'err');
  const rows = [['رقم الحساب', 'اسم الحساب', 'افتتاحي مدين', 'افتتاحي دائن', 'حركة مدين', 'حركة دائن', 'رصيد مدين', 'رصيد دائن']];
  LAST_TB.rows.forEach(r => rows.push(r));
  const t = LAST_TB.totals;
  rows.push(['الإجمالي', '', t.o_debit, t.o_credit, t.p_debit, t.p_credit, t.f_debit, t.f_credit]);
  exportExcel('ميزان المراجعة.xlsx', 'ميزان المراجعة', rows);
}

APP.requireAuth({ activePath: 'trial-balance.html' }).then(() => {
  $('#flt-region').innerHTML = '<option value="">كل المناطق</option>' +
    APP.regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  $('#flt-from').value = APP.settings.period_from;
  $('#flt-to').value = APP.settings.period_to;
  loadTB();
});
