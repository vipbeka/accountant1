'use strict';

// تهيئة Supabase بطريقة لا تعيد استخدام اسم مكتبة CDN (window.supabase).
// ذلك يمنع تعارضًا قد يجعل الصفحات ترى namespace المكتبة بدل عميل Supabase.
(function initSupabaseClient() {
  const sdk = window.supabase;
  if (!sdk || typeof sdk.createClient !== 'function') {
    throw new Error('تعذّر تحميل مكتبة Supabase. تحقق من اتصال الشبكة ومصدر CDN.');
  }

  const client = sdk.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  if (!client || !client.auth || typeof client.rpc !== 'function') {
    throw new Error('تعذّر إنشاء عميل Supabase صالح. تحقق من إعدادات المشروع.');
  }

  // مكتبة الموقع لا تُرجع Promise كاملاً من rpc، لذلك .catch كانت ترمي خطأ وتوقف الحفظ.
  const rawRpc = client.rpc.bind(client);
  client.rpc = function () {
    try {
      return Promise.resolve(rawRpc.apply(client, arguments));
    } catch (err) {
      return Promise.reject(err);
    }
  };

  window.supabaseClient = client;
  window.supabase = client;
})();
