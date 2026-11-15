'use strict';
let EXP_ACCOUNTS = [], expenseEditing = null;
const EXP_TYPES = ['إيجار','كهرباء ومياه','اتصالات','نقل','صيانة','أدوات مكتبية','ضيافة','أخرى'];
function fileData(file) { return new Promise((resolve, reject) => { if (!file) return resolve(null); if (file.size > 1.5 * 1024 * 1024) return reject(new Error('حجم المرفق أكبر من 1.5 ميجابايت')); const r = new FileReader(); r.onload = () => resolve({ name:file.name, type:file.type, data:r.result }); r.onerror=()=>reject(new Error('تعذر قراءة المرفق')); r.readAsDataURL(file); }); }
const EXP_DRAFT = Drafts.register({ module: 'expenses', form: 'expense', root: '#expenseModal', recordId: () => expenseEditing });
function expenseForm(id) {
  expenseEditing = id || null; const x = id ? EXPENSES.get(id) : null;
  $('#expense-title').textContent = x ? 'تعديل المصروف ' + x.no : 'مصروف جديد';
  $('#x-date').value = x ? x.date : todayISO(); $('#x-type').value = x ? x.type : 'أخرى'; $('#x-party').value = x ? x.party || '' : '';
  $('#x-amount').value = x ? x.amount : ''; $('#x-desc').value = x ? x.description || '' : ''; $('#x-file').value = '';
  $('#x-account').value = x ? x.account_id : ''; $('#x-cash').value = x ? x.cash_account_id : ''; EXP_DRAFT.open(); openModal('expenseModal');
}
function collectExpense() { return { id: expenseEditing || undefined, date: $('#x-date').value, type: $('#x-type').value, party: $('#x-party').value.trim(), amount: $('#x-amount').value, description: $('#x-desc').value.trim(), account_id: $('#x-account').value, cash_account_id: $('#x-cash').value, region: APP.regions[0] || '', status: 'draft' }; }
async function saveExpense(status) { try { const x=collectExpense(); const f=await fileData($('#x-file').files[0]); if(f){x.file_name=f.name;x.file_type=f.type;x.file_data=f.data;} const saved=await EXPENSES.save(x); EXP_DRAFT.done(); if(status==='posted') await postExpense(saved.id,true); else {toast('تم حفظ المصروف كمسودة');closeModal('expenseModal');renderExpenses();} } catch(e){toast(errMsg(e),'err');} }
async function postExpense(id,silent) { const x=EXPENSES.get(id); if(!x||x.status==='posted') return; if(!x.account_id||!x.cash_account_id){ toast('اختر حساب المصروف وحساب الدفع لهذا المصروف قبل الترحيل','err'); return expenseForm(id); } if(!silent&&!await confirmDlg('ترحيل المصروف كقيد يومية؟')) return; try { const mv=x.no; await DB.createEntry({movement_no:mv,entry_date:x.date,region:x.region||APP.regions[0]||'',description:'مصروف ['+x.type+'] '+(x.party?'— '+x.party+' ':'')+(x.description?'— '+x.description:''),entry_type:'عادي',status:'posted',lines:[{account_id:Number(x.account_id),debit:x.amount,credit:0},{account_id:Number(x.cash_account_id),debit:0,credit:x.amount}]}); await EXPENSES.markPosted(id,mv); toast('تم ترحيل المصروف وحفظ القيد ✔'); closeModal('expenseModal'); renderExpenses(); } catch(e){toast(errMsg(e),'err');} }
async function removeExpense(id){const x=EXPENSES.get(id);if(!x)return;if(!await confirmDlg('حذف هذا المصروف؟ سيتم حفظ نسخة منه في سجل العمليات ويمكن استرجاعه كمسودة.'))return;try{if(x.status==='posted'&&x.journal_mv){try{await DB.deleteEntryByMovement(x.journal_mv);}catch(e){return toast('تعذر حذف قيد اليومية المرتبط: '+errMsg(e),'err');}}await EXPENSES.remove(id);toast('تم حذف المصروف ويمكن استرجاعه من سجل العمليات');renderExpenses();}catch(e){toast(errMsg(e),'err');}}
function accountName(id) { const a = EXP_ACCOUNTS.find(x => String(x.id) === String(id)); return a ? `${a.acc_no} - ${a.name}` : '—'; }
function printExpense(id) {
  const x = EXPENSES.get(id); if (!x) return;
  const state = x.status === 'posted' ? 'مرحل' : 'مسودة';
  const attachment = x.file_name ? `<p><b>المرفق:</b> ${esc(x.file_name)}</p>` : '';
  const html = `<div class="bar"></div><div class="pad"><h1>إيصال مصروف — ${esc(x.no)}</h1><p><b>${esc(APP.settings.company_name || 'الشركة')}</b></p><div class="meta"><div class="box"><h3>بيانات المصروف</h3><p><b>التاريخ:</b> ${esc(x.date)}</p><p><b>النوع:</b> ${esc(x.type)}</p><p><b>الجهة / المستفيد:</b> ${esc(x.party || '—')}</p><p><b>الحالة:</b> ${state}</p></div><div class="box"><h3>المبلغ</h3><p class="amt">${fmt(x.amount)} ${esc(APP.settings.currency || 'ج.م')}</p><p><b>حساب المصروف:</b> ${esc(accountName(x.account_id))}</p><p><b>الدفع من:</b> ${esc(accountName(x.cash_account_id))}</p></div></div><div class="box"><h3>البيان</h3><p>${esc(x.description || '—')}</p>${attachment}</div><div class="sigs"><div><div class="line"></div>المعد</div><div><div class="line"></div>المراجع</div><div><div class="line"></div>الختم</div></div></div>`;
  if (typeof showDoc === 'function') showDoc(html); else { const w=window.open('','_blank'); w.document.write(html); w.document.close(); w.print(); }
}
function viewExpenseFile(id){const x=EXPENSES.get(id);if(!x||!x.file_data)return;const w=window.open('','_blank');w.document.write('<iframe style="width:100%;height:96vh;border:0" src="'+x.file_data+'"></iframe>');w.document.close();}
function renderExpenses(){const q=($('#flt-q').value||'').toLowerCase(),t=$('#flt-type').value,s=$('#flt-status').value;let list=EXPENSES.cache.items.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));if(q)list=list.filter(x=>(x.no+' '+(x.party||'')+' '+(x.description||'')).toLowerCase().includes(q));if(t)list=list.filter(x=>x.type===t);if(s)list=list.filter(x=>x.status===s);$('#expense-body').innerHTML=list.map(x=>`<tr><td class="num">${esc(x.no)}</td><td class="num">${esc(x.date)}</td><td>${esc(x.type)}</td><td>${esc(x.party||'—')}</td><td>${esc(x.description||'—')}</td><td class="num">${fmt(x.amount)}</td><td>${x.status==='posted'?'<span class="badge posted">مرحل</span>':'<span class="badge draft">مسودة</span>'}</td><td class="num"><button class="btn btn-sm btn-dark" onclick="expenseForm('${x.id}')">✏️</button>${x.file_data?`<button class="btn btn-sm btn-teal" onclick="viewExpenseFile('${x.id}')">📎</button>`:''}<button class="btn btn-sm btn-gold" onclick="printExpense('${x.id}')">🖨️</button>${x.status==='draft'?`<button class="btn btn-sm btn-green" onclick="postExpense('${x.id}')">✔</button>`:''}<button class="btn btn-sm btn-red" onclick="removeExpense('${x.id}')">🗑️</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty-state">لا توجد مصاريف</td></tr>';renderImportBatches();const imported=list.find(x=>x.imported_headers&&x.imported_row);let box=document.getElementById('expense-import-preview');if(!box){box=document.createElement('div');box.id='expense-import-preview';document.querySelector('.content').appendChild(box);}box.innerHTML=imported?'<div class="panel"><div class="panel-head"><h3>الصفوف الأصلية من ملف Excel</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr>'+imported.imported_headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+list.filter(x=>x.imported_row).map(x=>'<tr>'+x.imported_headers.map((_,i)=>'<td>'+esc(x.imported_row[i]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>':'';}
function printAllExpenses(){
  const list=EXPENSES.cache.items.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  if(!list.length)return toast('لا توجد مصاريف للطباعة','err');
  const total=list.reduce((s,x)=>s+Number(x.amount||0),0);
  const rows=list.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.no)}</td><td>${esc(x.date)}</td><td>${esc(x.type)}</td><td>${esc(x.party||'—')}</td><td>${esc(x.description||'—')}</td><td class="num">${fmt(x.amount)}</td><td>${x.status==='posted'?'مرحل':'مسودة'}</td></tr>`).join('');
  const html=`<div class="bar"></div><div class="pad"><h1>كشف مصاريف الشركة</h1><p><b>${esc(APP.settings.company_name||'الشركة')}</b></p><div class="box"><p><b>تاريخ الطباعة:</b> ${esc(todayISO())}</p><p><b>عدد المصروفات:</b> ${list.length} — <b>الإجمالي:</b> <span class="amt">${fmt(total)} ${esc(APP.settings.currency||'ج.م')}</span></p></div><table class="doc-table"><thead><tr><th>م</th><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الجهة</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="6">الإجمالي</th><th>${fmt(total)}</th><th></th></tr></tfoot></table></div>`;
  if(typeof showDoc==='function')showDoc(html);
}
function buildExpenseToolbar(){ $('#toolbar').innerHTML=(APP.canWrite()?'<button class="btn btn-gold btn-sm" onclick="expenseForm()">➕ مصروف جديد</button>':'')+'<button class="btn btn-dark btn-sm" onclick="exportExpenses()">📊 تصدير Excel</button>'+'<button class="btn btn-teal btn-sm" onclick="printAllExpenses()">🖨️ طباعة الكل</button>'; }

/* قراءة الملف: قيم خام (أرقام وتواريخ حقيقية بدل النص المنسّق)، وCSV بترميز UTF-8 أو Windows-1256 العربي */
function excelRows(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=e=>{ try{
  const buf=new Uint8Array(e.target.result); let wb;
  if(/\.(csv|txt)$/i.test(file.name||'')){
    let text; try{ text=new TextDecoder('utf-8',{fatal:true}).decode(buf); }catch(_){ text=new TextDecoder('windows-1256').decode(buf); }
    wb=XLSX.read(text.replace(/^﻿/,''),{type:'string',cellDates:true,raw:false});
  } else wb=XLSX.read(buf,{type:'array',cellDates:true});
  const name=wb.SheetNames.find(n=>{const ws=wb.Sheets[n];return ws&&ws['!ref'];})||wb.SheetNames[0];
  resolve(XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:true,blankrows:false}));
}catch(x){reject(x);} }; r.onerror=()=>reject(new Error('تعذر قراءة الملف')); r.readAsArrayBuffer(file); }); }
/* حسابات افتراضية لصفوف لا تحدد حساباً: أول حساب مصروفات (يفضَّل العمومية)، والصندوق/البنك */
function expenseDefaultAccounts(){
  const exp=EXP_ACCOUNTS.filter(a=>a.type==='مصروفات');
  const def=exp.find(a=>/عموم|إدار|ادار|متنوع|اخرى|أخرى/.test(a.name||''))||exp[0]||null;
  const cash=(typeof findAccHint==='function'&&findAccHint(EXP_ACCOUNTS,['صندوق','نقد','خزين','بنك','110']))||null;
  return {defaultAccount:def,defaultCash:cash};
}
/* جلب Excel → كشف مصروفات واحد (مستند بسطور مثل الفاتورة) يُفتح للمراجعة قبل الحفظ */
async function importExpensesExcel(input){
  const file=input.files&&input.files[0]; input.value=''; if(!file)return;
  if(typeof XLSX==='undefined')return toast('لم يتم تحميل مكوّن Excel — أعد تحميل الصفحة وتحقق من الاتصال','err');
  let all;
  try{ all=await excelRows(file); }catch(e){ return toast('تعذر قراءة ملف Excel: '+errMsg(e),'err'); }
  let res=exsParseLedger(all,{fallbackTitle:file.name.replace(/\.[^.]+$/,'')});
  if(res.error){
    // ملف بصيغة «مصروف لكل صف» (المبلغ/النوع/الجهة) — يتحول أيضاً إلى كشف واحد
    const flat=expBuildImport(all,Object.assign({accounts:EXP_ACCOUNTS,today:todayISO()},expenseDefaultAccounts()));
    if(flat.error||!flat.items.length) return toast(res.error,'err');
    res={title:file.name.replace(/\.[^.]+$/,''),opening:0,warnings:flat.skipped.length?['تم تخطي '+flat.skipped.length+' صف بدون مبلغ أو صف إجمالي']:[],
      check:{rows:flat.items.length},lines:flat.items.map(x=>({date:x.date,statement:[x.description,x.party].filter(Boolean).join(' — ')||x.type,income:0,expense:x.amount,account_id:x.account_id&&String(x.account_id)!==String((expenseDefaultAccounts().defaultAccount||{}).id)?String(x.account_id):''}))};
  }
  if(!res.lines.length) return toast('لا توجد حركات في الملف','err');
  openSheet(null,{title:res.title,opening:res.opening,lines:res.lines,_meta:{file:file.name,check:res.check,warnings:res.warnings}});
}

function exportExpenses(){if(typeof XLSX==='undefined') return toast('لم يتم تحميل مكوّن Excel — أعد تحديث الصفحة أو تحقق من الاتصال بالإنترنت','err'); const rows=[['الشركة',APP.settings.company_name||''],[],['الرقم','التاريخ','النوع','الجهة','البيان','المبلغ','الحالة']];EXPENSES.cache.items.forEach(x=>rows.push([x.no,x.date,x.type,x.party||'',x.description||'',x.amount,x.status==='posted'?'مرحل':'مسودة']));exportExcel('مصاريف-الشركة.xlsx','المصاريف',rows);}

/* ============================================================================
   كشوف المصروفات — مستند واحد بسطور (مثل الفاتورة) مطابق لملف Excel «Financial accounts»
   ============================================================================ */
const SHEET_STATE = { editing: null, importMeta: null, locked: false };

function sheetAccOptions(list, selected, blankLabel) {
  return `<option value="">${esc(blankLabel || '— اختر الحساب —')}</option>` + (list || []).map(a =>
    `<option value="${esc(a.id)}" ${String(a.id) === String(selected || '') ? 'selected' : ''}>${esc(a.acc_no)} - ${esc(a.name)}</option>`).join('');
}
function sheetExpenseAccounts() { const e = EXP_ACCOUNTS.filter(a => a.type === 'مصروفات'); return e.length ? e : EXP_ACCOUNTS; }
function sheetDefaults() {
  const hint = (keys, not) => EXP_ACCOUNTS.find(a => String(a.id) !== String(not || '') && keys.some(k => String(a.name || '').includes(k) || String(a.acc_no || '').startsWith(k))) || null;
  const cash = hint(['صندوق', 'عهد', 'نقد', 'خزين', '1101']);
  const fund = hint(['بنك', 'جاري', 'تمويل', '1102'], cash && cash.id);
  const exp = expenseDefaultAccounts().defaultAccount;
  return { cash: cash ? cash.id : '', fund: fund ? fund.id : '', exp: exp ? exp.id : '' };
}

const SHEET_DRAFT = Drafts.register({
  module: 'expenses', form: 'sheet', root: '#sheetModal', recordId: () => SHEET_STATE.editing,
  rows: { container: '#s-lines', fields: ['sl-date', 'sl-stmt', 'sl-in', 'sl-out', 'sl-acc'], add: () => addSheetLine(), min: 1 },
  after: () => recalcSheet(),
});

function addSheetLine(line, focus, afterRow) {
  line = line || {};
  const tr = document.createElement('tr');
  if (line._dateFixed) tr.className = 'fixed-date';
  tr.innerHTML = `
    <td class="sl-n"></td>
    <td class="c-date"><input class="sl-date" type="date" value="${esc(line.date || '')}" ${line._dateFixed ? 'title="تم تصحيح هذا التاريخ (كان مقلوب اليوم/الشهر في Excel)"' : ''}></td>
    <td><input class="sl-stmt" value="${esc(line.statement || '')}" placeholder="البيان"></td>
    <td class="c-amt"><input class="sl-in num" type="number" step="0.01" min="0" value="${line.income ? esc(line.income) : ''}" placeholder="0.00"></td>
    <td class="c-amt"><input class="sl-out num" type="number" step="0.01" min="0" value="${line.expense ? esc(line.expense) : ''}" placeholder="0.00"></td>
    <td class="c-acc"><select class="sl-acc">${sheetAccOptions(sheetExpenseAccounts(), line.account_id, '— الافتراضي —')}</select></td>
    <td class="c-bal"><div class="sl-bal">—</div></td>
    <td class="c-act"><button type="button" class="line-del" title="إدراج سطر بعده" onclick="addSheetLine(null,true,this.closest('tr'))">➕</button><button type="button" class="line-del" title="حذف السطر" onclick="this.closest('tr').remove();recalcSheet()">🗑️</button></td>`;
  const box = $('#s-lines');
  if (afterRow && afterRow.parentNode === box) afterRow.after(tr); else box.appendChild(tr);
  if (SHEET_STATE.locked) $$('input,select,button', tr).forEach(el => { el.disabled = true; });
  recalcSheet();
  if (focus) { const d = $('.sl-date', tr); if (!d.value) d.value = lastSheetDate() || todayISO(); $('.sl-stmt', tr).focus(); }
  return tr;
}
function lastSheetDate() { const ds = $$('#s-lines .sl-date').map(i => i.value).filter(Boolean); return ds[ds.length - 1] || ''; }

function readSheetLines() {
  return $$('#s-lines tr').map(tr => ({
    date: $('.sl-date', tr).value, statement: $('.sl-stmt', tr).value,
    income: $('.sl-in', tr).value, expense: $('.sl-out', tr).value, account_id: $('.sl-acc', tr).value,
  }));
}

function recalcSheet() {
  const c = exsCompute({ opening: $('#s-opening') ? $('#s-opening').value : 0, lines: readSheetLines() });
  $$('#s-lines tr').forEach((tr, i) => {
    $('.sl-n', tr).textContent = i + 1;
    const r = c.rows[i]; const b = $('.sl-bal', tr);
    b.textContent = r.balance === null ? '—' : fmt(r.balance);
    b.classList.toggle('neg', r.balance !== null && r.balance < 0);
  });
  $('#s-tot-in').textContent = fmt(c.income);
  $('#s-tot-out').textContent = fmt(c.expense);
  $('#s-tot-bal').textContent = fmt(c.balance);
  $('#s-bal-card').classList.toggle('neg', c.balance < 0);
  $('#s-ft-in').textContent = fmt(c.income);
  $('#s-ft-out').textContent = fmt(c.expense);
  $('#s-ft-bal').textContent = fmt(c.balance);
  $('#s-count').textContent = c.count + (c.from ? ' — ' + fmtDate(c.from) + ' → ' + fmtDate(c.to) : '');
  return c;
}

document.addEventListener('input', e => { if (e.target.closest && (e.target.closest('#s-lines') || e.target.id === 's-opening')) recalcSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.closest || !e.target.closest('#s-lines')) return;
  const tr = e.target.closest('tr');
  e.preventDefault();
  if (tr === $('#s-lines').lastElementChild) addSheetLine(null, true);
  else { const next = tr.nextElementSibling; const cls = [...e.target.classList].find(c => c.startsWith('sl-')); const t = next && cls && $('.' + cls, next); if (t) t.focus(); }
});

function sortSheetLines() {
  const rows = $$('#s-lines tr');
  rows.map((tr, i) => ({ tr, i, d: $('.sl-date', tr).value || '9999' }))
    .sort((a, b) => a.d.localeCompare(b.d) || a.i - b.i)
    .forEach(x => $('#s-lines').appendChild(x.tr));
  recalcSheet();
  $('#sheetModal').dispatchEvent(new Event('change', { bubbles: true })); // حفظ المسودة
}

function fillSheetForm(sh) {
  const d = sheetDefaults();
  $('#s-title').value = sh.title || '';
  $('#s-no').value = sh.no || '';
  $('#s-opening').value = sh.opening || 0;
  $('#s-cash').innerHTML = sheetAccOptions(EXP_ACCOUNTS, sh.id ? sh.cash_account_id : (sh.cash_account_id || d.cash));
  $('#s-exp').innerHTML = sheetAccOptions(sheetExpenseAccounts(), sh.id ? sh.expense_account_id : (sh.expense_account_id || d.exp));
  $('#s-fund').innerHTML = sheetAccOptions(EXP_ACCOUNTS, sh.id ? sh.funding_account_id : (sh.funding_account_id || d.fund), '— بدون —');
  $('#s-notes').value = sh.notes || '';
  $('#s-lines').innerHTML = '';
  const lines = (sh.lines && sh.lines.length) ? sh.lines : [{ date: todayISO() }];
  lines.forEach(l => addSheetLine(l));
  recalcSheet();
}

function setSheetLocked(locked) {
  SHEET_STATE.locked = !!locked;
  $$('#sheetModal .modal-body input, #sheetModal .modal-body select, #sheetModal .sh-tools button, #s-lines button').forEach(el => { if (el.id !== 's-no') el.disabled = !!locked; });
  $('#sheet-save').style.display = locked ? 'none' : '';
  $('#sheet-post').style.display = locked ? 'none' : '';
  $$('#sheetModal [data-draft-reset]').forEach(b => { b.style.display = locked ? 'none' : ''; });
}

function importNoteHtml(meta) {
  if (!meta) return '';
  const k = meta.check || {};
  const ok = k.matches;
  const parts = [`📥 تمت قراءة <b>${k.rows || 0}</b> حركة من الملف «${esc(meta.file)}» — <b>لم يُحفظ بعد</b>، راجع ثم اضغط «حفظ الكشف».`];
  if (k.fileIncome !== undefined || k.fileBalance !== undefined || k.mismatches === 0) {
    parts.push(ok
      ? `✔ الإجماليات مطابقة للملف: الوارد ${fmt(k.income)} — المصروفات ${fmt(k.expense)} — الرصيد ${fmt(k.balance)}${k.mismatches === 0 && k.rows ? ' — والرصيد بعد كل حركة مطابق' : ''}`
      : `⚠️ اختلاف عن الملف: المحسوب (وارد ${fmt(k.income)} / مصروف ${fmt(k.expense)} / رصيد ${fmt(k.balance)})` + (k.fileBalance !== undefined ? ` — في الملف (وارد ${fmt(k.fileIncome)} / مصروف ${fmt(k.fileExpense)} / رصيد ${fmt(k.fileBalance)})` : '') + (k.mismatches ? ` — ${k.mismatches} رصيد سطر مختلف` : ''));
  }
  (meta.warnings || []).forEach(w => parts.push('• ' + esc(w)));
  return `<div class="sh-import-note ${ok ? 'ok' : 'warn'}">${parts.join('<br>')}</div>`;
}

function openSheet(id, prefill) {
  const sh = id ? EXPENSES.sheet(id) : null;
  if (id && !sh) return toast('الكشف غير موجود', 'err');
  SHEET_STATE.editing = id || null;
  SHEET_STATE.importMeta = prefill && prefill._meta ? prefill._meta : null;
  setSheetLocked(false);
  fillSheetForm(sh || prefill || { title: 'Financial accounts' });
  $('#sheet-title').textContent = sh ? `كشف مصروفات ${sh.no} — ${sh.title}` : (SHEET_STATE.importMeta ? 'كشف مصروفات من ملف Excel' : 'كشف مصروفات جديد');
  $('#sheet-import-note').innerHTML = sh && sh.status === 'posted'
    ? `<div class="sh-import-note ok">🔒 هذا الكشف مرحّل بالقيد ${esc(sh.journal_mv || sh.no)}. للتعديل: «إلغاء الترحيل» من القائمة ثم افتحه.</div>`
    : importNoteHtml(SHEET_STATE.importMeta);
  if (sh && sh.status === 'posted') { setSheetLocked(true); SHEET_DRAFT.active = false; SHEET_DRAFT.banner(null); }
  else if (SHEET_STATE.importMeta) SHEET_DRAFT.open({ form: 'sheet-import', recordId: SHEET_STATE.importMeta.file, mode: 'create' });
  else SHEET_DRAFT.open();
  openModal('sheetModal');
}
function newSheet() { openSheet(null); }

function collectSheet() {
  return {
    id: SHEET_STATE.editing || undefined,
    title: $('#s-title').value, opening: $('#s-opening').value,
    cash_account_id: $('#s-cash').value, expense_account_id: $('#s-exp').value, funding_account_id: $('#s-fund').value,
    notes: $('#s-notes').value, lines: readSheetLines(),
    imported_from: SHEET_STATE.importMeta ? SHEET_STATE.importMeta.file : '',
  };
}

async function saveSheet(status) {
  if (SHEET_STATE.locked) return;
  const btns = ['#sheet-save', '#sheet-post'].map(s => $(s));
  btns.forEach(b => { b.disabled = true; });
  try {
    const data = collectSheet();
    if (!String(data.title).trim()) throw new Error('اكتب عنوان الكشف');
    if (status === 'posted') {
      const chk = exsJournalLines(data);
      if (chk.errors.length) throw new Error(chk.errors[0]);
    }
    const rec = await EXPENSES.saveSheet(data);
    SHEET_DRAFT.done(); // حُفظ في قاعدة البيانات — احذف المسودة
    SHEET_STATE.editing = rec.id;
    SHEET_STATE.importMeta = null;
    if (status === 'posted') await postSheet(rec.id, true);
    else toast('تم حفظ الكشف ' + rec.no);
    closeModal('sheetModal');
    renderSheets();
  } catch (e) { toast(errMsg(e), 'err'); }
  finally { btns.forEach(b => { b.disabled = false; }); }
}

async function postSheet(id, silent) {
  const sh = EXPENSES.sheet(id);
  if (!sh || sh.status === 'posted') return;
  const j = exsJournalLines(sh);
  if (j.errors.length) { toast(j.errors[0], 'err'); return openSheet(id); }
  if (!silent && !await confirmDlg(`ترحيل الكشف ${sh.no} بقيد يومية واحد؟\nالمصروفات ${fmt(j.totals.expense)} — الوارد ${fmt(j.totals.income)}`)) return;
  try {
    await DB.createEntry({
      movement_no: sh.no, entry_date: j.totals.to || todayISO(), region: APP.regions[0] || '',
      description: `كشف مصروفات ${sh.no} — ${sh.title} (${fmtDate(j.totals.from)} → ${fmtDate(j.totals.to)}) — ${j.totals.count} حركة`,
      entry_type: 'عادي', status: 'posted', lines: j.lines,
    });
    await EXPENSES.markSheet(id, { status: 'posted', journal_mv: sh.no, posted_at: new Date().toISOString() });
    toast('تم ترحيل الكشف بقيد يومية واحد ✔');
    renderSheets();
  } catch (e) { toast('تعذر الترحيل: ' + errMsg(e), 'err'); }
}

async function unpostSheet(id) {
  const sh = EXPENSES.sheet(id);
  if (!sh || sh.status !== 'posted') return;
  if (!await confirmDlg(`إلغاء ترحيل الكشف ${sh.no}؟ سيُحذف قيد اليومية ${sh.journal_mv} ويعود الكشف مسودة قابلة للتعديل.`)) return;
  try {
    await DB.deleteEntryByMovement(sh.journal_mv || sh.no);
    await EXPENSES.markSheet(id, { status: 'draft', journal_mv: '' });
    toast('أُلغي الترحيل — يمكنك التعديل الآن');
    renderSheets();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function deleteSheet(id) {
  const sh = EXPENSES.sheet(id);
  if (!sh) return;
  if (sh.status === 'posted') return toast('ألغِ ترحيل الكشف أولاً ثم احذفه', 'err');
  if (!await confirmDlg(`حذف الكشف ${sh.no} «${sh.title}» بكل حركاته؟ تُحفظ نسخة في سجل العمليات ويمكن استرجاعها.`)) return;
  try { await EXPENSES.removeSheet(id); toast('تم حذف الكشف'); renderSheets(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

function renderSheets() {
  const list = (EXPENSES.cache.sheets || []).slice().sort((a, b) => String(b.no).localeCompare(String(a.no)));
  const can = APP.canWrite();
  $('#sheets-toolbar').innerHTML = (can ? '<button class="btn btn-gold btn-sm" onclick="newSheet()">➕ كشف مصروفات جديد</button><button class="btn btn-teal btn-sm" onclick="document.getElementById(\'expense-import-file\').click()">📥 جلب Excel</button>' : '');
  $('#sheets-body').innerHTML = list.map(sh => {
    const c = exsCompute(sh);
    const posted = sh.status === 'posted';
    return `<tr>
      <td class="num">${esc(sh.no)}</td><td><b>${esc(sh.title)}</b>${sh.imported_from ? `<div class="hint" style="font-size:11px">📥 ${esc(sh.imported_from)}</div>` : ''}</td>
      <td class="num">${c.from ? fmtDate(c.from) + ' → ' + fmtDate(c.to) : '—'}</td><td class="num">${c.count}</td>
      <td class="num" style="color:var(--green)">${fmt(c.income)}</td><td class="num" style="color:var(--red)">${fmt(c.expense)}</td>
      <td class="num" style="font-weight:800;color:${c.balance < 0 ? 'var(--red)' : 'var(--gold)'}">${fmt(c.balance)}</td>
      <td>${posted ? `<span class="badge posted">مرحّل ${esc(sh.journal_mv || '')}</span>` : '<span class="badge draft">مسودة</span>'}</td>
      <td class="num" style="white-space:nowrap">
        <button class="btn btn-sm btn-dark" title="${posted ? 'عرض' : 'فتح وتعديل'}" onclick="openSheet('${sh.id}')">${posted ? '👁️' : '✏️'}</button>
        <button class="btn btn-sm btn-gold" title="طباعة" onclick="printSheet('${sh.id}')">🖨️</button>
        <button class="btn btn-sm btn-teal" title="تصدير Excel بنفس التصميم" onclick="exportSheetXlsx('${sh.id}')">📊</button>
        ${can ? (posted ? `<button class="btn btn-sm btn-dark" title="إلغاء الترحيل" onclick="unpostSheet('${sh.id}')">↩️</button>`
                        : `<button class="btn btn-sm btn-green" title="ترحيل بقيد واحد" onclick="postSheet('${sh.id}')">✔</button><button class="btn btn-sm btn-red" title="حذف" onclick="deleteSheet('${sh.id}')">🗑️</button>`) : ''}
      </td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-state">لا توجد كشوف بعد — أنشئ كشفاً جديداً أو «جلب Excel»</td></tr>';
}

/* ---------- الطباعة (نفس تصميم ملف Excel) ---------- */
function sheetPrintHtml(sh) {
  const c = exsCompute(sh);
  const rows = c.rows.filter(r => !r.empty);
  const accName = id => { const a = EXP_ACCOUNTS.find(x => String(x.id) === String(id)); return a ? a.acc_no + ' - ' + a.name : '—'; };
  const sigs = (APP.settings.signatures || []).length ? APP.settings.signatures : [{ title: 'المحاسب', name: '' }, { title: 'المراجع', name: '' }, { title: 'المدير المالي', name: '' }];
  return `<div class="pad exs-print">
    <div class="exs-title">${esc(sh.title || 'Financial accounts')}</div>
    <div class="exs-meta"><span>${esc(APP.settings.company_name || '')}</span><span>كشف رقم ${esc(sh.no || '—')}</span><span>الفترة: ${c.from ? fmtDate(c.from) + ' → ' + fmtDate(c.to) : '—'}</span><span>${sh.status === 'posted' ? 'مرحّل بالقيد ' + esc(sh.journal_mv || '') : 'مسودة'}</span></div>
    <table class="exs-sum"><tr>
      <td class="l">Total Income</td><td class="v">${fmt(c.income)} ج.م</td>
      <td class="l">Total Expenses</td><td class="v">${fmt(c.expense)} ج.م</td>
      <td class="l">Current Balance</td><td class="v ${c.balance < 0 ? 'neg' : ''}">${fmt(c.balance)} ج.م</td></tr></table>
    ${c.opening ? `<p style="margin:6px 0">الرصيد الافتتاحي: <b>${fmt(c.opening)}</b></p>` : ''}
    <table class="exs-tbl"><thead><tr><th>#</th><th>Date</th><th>Statement</th><th>Income</th><th>Expenses</th><th>Balance after transaction</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${fmtDate(r.date)}</td><td class="st">${esc(r.statement || '')}${r.account_id && String(r.account_id) !== String(sh.expense_account_id) ? `<div class="acc">${esc(accName(r.account_id))}</div>` : ''}</td><td>${r.income ? fmt(r.income) : ''}</td><td>${r.expense ? fmt(r.expense) : ''}</td><td class="${r.balance < 0 ? 'neg' : ''}">${fmt(r.balance)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">الإجمالي (${c.count} حركة)</td><td>${fmt(c.income)}</td><td>${fmt(c.expense)}</td><td class="${c.balance < 0 ? 'neg' : ''}">${fmt(c.balance)}</td></tr></tfoot></table>
    <p class="exs-accs">حساب الصندوق: ${esc(accName(sh.cash_account_id))} — حساب المصروف: ${esc(accName(sh.expense_account_id))}${sh.funding_account_id ? ' — التمويل: ' + esc(accName(sh.funding_account_id)) : ''}${sh.notes ? ' — ' + esc(sh.notes) : ''}</p>
    <div class="exs-sigs">${sigs.map(s => `<div><div class="line"></div>${esc(s.title || '')}<br>${esc(s.name || '')}</div>`).join('')}</div>
  </div><style>
    #doc-print .exs-print{direction:rtl}
    #doc-print .exs-title{background:#1f4e78;color:#fff!important;font:700 22px Arial;text-align:center;padding:12px;border-radius:6px 6px 0 0}
    #doc-print .exs-meta{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:space-between;padding:8px 4px;font-size:13px;color:#444!important}
    #doc-print table.exs-sum{width:100%;border-collapse:collapse;margin:6px 0 12px}
    #doc-print .exs-sum td{padding:8px;text-align:center;font:700 13px Arial;border:1px solid #c9d6e8}
    #doc-print .exs-sum td.l{background:#d9eaf7} #doc-print .exs-sum td.v{background:#e2f0d9;direction:ltr}
    #doc-print table.exs-tbl{width:100%;border-collapse:collapse;font:700 12px Arial}
    #doc-print .exs-tbl th{background:#4472c4;color:#fff!important;padding:8px 6px;border:1px solid #3a63ad}
    #doc-print .exs-tbl td{border:1px solid #bfbfbf;padding:5px 6px;text-align:center;direction:ltr}
    #doc-print .exs-tbl td.st{direction:rtl;text-align:right}
    #doc-print .exs-tbl tbody tr:nth-child(odd) td{background:#d9e1f2}
    #doc-print .exs-tbl tfoot td{background:#f4efe3;font-weight:800}
    #doc-print .neg{background:#ffc7ce!important;color:#9c0006!important}
    #doc-print .acc{font-size:10px;color:#666!important;font-weight:400}
    #doc-print .exs-accs{font-size:12px;color:#555!important;margin:10px 0}
    #doc-print .exs-sigs{display:grid;grid-template-columns:repeat(${Math.min(sigs.length, 4)},1fr);gap:16px;text-align:center;margin-top:24px;font-size:13px}
    #doc-print .exs-sigs .line{border-top:1px solid #333;margin:36px 8px 8px}
    @media print{#doc-print .exs-tbl thead{display:table-header-group}#doc-print .exs-tbl tr{page-break-inside:avoid}}
  </style>`;
}
function printSheet(id) {
  const sh = EXPENSES.sheet(id);
  if (!sh) return;
  if (typeof showDoc === 'function') showDoc(sheetPrintHtml(sh));
}

/* ---------- تصدير Excel بنفس تصميم الملف الأصلي ---------- */
let EXCELJS_PROMISE = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!EXCELJS_PROMISE) EXCELJS_PROMISE = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/js/vendor/exceljs.min.js?v=4.4.0';
    s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS')));
    s.onerror = () => { EXCELJS_PROMISE = null; reject(new Error('تعذر تحميل مكوّن Excel')); };
    document.head.appendChild(s);
  });
  return EXCELJS_PROMISE;
}
async function downloadSheetXlsx(sh) {
  try {
    const ExcelJS = await loadExcelJS();
    const wb = exsBuildWorkbook(ExcelJS, sh, { company: APP.settings.company_name || '', sheetName: 'مصروفات الشركة' });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(sh.title || 'Financial accounts').replace(/[\\\/:*?"<>|]/g, ' ').trim() + (sh.no ? ' ' + sh.no : '') + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) { toast('تعذر إنشاء ملف Excel: ' + errMsg(e), 'err'); }
}
function exportSheetXlsx(id) { const sh = EXPENSES.sheet(id); if (sh) downloadSheetXlsx(sh); }
function exportCurrentSheet() { const d = collectSheet(); d.no = $('#s-no').value; downloadSheetXlsx(d); }

/* ---------- حذف دفعة استيراد خاطئة (من الاستيراد القديم صفاً صفاً) ---------- */
function renderImportBatches() {
  let box = document.getElementById('import-batches');
  if (!box) { box = document.createElement('div'); box.id = 'import-batches'; const p = $('#expense-body').closest('.panel'); p.insertBefore(box, p.querySelector('.tbl-wrap')); }
  const by = {};
  EXPENSES.cache.items.filter(x => x.imported_from && x.status !== 'posted').forEach(x => { by[x.imported_from] = (by[x.imported_from] || 0) + 1; });
  const files = Object.keys(by);
  box.innerHTML = files.length && APP.canWrite() ? `<div class="alert warn" style="margin:0 16px 12px;display:flex;flex-direction:column;gap:6px">
    <div>⚠️ مصاريف مستوردة صفاً صفاً كمسودات (الاستيراد القديم). إن كانت خاطئة احذف الدفعة كاملة ثم أعد «جلب Excel» ليُنشأ كشف واحد:</div>
    ${files.map(f => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${esc(f)}</b> — ${by[f]} مسودة <button class="btn btn-sm btn-red" onclick="removeImportBatch(${esc(JSON.stringify(f))})">🗑️ حذف هذه الدفعة</button></div>`).join('')}
  </div>` : '';
}
async function removeImportBatch(file) {
  const n = EXPENSES.cache.items.filter(x => x.imported_from === file && x.status !== 'posted').length;
  if (!await confirmDlg(`حذف ${n} مصروف مسودة مستورد من «${file}»؟ المرحّل لا يُحذف، وتُحفظ نسخة في سجل العمليات.`)) return;
  try { const k = await EXPENSES.removeImportedBatch(file); toast('تم حذف ' + k + ' مصروف من الدفعة'); renderExpenses(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({activePath:'expenses.html'}).then(async()=>{try{await EXPENSES.hydrate();EXP_ACCOUNTS=await DB.accounts();$('#x-account').innerHTML=accOptionsHtml(EXP_ACCOUNTS.filter(a=>a.type==='مصروفات'))||accOptionsHtml(EXP_ACCOUNTS);$('#x-cash').innerHTML=accOptionsHtml(EXP_ACCOUNTS);buildExpenseToolbar();renderSheets();renderExpenses();}catch(e){toast(errMsg(e),'err');}});
