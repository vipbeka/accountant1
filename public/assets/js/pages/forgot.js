'use strict';

let currentUsername = '';

function showError(msg) { const b = document.getElementById('errorBox'); b.textContent = msg; b.style.display = 'block'; document.getElementById('okBox').style.display = 'none'; }
function showOk(msg) { const b = document.getElementById('okBox'); b.textContent = msg; b.style.display = 'block'; document.getElementById('errorBox').style.display = 'none'; }

document.getElementById('stepAsk').addEventListener('submit', async (e) => {
  e.preventDefault();
  currentUsername = String(new FormData(e.target).get('username') || '').trim().toLowerCase();
  try {
    const { data, error } = await supabase.rpc('recover_account', {
      p_action: 'get_question',
      p_username: currentUsername,
    });
    if (error) throw new Error(error.message);
    if (!data || !data.question) throw new Error((data && data.error) || 'تعذّر جلب سؤال الأمان');
    document.getElementById('questionLabel').textContent = data.question;
    document.getElementById('stepAsk').style.display = 'none';
    document.getElementById('stepAnswer').style.display = 'block';
    document.getElementById('errorBox').style.display = 'none';
  } catch (err) {
    showError(errMsg(err));
  }
});

document.getElementById('stepAnswer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const { data, error } = await supabase.rpc('recover_account', {
      p_action: 'reset',
      p_username: currentUsername,
      p_answer: form.get('answer'),
      p_new_password: form.get('new_password'),
    });
    if (error) throw new Error(error.message);
    if (data && data.error) throw new Error(data.error);
    showOk('تم تغيير كلمة المرور بنجاح — يمكنك الآن تسجيل الدخول');
    document.getElementById('stepAnswer').style.display = 'none';
  } catch (err) {
    showError(errMsg(err));
  }
});
