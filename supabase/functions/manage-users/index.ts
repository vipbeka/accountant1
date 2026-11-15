// Supabase Edge Function: manage-users
// صلاحيات إدارة المستخدمين (مدير النظام فقط) — يُنفَّذ على خوادم Supabase
// باستخدام مفتاح service_role السري (لا يظهر أبدًا في المتصفح).
//
// النشر: supabase functions deploy manage-users
//
// الاستدعاء من الواجهة: supabase.functions.invoke('manage-users', { body: {...} })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL_DOMAIN = "users.noemail.local"; // بريد وهمي داخلي لأن النظام يعتمد اسم مستخدم لا بريدًا حقيقيًا

const ROLES = ["admin", "accountant", "viewer"];

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
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "انتهت الجلسة، يرجى تسجيل الدخول" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile } = await admin
      .from("profiles").select("role, full_name").eq("id", userData.user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") {
      return json({ error: "هذه الصفحة لمدير النظام فقط" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "create") {
      const username = String(body.username || "").trim().toLowerCase();
      const full_name = String(body.full_name || "").trim();
      const role = ROLES.includes(body.role) ? body.role : "accountant";
      const password = String(body.password || "");
      if (!username || !full_name || !isStrongPassword(password)) {
        return json({ error: "بيانات غير مكتملة (كلمة المرور 8 أحرف على الأقل، حروف وأرقام)" }, 400);
      }
      const { data: exists } = await admin.from("usernames").select("username").eq("username", username).maybeSingle();
      if (exists) return json({ error: "اسم المستخدم موجود بالفعل" }, 400);

      const email = `${username}@${EMAIL_DOMAIN}`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (createErr || !created?.user) return json({ error: createErr?.message || "فشل إنشاء المستخدم" }, 400);

      let security_question = "";
      const sq = String(body.security_question || "").trim();
      const sa = String(body.security_answer || "").trim();
      if (sq) {
        if (!sa) {
          await admin.auth.admin.deleteUser(created.user.id);
          return json({ error: "اكتب إجابة سؤال الأمان" }, 400);
        }
        security_question = sq;
        await admin.from("security_answers").insert({ id: created.user.id, security_answer_hash: await bcrypt.hash(sa) });
      }

      await admin.from("profiles").insert({
        id: created.user.id, username, full_name, role, security_question,
      });
      await admin.from("usernames").insert({ username, email, user_id: created.user.id });
      await admin.from("audit_log").insert({
        user: callerProfile.full_name, action: "إضافة مستخدم", details: `${username} (${role})`,
      });
      return json({ ok: true });
    }

    if (action === "delete") {
      const uid = String(body.user_id || "");
      if (uid === userData.user.id) return json({ error: "لا يمكنك حذف نفسك" }, 400);
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      const { data: target } = await admin.from("profiles").select("*").eq("id", uid).single();
      if (!target) return json({ error: "المستخدم غير موجود" }, 404);
      if (target.role === "admin" && (count ?? 0) <= 1) return json({ error: "لا يمكن حذف آخر مدير نظام" }, 400);
      await admin.from("usernames").delete().eq("user_id", uid);
      await admin.from("profiles").delete().eq("id", uid);
      await admin.auth.admin.deleteUser(uid);
      await admin.from("audit_log").insert({ user: callerProfile.full_name, action: "حذف مستخدم", details: target.username });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const uid = String(body.user_id || "");
      const password = String(body.password || "");
      if (!isStrongPassword(password)) return json({ error: "كلمة المرور 8 أحرف على الأقل، حروف وأرقام" }, 400);
      const { data: target } = await admin.from("profiles").select("username").eq("id", uid).single();
      if (!target) return json({ error: "المستخدم غير موجود" }, 404);
      const { error } = await admin.auth.admin.updateUserById(uid, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("audit_log").insert({ user: callerProfile.full_name, action: "تغيير كلمة مرور", details: target.username });
      return json({ ok: true });
    }

    if (action === "set_security") {
      const uid = String(body.user_id || "");
      const sq = String(body.security_question || "").trim();
      const sa = String(body.security_answer || "").trim();
      if (!sq) return json({ error: "اكتب سؤال الأمان" }, 400);
      if (!sa) return json({ error: "اكتب إجابة سؤال الأمان" }, 400);
      const { data: target } = await admin.from("profiles").select("username").eq("id", uid).single();
      if (!target) return json({ error: "المستخدم غير موجود" }, 404);
      const hash = await bcrypt.hash(sa);
      await admin.from("profiles").update({ security_question: sq }).eq("id", uid);
      await admin.from("security_answers").upsert({ id: uid, security_answer_hash: hash });
      await admin.from("audit_log").insert({ user: callerProfile.full_name, action: "تحديث سؤال أمان", details: target.username });
      return json({ ok: true });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
