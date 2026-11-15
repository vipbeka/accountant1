'use strict';

async function loadTree() {
  try {
    const tree = await DB.accountsTree();
    renderTree(tree);
  } catch (e) { toast(errMsg(e), 'err'); }
}

function countChildren(node) {
  return node.children.reduce((n, c) => n + (c.children ? c.children.length : 1), 0);
}

function renderTree(tree) {
  const c = $('#tree');
  if (!tree.length) { c.innerHTML = '<div class="empty-state"><div class="big">🌳</div>لا توجد حسابات بعد</div>'; return; }
  const canWrite = APP.canWrite();
  c.innerHTML = tree.map(typeNode => `
    <div class="tree-node tree-type">
      <div class="tree-row" onclick="toggleNext(this)">
        <span class="tw-arrow">▾</span><span class="tw-icon">📁</span>
        <b>${esc(typeNode.type)}</b><span class="tw-count">${countChildren(typeNode)} حساب</span>
      </div>
      <div class="tree-children">
        ${typeNode.children.map(g => `
          <div class="tree-node tree-group">
            <div class="tree-row" onclick="toggleNext(this)">
              <span class="tw-arrow">▾</span><span class="tw-icon">🗂️</span>
              <b>${esc(g.label)}</b><span class="tw-count">${g.children.length} حساب</span>
            </div>
            <div class="tree-children">
              ${g.children.map(a => `
                <div class="tree-node tree-account">
                  <div class="tree-row">
                    <span class="tw-arrow tw-leaf">•</span><span class="tw-icon">📄</span>
                    <span class="tw-no">${esc(a.acc_no)}</span> — ${esc(a.name)}
                    ${a.budget > 0 ? `<span class="tw-budget">ميزانية: ${fmt(a.budget)}</span>` : ''}
                    ${canWrite ? `<span class="tree-act">
                      <button class="btn btn-sm btn-dark act-btn" title="تعديل" onclick="location.href='accounts.html?q=${encodeURIComponent(a.acc_no)}'">✏️</button>
                      <button class="btn btn-sm btn-red act-btn" title="حذف" onclick="delTreeAcc(${a.id}, '${esc(a.acc_no)}')">🗑️</button>
                    </span>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function toggleNext(row) {
  const kids = row.nextElementSibling;
  if (!kids) return;
  const isHidden = kids.style.display === 'none';
  kids.style.display = isHidden ? '' : 'none';
  const arrow = row.querySelector('.tw-arrow');
  if (arrow) arrow.textContent = isHidden ? '▾' : '▸';
}
function expandAll() {
  $$('.tree-children').forEach(c => c.style.display = '');
  $$('.tw-arrow').forEach(a => a.textContent = '▾');
}
function collapseAll() {
  $$('.tree-children .tree-children').forEach(c => c.style.display = 'none');
  $$('.tree-children .tree-children').forEach(c => { c.previousElementSibling.querySelector('.tw-arrow').textContent = '▸'; });
}

async function delTreeAcc(id, no) {
  if (!await confirmDlg(`حذف الحساب ${no}؟ لا يمكن الحذف إذا كان له حركات.`)) return;
  try { await DB.deleteAccount(id); toast('تم حذف الحساب'); loadTree(); }
  catch (e) { toast(errMsg(e), 'err'); }
}

async function wipeTree() {
  if (!await confirmDlg('تحذير نهائي ⚠️ هتحذف الشجرة كاملة (كل الحسابات وكل القيود) نهائيًا. متأكد؟')) return;
  if (!await confirmDlg('تأكيد أخير: نفّذ مسح الشجرة الآن؟')) return;
  try {
    const d = await DB.wipeAccounts();
    toast(`تم مسح الشجرة: ${d.deleted_accounts} حساب و${d.deleted_entries} قيد`);
    loadTree();
  } catch (e) { toast(errMsg(e), 'err'); }
}

APP.requireAuth({ activePath: 'accounts-tree.html' }).then(() => {
  if (APP.isAdmin()) {
    $('#admin-wipe-btn').innerHTML = `<button class="btn btn-red btn-sm" onclick="wipeTree()">🗑️ مسح الشجرة كاملة</button>`;
  }
  loadTree();
});
