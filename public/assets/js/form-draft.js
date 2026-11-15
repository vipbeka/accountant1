'use strict';

/* مسودات النماذج — حفظ تلقائي في localStorage أثناء الكتابة واسترجاعها عند إعادة فتح النموذج.
   - لكل مستخدم مفاتيحه الخاصة (حتى لا تظهر مسودة مستخدم لآخر على نفس الجهاز).
   - لا تُخزَّن الملفات نفسها أبداً — فقط اسم الملف وحجمه للتذكير بإعادة اختياره.
   - البيانات التالفة أو ذات الإصدار القديم أو الأقدم من DRAFT_TTL تُحذف بصمت.
   - امتلاء التخزين لا يوقف النموذج — يُعرض تنبيه مرة واحدة فقط.
   - تُحذف المسودة فقط عند الحفظ الناجح أو عند الضغط على «مسح النموذج». */

const DRAFT_VERSION = 1;
const DRAFT_PREFIX = 'accsys_draft_v1:';
const DRAFT_TTL = 14 * 24 * 3600 * 1000;

const FormDraft = {
  _timers: {},
  _quotaWarned: false,

  storageKey(name) {
    const uid = (window.APP && APP.user && APP.user.id) || 'anon';
    return DRAFT_PREFIX + uid + ':' + name;
  },

  load(name) {
    let raw = null;
    try { raw = localStorage.getItem(this.storageKey(name)); } catch (_) { return null; }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const valid = d && typeof d === 'object' && d.v === DRAFT_VERSION
        && typeof d.t === 'number' && d.data && typeof d.data === 'object' && !Array.isArray(d.data);
      if (!valid || Date.now() - d.t > DRAFT_TTL) { this.clear(name); return null; }
      return d;
    } catch (_) {
      this.clear(name); // JSON تالف
      return null;
    }
  },

  save(name, data) {
    if (!name) return false;
    try {
      localStorage.setItem(this.storageKey(name), JSON.stringify({ v: DRAFT_VERSION, t: Date.now(), data }));
      return true;
    } catch (e) {
      if (!this._quotaWarned) {
        this._quotaWarned = true;
        if (window.toast) toast('تعذر حفظ المسودة تلقائياً (مساحة المتصفح ممتلئة أو التخزين معطل)', 'err');
      }
      return false;
    }
  },

  clear(name) {
    if (!name) return;
    clearTimeout(this._timers[name]);
    delete this._timers[name];
    try { localStorage.removeItem(this.storageKey(name)); } catch (_) { /* ignore */ }
  },

  /* يربط عنصراً (نافذة/نموذج) بالحفظ التلقائي.
     opts.key()      -> اسم المسودة الحالي (أو null لإيقاف الحفظ مؤقتاً)
     opts.collect()  -> كائن البيانات الحالي
     opts.isEmpty(d) -> اختياري: true إن كانت البيانات فارغة فتُحذف المسودة بدل حفظها */
  watch(root, opts) {
    if (!root || root.__draftWatch) return;
    const delay = opts.delay || 400;
    const run = () => {
      const name = opts.key();
      if (!name) return;
      let data;
      try { data = opts.collect(); } catch (_) { return; }
      if (opts.isEmpty && opts.isEmpty(data)) this.clear(name);
      else this.save(name, data);
    };
    const schedule = (e) => {
      if (e && e.target && e.target.type === 'file' && e.type === 'input') return;
      const name = opts.key();
      if (!name) return;
      clearTimeout(this._timers[name]);
      this._timers[name] = setTimeout(run, delay);
    };
    root.addEventListener('input', schedule);
    root.addEventListener('change', schedule);
    // تغييرات برمجية (إضافة/حذف صفوف) لا تطلق input — راقب بنية النموذج أيضاً
    let mo = null;
    if (opts.observe && window.MutationObserver) {
      mo = new MutationObserver(() => schedule());
      mo.observe(opts.observe, { childList: true });
    }
    // لا تضيّع آخر ضغطات مفاتيح عند التحديث/الإغلاق قبل انتهاء مهلة الحفظ
    const flush = () => {
      const name = opts.key();
      if (name && this._timers[name]) { clearTimeout(this._timers[name]); delete this._timers[name]; run(); }
    };
    root.__draftWatch = { flush, schedule, disconnect: () => mo && mo.disconnect() };
    this._watched.add(root);
    this._installGlobal();
  },

  _watched: new Set(),
  _globalInstalled: false,
  flushAll() {
    this._watched.forEach(root => {
      if (!root.isConnected) { if (root.__draftWatch) root.__draftWatch.disconnect(); this._watched.delete(root); return; }
      root.__draftWatch.flush();
    });
  },
  _installGlobal() {
    if (this._globalInstalled) return;
    this._globalInstalled = true;
    const f = () => this.flushAll();
    window.addEventListener('pagehide', f);
    window.addEventListener('beforeunload', f);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') f(); });
  },

  /* شريط «استُرجعت مسودة» داخل النافذة */
  banner(container, draft, onClear) {
    if (!container) return;
    let el = container.querySelector('.draft-banner');
    if (!draft) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'draft-banner';
      el.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px;padding:8px 12px;border:1px dashed var(--gold,#c9a24a);border-radius:10px;background:rgba(201,162,74,.08);font-size:13px';
      container.prepend(el);
    }
    const when = new Date(draft.t).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    el.innerHTML = `<span>📝 تم استرجاع بيانات غير محفوظة من ${esc(when)}${draft.data && draft.data.__file ? ' — أعد اختيار الملف «' + esc(draft.data.__file) + '»' : ''}</span>`
      + '<button type="button" class="btn btn-sm btn-dark">مسح النموذج</button>';
    el.querySelector('button').onclick = onClear;
  },
};

if (typeof module !== 'undefined') module.exports = { FormDraft };
