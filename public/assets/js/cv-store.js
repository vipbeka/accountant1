'use strict';

/* السير الذاتية للموظفين — تُرفع إلى Supabase Storage (حاوية employee-cvs الخاصة)
   بدل تخزينها base64 داخل hr_store_v1. لا حد للحجم من جهة التطبيق:
   - الملفات الصغيرة (≤ 6 م.ب) ترفع بطلب واحد مع شريط تقدم.
   - الكبيرة ترفع بطريقة TUS القابلة للاستئناف على أجزاء 6 م.ب مع إعادة المحاولة.
   المرجع المحفوظ في ملف الموظف: cv_path / cv_name / cv_type / cv_size. */

const CV_BUCKET = 'employee-cvs';
const CV_TUS_CHUNK = 6 * 1024 * 1024; // Supabase يشترط 6 م.ب بالضبط لكل جزء عدا الأخير
const CV_MAX_RETRIES = 4;

function cvFmtSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' ج.ب';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' م.ب';
  return Math.max(1, Math.round(n / 1024)) + ' ك.ب';
}

function cvSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cvB64(str) {
  return btoa(unescape(encodeURIComponent(String(str))));
}

const CV = {
  bucketMissing: false,
  _urls: new Map(), // cache: key -> { url, exp, revoke }

  /* ---------- التحقق من الملف ---------- */
  async validatePdf(file) {
    if (!file) throw new Error('لم يتم اختيار ملف');
    if (!file.size) throw new Error('الملف فارغ');
    const type = String(file.type || '').toLowerCase();
    const nameIsPdf = /\.pdf$/i.test(file.name || '');
    // بعض المتصفحات/الأنظمة ترسل نوعاً فارغاً أو application/x-pdf
    const typeOk = type === 'application/pdf' || ((type === '' || type === 'application/x-pdf' || type === 'application/octet-stream') && nameIsPdf);
    if (!typeOk) throw new Error('السيرة الذاتية يجب أن تكون ملف PDF (application/pdf)');
    // التحقق من التوقيع الفعلي: "%PDF-" ضمن أول 1024 بايت (حسب مواصفة PDF)
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
    let found = false;
    for (let i = 0; i + sig.length <= head.length && !found; i++) {
      found = sig.every((b, k) => head[i + k] === b);
    }
    if (!found) throw new Error('الملف لا يبدو PDF صالحاً (التوقيع %PDF مفقود)');
    return true;
  },

  async token() {
    const { data } = await supabase.auth.getSession();
    const t = data && data.session && data.session.access_token;
    if (!t) throw new Error('انتهت الجلسة — سجّل الدخول مجدداً');
    return t;
  },

  newPath(file) {
    const id = (typeof HR !== 'undefined' && HR.uid) ? HR.uid() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    const now = new Date();
    return `cv/${now.getUTCFullYear()}/${id}.pdf`;
  },

  isBucketMissingError(status, text) {
    return status === 404 || /bucket not found|Bucket not found|bucket_not_found/i.test(String(text || ''));
  },

  /* ---------- الرفع ---------- */
  async upload(file, onProgress) {
    await this.validatePdf(file);
    const path = this.newPath(file);
    const report = (loaded) => { if (onProgress) onProgress(Math.min(loaded, file.size), file.size); };
    report(0);
    if (file.size <= CV_TUS_CHUNK) await this.uploadSimple(file, path, report);
    else await this.uploadResumable(file, path, report);
    report(file.size);
    this.bucketMissing = false;
    return { path, name: file.name || 'cv.pdf', type: 'application/pdf', size: file.size };
  },

  uploadSimple(file, path, report) {
    return this.token().then(token => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `${window.SUPABASE_URL}/storage/v1/object/${CV_BUCKET}/${path}`;
      xhr.open('POST', url, true);
      xhr.timeout = 0; // بدون مهلة — الملفات الكبيرة على شبكة بطيئة لا تُقطع
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', window.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Content-Type', 'application/pdf');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', '3600');
      xhr.upload.onprogress = e => { if (e.lengthComputable) report(e.loaded); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        reject(this.httpError(xhr.status, xhr.responseText));
      };
      xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء رفع السيرة'));
      xhr.send(file);
    }));
  },

  httpError(status, text) {
    if (this.isBucketMissingError(status, text)) {
      this.bucketMissing = true;
      const e = new Error('حاوية التخزين employee-cvs غير موجودة. شغّل ملف الترحيل supabase/migrations/20261115000000_employee_cvs_bucket.sql');
      e.code = 'BUCKET_MISSING';
      return e;
    }
    if (status === 413) {
      return new Error('الملف يتجاوز الحد العام للرفع في مشروع Supabase — ارفع الحد من لوحة التحكم: Storage → Settings');
    }
    if (status === 401 || status === 403) return new Error('لا تملك صلاحية رفع السيرة الذاتية');
    let msg = '';
    try { const j = JSON.parse(text); msg = j.message || j.error || ''; } catch (_) { msg = String(text || '').slice(0, 200); }
    return new Error('تعذر رفع السيرة (' + status + ')' + (msg ? ': ' + msg : ''));
  },

  /* TUS — رفع قابل للاستئناف لأي حجم */
  async uploadResumable(file, path, report) {
    const endpoint = `${window.SUPABASE_URL}/storage/v1/upload/resumable`;
    const baseHeaders = async () => ({
      Authorization: 'Bearer ' + await this.token(),
      apikey: window.SUPABASE_ANON_KEY,
      'Tus-Resumable': '1.0.0',
    });
    const meta = [
      'bucketName ' + cvB64(CV_BUCKET),
      'objectName ' + cvB64(path),
      'contentType ' + cvB64('application/pdf'),
      'cacheControl ' + cvB64('3600'),
    ].join(',');
    const created = await fetch(endpoint, {
      method: 'POST',
      headers: Object.assign(await baseHeaders(), {
        'Upload-Length': String(file.size),
        'Upload-Metadata': meta,
        'x-upsert': 'false',
      }),
    });
    if (created.status !== 201) throw this.httpError(created.status, await created.text().catch(() => ''));
    const loc = created.headers.get('Location');
    if (!loc) throw new Error('الخادم لم يُرجع رابط الرفع (Location)');
    const uploadUrl = new URL(loc, endpoint).href;

    let offset = 0;
    let retries = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + CV_TUS_CHUNK, file.size));
      try {
        offset = await this.patchChunk(uploadUrl, chunk, offset, await baseHeaders(), loaded => report(offset + loaded));
        retries = 0;
        report(offset);
      } catch (err) {
        if (err && err.fatal) throw err;
        if (++retries > CV_MAX_RETRIES) throw new Error('تعذر إكمال رفع السيرة بعد عدة محاولات: ' + errMsg(err));
        await cvSleep(1000 * Math.pow(2, retries - 1));
        // اسأل الخادم عن آخر موضع وصل فعلاً ثم أكمل منه
        const head = await fetch(uploadUrl, { method: 'HEAD', headers: await baseHeaders() }).catch(() => null);
        const o = head && Number(head.headers.get('Upload-Offset'));
        if (Number.isFinite(o) && o >= 0) offset = o;
      }
    }
  },

  patchChunk(url, chunk, offset, headers, onLoaded) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PATCH', url, true);
      xhr.timeout = 0;
      Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));
      xhr.setRequestHeader('Upload-Offset', String(offset));
      xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
      xhr.upload.onprogress = e => { if (e.lengthComputable) onLoaded(e.loaded); };
      xhr.onload = () => {
        if (xhr.status === 204 || xhr.status === 200) {
          const next = Number(xhr.getResponseHeader('Upload-Offset'));
          return resolve(Number.isFinite(next) ? next : offset + chunk.size);
        }
        const err = this.httpError(xhr.status, xhr.responseText);
        if (xhr.status === 401 || xhr.status === 403 || xhr.status === 413 || err.code === 'BUCKET_MISSING') err.fatal = true;
        reject(err);
      };
      xhr.onerror = () => reject(new Error('انقطاع الشبكة'));
      xhr.send(chunk);
    });
  },

  async remove(path) {
    if (!path) return;
    this.forget(path);
    try { await supabase.storage.from(CV_BUCKET).remove([path]); } catch (_) { /* لا يوقف العملية */ }
  },

  /* ---------- العرض والتنزيل ---------- */
  hasCv(emp) { return !!(emp && (emp.cv_path || emp.cv_data)); },
  isPdf(emp) { return !!emp && (!!emp.cv_path || String(emp.cv_type || '').toLowerCase().includes('pdf')); },

  forget(key) {
    const c = this._urls.get(key);
    if (c && c.revoke) URL.revokeObjectURL(c.url);
    this._urls.delete(key);
  },

  /* رابط عرض: Signed URL للملفات في التخزين، و blob: للسير القديمة المضمّنة.
     (روابط data: الكبيرة تُحظر داخل iframe في Chrome — وهذا سبب فشل المعاينة سابقاً) */
  async viewUrl(emp) {
    if (!emp) return '';
    if (emp.cv_path) {
      const c = this._urls.get(emp.cv_path);
      if (c && c.exp > Date.now() + 60000) return c.url;
      const { data, error } = await supabase.storage.from(CV_BUCKET).createSignedUrl(emp.cv_path, 3600);
      if (error) throw error;
      this._urls.set(emp.cv_path, { url: data.signedUrl, exp: Date.now() + 3600 * 1000 });
      return data.signedUrl;
    }
    if (emp.cv_data) {
      const key = 'inline:' + emp.id + ':' + emp.cv_data.length;
      const c = this._urls.get(key);
      if (c) return c.url;
      const blob = this.dataUrlToBlob(emp.cv_data, emp.cv_type);
      const url = URL.createObjectURL(blob);
      this._urls.set(key, { url, exp: Infinity, revoke: true });
      return url;
    }
    return '';
  },

  async download(emp) {
    if (!emp) return;
    const name = emp.cv_name || ((emp.name || 'employee') + '-cv.pdf');
    let href;
    if (emp.cv_path) {
      const { data, error } = await supabase.storage.from(CV_BUCKET).createSignedUrl(emp.cv_path, 600, { download: name });
      if (error) throw error;
      href = data.signedUrl;
    } else {
      href = await this.viewUrl(emp);
    }
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  dataUrlToBlob(dataUrl, fallbackType) {
    const m = String(dataUrl).match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) throw new Error('بيانات السيرة القديمة تالفة');
    const type = m[1] || fallbackType || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  },

  /* نقل السير القديمة (PDF المضمّنة داخل hr_store_v1) إلى التخزين لتخفيف حجم الملف المشترك. */
  async migrateLegacy(employees) {
    const legacy = (employees || []).filter(e => e.cv_data && !e.cv_path && String(e.cv_type || '').toLowerCase().includes('pdf'));
    let moved = 0;
    for (const e of legacy) {
      try {
        const blob = this.dataUrlToBlob(e.cv_data, 'application/pdf');
        const file = new File([blob], e.cv_name || 'cv.pdf', { type: 'application/pdf' });
        const ref = await this.upload(file);
        e.cv_path = ref.path;
        e.cv_size = ref.size;
        e.cv_type = 'application/pdf';
        e.cv_data = '';
        moved++;
      } catch (err) {
        if (err && err.code === 'BUCKET_MISSING') break; // لا جدوى من المتابعة
      }
    }
    return moved;
  },
};

if (typeof module !== 'undefined') module.exports = { CV, cvFmtSize };
