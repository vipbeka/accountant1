/* أدوات مشتركة */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="ticon">${type === 'ok' ? '✔' : '✖'}</span><span>${esc(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
}

function openModal(id) { $('#' + id).classList.add('open'); }
function closeModal(id) { $('#' + id).classList.remove('open'); }

document.addEventListener('click', e => {
  const ov = e.target.closest('.modal-overlay');
  if (ov && e.target === ov) ov.classList.remove('open');
  if (e.target.closest('[data-close-modal]')) e.target.closest('.modal-overlay').classList.remove('open');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});

async function confirmDlg(msg) {
  return window.confirm(msg);
}

function errMsg(e) {
  return (e && (e.message || e.error_description || e.error)) || 'حدث خطأ غير متوقع';
}

/* تصدير جدول بسيط إلى إكسيل باستخدام SheetJS (يُحمَّل عبر CDN في كل صفحة) */
function exportExcel(filename, sheetName, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
