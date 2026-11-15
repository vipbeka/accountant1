// تحليلات Firebase (Google Analytics) — اختياري بالكامل ولا علاقة له بعمل النظام
// (قاعدة البيانات والمصادقة كلها عبر Supabase). بيانات firebaseConfig هنا عامة
// وآمنة للنشر في كود الواجهة (ليست مفتاح سري).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyAMg48sytCh0P1ZV49ZrC9NTa_i5kdQUsU",
  authDomain: "accountant-6e13e.firebaseapp.com",
  projectId: "accountant-6e13e",
  storageBucket: "accountant-6e13e.firebasestorage.app",
  messagingSenderId: "397989241520",
  appId: "1:397989241520:web:12f280aa3d0d7716f71175",
  measurementId: "G-MGXH014EQF",
};

try {
  const app = initializeApp(firebaseConfig);
  isSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});
} catch (e) {
  // لا نوقف تشغيل الموقع لو التحليلات فشلت (مثلاً بسبب حاجب إعلانات)
  console.warn("Firebase Analytics غير متاح:", e);
}
