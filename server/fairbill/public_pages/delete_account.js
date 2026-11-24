const emailForm = document.querySelector('#email-form');
const deleteForm = document.querySelector('#delete-form');
const statusText = document.querySelector('#status');
const verifierKey = 'fairbill.deletion.verifier';
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

async function sendVerification() {
  const verifier = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  localStorage.setItem(verifierKey, JSON.stringify({ verifier, until: Date.now() + 15 * 60_000 }));
  const redirect = encodeURIComponent(`${location.origin}/delete-account`);
  await request(`otp?redirect_to=${redirect}`, {
    email, create_user: false, code_challenge: challenge, code_challenge_method: 's256',
  });
}

async function restoreVerification(code) {
  const record = JSON.parse(localStorage.getItem(verifierKey) ?? 'null');
  if (!record || record.until < Date.now()) throw new Error('Verification expired');
  const data = await request('token?grant_type=pkce', { auth_code: code, code_verifier: record.verifier });
  if (!data.access_token) throw new Error('No verified session');
  localStorage.removeItem(verifierKey);
  accessToken = data.access_token;
  emailForm.hidden = true;
  deleteForm.hidden = false;
  const input = document.querySelector('#code');
  input.required = false;
  input.hidden = true;
  document.querySelector('label[for="code"]').hidden = true;
  document.querySelector('#confirmation').focus();
  statusText.textContent = 'Email verified. Confirm below to delete your account.';
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
    await sendVerification();
    emailForm.hidden = true;
    deleteForm.hidden = false;
    document.querySelector('#code').focus();
    statusText.textContent = 'Open the link in your email, or enter the code if the email includes one.';
  }, 'Could not send the email. Check the address and try again.');
});

deleteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(deleteForm, async () => {
    if (!accessToken) {
      const token = document.querySelector('#code').value;
      const session = await request('verify', { email, token, type: 'email' });
      accessToken = session.access_token;
      localStorage.removeItem(verifierKey);
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
  localStorage.removeItem(verifierKey);
  deleteForm.reset();
  const input = document.querySelector('#code');
  input.required = true;
  input.hidden = false;
  document.querySelector('label[for="code"]').hidden = false;
  deleteForm.hidden = true;
  emailForm.hidden = false;
  statusText.textContent = '';
  document.querySelector('#email').focus();
});

const authCode = new URLSearchParams(location.search).get('code');
if (authCode) {
  history.replaceState(null, '', location.pathname);
  void run(emailForm, () => restoreVerification(authCode), 'This link is expired or was requested in another browser. Request a new email here.');
}
