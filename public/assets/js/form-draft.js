'use strict';

/* ============================================================================
   Drafts — محرك موحّد للحفظ التلقائي لكل نماذج ونوافذ النظام.

   مفتاح كل مسودة يُولَّد ديناميكياً بنمط ثابت:
       draft_<module>_<form>_<create|edit>_<recordId|new>
   ويُخزَّن في localStorage تحت مساحة المستخدم الحالي:
       accsys:<userId>:draft_...
   فلا تتصادم مسودتا نموذجين أو سجلين أو مستخدمين أبداً.

   التسجيل (مرة واحدة لكل نموذج):
       const D = Drafts.register({
         module: 'invoices', form: 'invoice',
         root: '#invModal',                 // عنصر أو محدد أو دالة تعيد العنصر
         recordId: () => editingId,          // null = إنشاء جديد
         fields: [...ids] | undefined,       // افتراضياً: كل حقل له id داخل root
         exclude: [...ids],                  // حقول لا تُحفظ (أسرار مثلاً)
         rows: { container: '#i-lines', fields: ['ln-qty', ...], add: () => addInvLine() },
         keyed: { selector: '.budget-input', id: el => el.dataset.id },
         custom: { collect: () => x, apply: x => {} },
         after: () => recalcInv(),          // بعد الاسترجاع/المسح
       });
   ثم في نهاية دالة فتح النموذج (بعد تعبئة القيم الأصلية):  D.open();
   وبعد نجاح الحفظ في القاعدة فقط:                          D.done();

   القواعد:
   - يُحفظ (debounce) عند كل إدخال/تغيير/إضافة أو حذف صف.
   - إن عادت القيم مطابقة للحالة الأصلية تُحذف المسودة (لا مسودات فارغة).
   - تُحذف المسودة فقط عند D.done() (حفظ ناجح) أو زر «مسح النموذج».
     فشل التحقق أو الشبكة لا يمس المسودة.
   - حقول الملفات وكلمات المرور لا تُخزَّن أبداً (للملفات: الاسم فقط للتذكير).
   - JSON تالف/إصدار قديم/منتهي الصلاحية يُحذف بصمت؛ امتلاء التخزين لا يوقف النموذج.
   ============================================================================ */

const DRAFT_VERSION = 2;
const DRAFT_TTL = 30 * 24 * 3600 * 1000;
const DRAFT_MAX_BYTES = 1024 * 1024; // حماية: لا تخزن أكثر من ~1 م.ب لنموذج واحد
const DRAFT_DELAY = 400;

const Drafts = {
  _timers: {},
  _quotaWarned: false,
  _swept: false,
  registry: [],

  /* ---------- المفاتيح ---------- */
  safe(s) { return String(s == null ? '' : s).trim().replace(/[^A-Za-z0-9؀-ۿ.-]+/g, '-').slice(0, 80) || 'x'; },

  key(module, form, recordId) {
    const has = recordId !== null && recordId !== undefined && recordId !== '';
    return ['draft', this.safe(module), this.safe(form), has ? 'edit' : 'create', has ? this.safe(recordId) : 'new'].join('_');
  },

  userPrefix() {
    const uid = (typeof APP !== 'undefined' && APP && APP.user && APP.user.id) || 'anon';
    return 'accsys:' + uid + ':';
  },

  storageKey(key) { return this.userPrefix() + key; },

  /* ---------- التخزين الخام ---------- */
  load(key) {
    let raw = null;
    try { raw = localStorage.getItem(this.storageKey(key)); } catch (_) { return null; }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const ok = d && typeof d === 'object' && d.v === DRAFT_VERSION && typeof d.t === 'number'
        && d.data && typeof d.data === 'object' && !Array.isArray(d.data);
      if (!ok || Date.now() - d.t > DRAFT_TTL) { this.clear(key); return null; }
      return d;
    } catch (_) {
      this.clear(key);
      return null;
    }
  },

  save(key, data, base) {
    if (!key) return false;
    let json;
    try { json = JSON.stringify({ v: DRAFT_VERSION, t: Date.now(), base: base || '', data }); } catch (_) { return false; }
    if (json.length > DRAFT_MAX_BYTES) { this.warn('المسودة أكبر من المسموح به للحفظ التلقائي — لم تُحفظ'); return false; }
    try {
      localStorage.setItem(this.storageKey(key), json);
      return true;
    } catch (e) {
      this.warn('تعذر حفظ المسودة تلقائياً (مساحة المتصفح ممتلئة أو التخزين معطل)');
      return false;
    }
  },

  clear(key) {
    if (!key) return;
    clearTimeout(this._timers[key]);
    delete this._timers[key];
    try { localStorage.removeItem(this.storageKey(key)); } catch (_) { /* ignore */ }
  },

  warn(msg) {
    if (this._quotaWarned) return;
    this._quotaWarned = true;
    if (typeof toast === 'function') toast(msg, 'err');
  },

  /* حذف المسودات المنتهية والقديمة (إصدارات سابقة) مرة واحدة لكل صفحة */
  sweep() {
    if (this._swept) return;
    this._swept = true;
    try {
      const dead = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('accsys_draft_v1:')) { dead.push(k); continue; }
        if (!/^accsys:[^:]+:draft_/.test(k)) continue;
        try {
          const d = JSON.parse(localStorage.getItem(k));
          if (!d || d.v !== DRAFT_VERSION || Date.now() - d.t > DRAFT_TTL) dead.push(k);
        } catch (_) { dead.push(k); }
      }
      dead.forEach(k => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
  },

  /* ---------- مساعدات DOM ---------- */
  resolve(r) {
    if (!r) return null;
    if (typeof r === 'function') return r();
    if (typeof r === 'string') return document.querySelector(r);
    return r;
  },

  isStorable(el) {
    if (!el || !el.id) return false;
    const t = String(el.type || '').toLowerCase();
    if (t === 'password' || t === 'hidden' || t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return false;
    if (el.dataset && el.dataset.draft === 'off') return false;
    if (/pass|password|secret|token/i.test(el.autocomplete || '')) return false;
    return true;
  },

  readEl(el) {
    const t = String(el.type || '').toLowerCase();
    if (t === 'checkbox') return !!el.checked;
    if (t === 'radio') return el.checked ? el.value : undefined;
    if (t === 'file') return undefined;
    if (el.tagName === 'SELECT' && el.multiple) return [...el.selectedOptions].map(o => o.value);
    return el.value;
  },

  /* يكتب القيمة إن كانت صالحة. يُطلق change للقوائم فقط حتى تُعاد بناء القوائم التابعة
     (مثل نوع الفاتورة → قائمة الأطراف). يعيد true إن تغيّرت القيمة. */
  writeEl(el, v) {
    if (v === undefined || v === null) return false;
    const t = String(el.type || '').toLowerCase();
    if (t === 'file' || t === 'password') return false;
    if (t === 'checkbox') {
      const b = !!v;
      if (el.checked === b) return false;
      el.checked = b;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.tagName === 'SELECT') {
      if (el.multiple && Array.isArray(v)) {
        [...el.options].forEach(o => { o.selected = v.includes(o.value); });
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      const s = String(v);
      if (el.value === s) return false;
      if (s !== '' && ![...el.options].some(o => o.value === s)) return false; // خيار لم يعد موجوداً
      el.value = s;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (typeof v !== 'string' && typeof v !== 'number') return false;
    if (el.value === String(v)) return false;
    el.value = String(v);
    return true;
  },

  /* ---------- التسجيل ---------- */
  register(cfg) {
    this.sweep();
    const self = this;
    const ctl = {
      cfg,
      key: null,
      active: false,
      applying: false,
      pristine: null,
      pristineJson: '',

      root() { return self.resolve(cfg.root); },
      rowsBox() { return cfg.rows ? self.resolve(cfg.rows.container) : null; },

      fieldEls() {
        const root = this.root();
        if (!root) return [];
        const exclude = new Set(cfg.exclude || []);
        let list;
        if (cfg.fields) list = cfg.fields.map(id => document.getElementById(id)).filter(Boolean);
        else {
          const box = this.rowsBox();
          list = [...root.querySelectorAll('input[id], select[id], textarea[id]')]
            .filter(el => !(box && box.contains(el)) && !el.closest('.draft-banner'));
        }
        return list.filter(el => !exclude.has(el.id) && self.isStorable(el));
      },

      collect() {
        const d = { fields: {}, files: {} };
        this.fieldEls().forEach(el => {
          if (String(el.type).toLowerCase() === 'file') {
            const f = el.files && el.files[0];
            if (f) d.files[el.id] = f.name; // الملف نفسه لا يُخزَّن أبداً
            return;
          }
          const v = self.readEl(el);
          if (v !== undefined) d.fields[el.id] = v;
        });
        if (cfg.rows) {
          const box = this.rowsBox();
          d.rows = box ? [...box.children].filter(r => r.nodeType === 1 && cfg.rows.fields.some(c => r.querySelector('.' + c))).map(row => {
            const o = {};
            cfg.rows.fields.forEach(c => { const el = row.querySelector('.' + c); if (el) o[c] = self.readEl(el); });
            return o;
          }) : [];
        }
        if (cfg.keyed) {
          d.keyed = {};
          const root = this.root();
          if (root) root.querySelectorAll(cfg.keyed.selector).forEach(el => { d.keyed[cfg.keyed.id(el)] = self.readEl(el); });
        }
        if (cfg.custom) { try { d.custom = cfg.custom.collect(); } catch (_) { d.custom = null; } }
        return d;
      },

      apply(d) {
        if (!d || typeof d !== 'object') return;
        this.applying = true;
        try {
          if (cfg.custom && d.custom !== undefined && d.custom !== null) { try { cfg.custom.apply(d.custom); } catch (_) { /* تجاهل */ } }
          const fields = d.fields && typeof d.fields === 'object' ? d.fields : {};
          // بترتيب DOM: القائمة الأم أولاً ثم التابعة
          this.fieldEls().forEach(el => { if (Object.prototype.hasOwnProperty.call(fields, el.id)) self.writeEl(el, fields[el.id]); });
          if (cfg.rows && Array.isArray(d.rows)) {
            const box = this.rowsBox();
            if (box) {
              box.innerHTML = '';
              const rows = d.rows.filter(r => r && typeof r === 'object').slice(0, 1000);
              rows.forEach(r => {
                cfg.rows.add();
                const row = box.lastElementChild;
                if (!row) return;
                cfg.rows.fields.forEach(c => { const el = row.querySelector('.' + c); if (el) self.writeEl(el, r[c]); });
              });
              if (!rows.length && cfg.rows.min) for (let i = 0; i < cfg.rows.min; i++) cfg.rows.add();
            }
          }
          if (cfg.keyed && d.keyed && typeof d.keyed === 'object') {
            const root = this.root();
            if (root) root.querySelectorAll(cfg.keyed.selector).forEach(el => {
              const k = cfg.keyed.id(el);
              if (Object.prototype.hasOwnProperty.call(d.keyed, k)) self.writeEl(el, d.keyed[k]);
            });
          }
          if (cfg.after) { try { cfg.after(); } catch (_) { /* تجاهل */ } }
        } finally {
          this.applying = false;
        }
      },

      bind(root) {
        if (!root || root.__draftCtl === this) return;
        root.__draftCtl = this;
        const schedule = (e) => {
          if (this.applying || !this.active || !this.key) return;
          if (e && e.type === 'click' && e.target && e.target.closest && e.target.closest('[data-draft-reset]')) return;
          // اللقطة تؤخذ لحظة الحدث (والنموذج ما زال يعرض السجل الصحيح)، والكتابة فقط مؤجلة.
          // هكذا لا تتسرب قيم سجل آخر يُفتح خلال مهلة الحفظ إلى مسودة السجل السابق.
          const key = this.key;
          let data;
          try { data = this.collect(); } catch (_) { return; }
          this._pending = { key, data };
          clearTimeout(self._timers[key]);
          self._timers[key] = setTimeout(() => this.persist(key), cfg.delay || DRAFT_DELAY);
        };
        root.addEventListener('input', schedule);
        root.addEventListener('change', schedule);
        // إضافة/حذف صفوف تتم بأزرار — النقر يجدول حفظاً بعد تعديل DOM
        root.addEventListener('click', schedule);
        root.addEventListener('click', e => {
          const btn = e.target && e.target.closest && e.target.closest('[data-draft-reset]');
          if (btn && root.contains(btn)) { e.preventDefault(); this.reset(); }
        });
      },

      persist(key) {
        delete self._timers[key];
        const p = this._pending;
        this._pending = null;
        if (!p || p.key !== key || !this.active) return;
        if (JSON.stringify(p.data) === this.pristineJson) { self.clear(key); if (key === this.key) this.banner(null); return; }
        self.save(key, p.data, this.pristineJson);
      },

      flush() {
        const p = this._pending;
        if (p && self._timers[p.key]) { clearTimeout(self._timers[p.key]); this.persist(p.key); }
      },

      ensureResetButton(root) {
        if (cfg.resetButton === false) return;
        if ([...root.querySelectorAll('[data-draft-reset]')].some(b => !b.closest('.draft-banner'))) return;
        const host = (cfg.resetIn && self.resolve(cfg.resetIn)) || root.querySelector('.modal-foot') || root;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-dark' + (cfg.resetSmall ? ' btn-sm' : '');
        btn.setAttribute('data-draft-reset', '');
        btn.textContent = '🧹 مسح النموذج';
        btn.title = 'مسح البيانات غير المحفوظة والبدء من جديد';
        host.appendChild(btn);
      },

      banner(draft, stale) {
        const root = this.root();
        if (!root) return;
        const container = root.querySelector('.modal-body') || root;
        let el = container.querySelector(':scope > .draft-banner');
        if (!draft) { if (el) el.remove(); return; }
        if (!el) {
          el = document.createElement('div');
          el.className = 'draft-banner';
          el.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px;padding:8px 12px;border:1px dashed var(--gold,#c9a24a);border-radius:10px;background:rgba(201,162,74,.08);font-size:13px';
          container.prepend(el);
        }
        const when = new Date(draft.t).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
        const files = Object.values((draft.data && draft.data.files) || {});
        el.innerHTML = '<span>📝 تم استرجاع بيانات غير محفوظة من ' + esc(when)
          + (files.length ? ' — أعد اختيار الملف «' + files.map(esc).join('، ') + '»' : '')
          + (stale ? ' — ⚠️ السجل الأصلي تغيّر بعد كتابة المسودة، راجع القيم قبل الحفظ' : '')
          + '</span><button type="button" class="btn btn-sm btn-dark" data-draft-reset>مسح النموذج</button>';
      },

      /* يُستدعى في نهاية دالة فتح/عرض النموذج بعد تعبئة القيم الأصلية.
         opts.form / opts.recordId / opts.mode لتجاوز القيم الافتراضية (مثل نسخ قيد). */
      open(opts) {
        opts = opts || {};
        const root = this.root();
        if (!root) return null;
        if (this.key) this.flush();
        const rid = opts.recordId !== undefined ? opts.recordId : (cfg.recordId ? cfg.recordId() : null);
        this.key = self.key(cfg.module, opts.form || cfg.form, rid);
        if (opts.mode === 'create' && rid) this.key = this.key.replace('_edit_', '_create_');
        this.bind(root);
        this.ensureResetButton(root);
        this.pristine = this.collect();
        this.pristineJson = JSON.stringify(this.pristine);
        const draft = self.load(this.key);
        if (draft) {
          this.apply(draft.data);
          this.banner(draft, !!draft.base && draft.base !== this.pristineJson);
        } else this.banner(null);
        this.active = true;
        return draft;
      },

      /* نجاح الحفظ في قاعدة البيانات: احذف المسودة وتوقف حتى الفتح التالي */
      done() {
        this._pending = null;
        if (this.key) self.clear(this.key);
        this.active = false;
        this.banner(null);
      },

      /* زر «مسح النموذج» */
      reset() {
        this._pending = null;
        if (this.key) self.clear(this.key);
        this.apply(this.pristine);
        this.banner(null);
        const root = this.root();
        if (root) root.querySelectorAll('input[type=file]').forEach(f => { f.value = ''; });
        if (cfg.onReset) { try { cfg.onReset(); } catch (_) { /* ignore */ } }
        if (typeof toast === 'function') toast('تم مسح النموذج');
      },
    };
    this.registry.push(ctl);
    this.installGlobal();
    return ctl;
  },

  _global: false,
  installGlobal() {
    if (this._global || typeof window === 'undefined' || !window.addEventListener) return;
    this._global = true;
    const f = () => this.registry.forEach(c => c.flush());
    window.addEventListener('pagehide', f);
    window.addEventListener('beforeunload', f);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') f(); });
  },
};

if (typeof window !== 'undefined') window.Drafts = Drafts;
if (typeof module !== 'undefined') module.exports = { Drafts };
