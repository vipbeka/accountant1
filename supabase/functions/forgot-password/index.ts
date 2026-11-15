// Supabase Edge Function: forgot-password
// تعمل بدون تسجيل دخول (عامة) — تعرض سؤال الأمان ثم تتحقق من الإجابة وتعيد تعيين كلمة المرور.
// النشر: supabase functions deploy forgot-password --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function isStrongPassword(pwd: string) {
  return pwd && pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const username = String(body.username || "").trim().toLowerCase();
    if (!username) return json({ error: "اكتب اسم المستخدم" }, 400);

    const { data: profile } = await admin.from("profiles").select("*").eq("username", username).maybeSingle();

    if (action === "get_question") {
      if (!profile || !profile.security_question) {
        return json({ error: "هذا الحساب لا يوجد له سؤال أمان — تواصل مع مدير النظام" }, 404);
      }
      return json({ ok: true, question: profile.security_question });
    }

    if (action === "reset") {
      const answer = String(body.answer || "").trim();
      const new_password = String(body.new_password || "");
      if (!profile || !profile.security_question) {
        return json({ error: "هذا الحساب لا يوجد له سؤال أمان — تواصل مع مدير النظام" }, 404);
      }
      const { data: sec } = await admin.from("security_answers").select("security_answer_hash").eq("id", profile.id).maybeSingle();
      if (!sec) return json({ error: "هذا الحساب لا يوجد له سؤال أمان — تواصل مع مدير النظام" }, 404);
      if (!isStrongPassword(new_password)) {
        return json({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام" }, 400);
      }
      const ok = await bcrypt.compare(answer, sec.security_answer_hash);
      if (!ok) return json({ error: "إجابة سؤال الأمان غير صحيحة" }, 400);
      const { error } = await admin.auth.admin.updateUserById(profile.id, { password: new_password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("audit_log").insert({
        user: profile.full_name, action: "استعادة كلمة مرور", details: "تم تغيير كلمة المرور عبر سؤال الأمان",
      });
      return json({ ok: true });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
