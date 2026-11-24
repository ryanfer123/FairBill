const emailForm = document.querySelector('#email-form');
const deleteForm = document.querySelector('#delete-form');
const statusText = document.querySelector('#status');
let email;
let accessToken;

async function request(path, body) {
  const response = await fetch(`${authOrigin}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: authKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Verification failed. Check your email or request a new code.');
  return response.json();
}

async function run(form, action, fallback) {
  const buttons = [...form.querySelectorAll('button')];
  if (buttons.some((button) => button.disabled)) return;
  buttons.forEach((button) => { button.disabled = true; });
  statusText.textContent = '';
  try { await action(); }
  catch { statusText.textContent = fallback; }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}

emailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(emailForm, async () => {
    email = document.querySelector('#email').value.trim();
    await request('otp', { email, create_user: false });
    emailForm.hidden = true;
    deleteForm.hidden = false;
    document.querySelector('#code').focus();
    statusText.textContent = 'Check your email for the verification code.';
  }, 'Could not send a code. Check the address and try again.');
});

deleteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(deleteForm, async () => {
    if (!accessToken) {
      const token = document.querySelector('#code').value;
      const session = await request('verify', { email, token, type: 'email' });
      accessToken = session.access_token;
    }
    if (!accessToken) throw new Error('No verified session');
    const response = await fetch('/v1/account', {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(65000),
    });
    if (response.status === 401) accessToken = undefined;
    if (response.status !== 204) throw new Error('Could not delete account');
    accessToken = undefined;
    email = undefined;
    emailForm.reset();
    deleteForm.reset();
    deleteForm.hidden = true;
    statusText.textContent = 'Your FairBill account was deleted.';
  }, 'Could not finish deletion. Retry, or request a new code.');
});

document.querySelector('#restart').addEventListener('click', () => {
  accessToken = undefined;
  email = undefined;
  deleteForm.reset();
  deleteForm.hidden = true;
  emailForm.hidden = false;
  statusText.textContent = '';
  document.querySelector('#email').focus();
});
