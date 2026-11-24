import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { parse as parseLink } from 'expo-linking';
import * as SecureStore from 'expo-secure-store';

const config = Constants.expoConfig?.extra;
const origin: string | undefined = config?.fairbillSupabaseUrl;
const key: string | undefined = config?.fairbillSupabaseKey;
export const cloudBuild = !!(origin && key);

const refreshKey = 'fairbill_cloud_refresh';
const verifierKey = 'fairbill_cloud_sign_in_verifier';
type Session = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email?: string } };
type Current = { accessToken: string; expiresAt: number; user: Session['user'] };
type AccountState = 'loading' | 'signed-out' | 'signed-in';
type Listener = () => void;
let state: AccountState = cloudBuild ? 'loading' : 'signed-out';
let current: Current | undefined;
let refresh: Promise<Current | undefined> | undefined;
const listeners = new Set<Listener>();

export const accountState = () => state;
export function listenAccount(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(value: Current | undefined) {
  current = value;
  state = value ? 'signed-in' : 'signed-out';
  listeners.forEach((listener) => listener());
}

class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function auth<T>(path: string, data: object, accessToken?: string): Promise<T> {
  if (!origin || !key) throw new Error('Account sign-in is unavailable in this build.');
  const headers = new Headers({ apikey: key, 'Content-Type': 'application/json' });
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const control = new AbortController();
  const timeout = setTimeout(() => control.abort(), 15000);
  try {
    const response = await fetch(`${origin}/auth/v1/${path}`, {
      method: 'POST', headers, body: JSON.stringify(data), signal: control.signal,
    });
    if (!response.ok) {
      const message = response.status === 429 ? 'Too many attempts. Wait a moment and try again.'
        : response.status >= 500 ? 'Sign-in is temporarily unavailable. Try again.'
        : path === 'verify' ? 'That code is invalid or has expired. Request a new code.'
        : 'FairBill could not complete the sign-in request.';
      throw new AuthError(response.status, message);
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  } catch (cause) {
    if (cause instanceof AuthError) throw cause;
    throw new Error('FairBill could not reach sign-in. Check your connection and retry.');
  } finally {
    clearTimeout(timeout);
  }
}

async function saveSession(session: Session): Promise<Current> {
  if (!session.access_token || !session.refresh_token || !session.user?.id || !Number.isFinite(session.expires_in)) {
    throw new Error('FairBill did not receive a valid session. Sign in again.');
  }
  await SecureStore.setItemAsync(refreshKey, session.refresh_token);
  const value = { accessToken: session.access_token, expiresAt: Date.now() + session.expires_in * 1000, user: session.user };
  publish(value);
  return value;
}

export async function requestSignInCode(email: string) {
  const verifier = Array.from(await Crypto.getRandomBytesAsync(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  const challenge = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await SecureStore.setItemAsync(verifierKey, verifier);
  return auth(`otp?redirect_to=${encodeURIComponent('fairbill://signin')}`, {
    email, create_user: true, code_challenge: challenge, code_challenge_method: 's256',
  });
}

export async function verifySignInCode(email: string, token: string) {
  await saveSession(await auth<Session>('verify', { email, token, type: 'email' }));
  await SecureStore.deleteItemAsync(verifierKey);
}

export async function confirmSignInLink(url: string) {
  if (!/^fairbill:\/\/signin(?:[?#]|$)/.test(url)) return;
  const code = parseLink(url).queryParams?.code;
  const verifier = await SecureStore.getItemAsync(verifierKey);
  if (typeof code !== 'string' || !code || !verifier) throw new Error('The sign-in link expired. Request a new email on this phone.');
  await saveSession(await auth<Session>('token?grant_type=pkce', { auth_code: code, code_verifier: verifier }));
  await SecureStore.deleteItemAsync(verifierKey);
}

export async function restoreAccount() {
  if (current && current.expiresAt > Date.now() + 60_000) return current;
  refresh ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(refreshKey);
    if (!refreshToken) { publish(undefined); return undefined; }
    try {
      return await saveSession(await auth<Session>('token?grant_type=refresh_token', { refresh_token: refreshToken }));
    } catch (cause) {
      if (!(cause instanceof AuthError) || ![400, 401, 403].includes(cause.status)) throw cause;
      await SecureStore.deleteItemAsync(refreshKey);
      publish(undefined);
      return undefined;
    }
  })().finally(() => { refresh = undefined; });
  return refresh;
}

export async function cloudAuthorization() {
  const account = await restoreAccount();
  if (!account) throw new Error('Sign in to open your FairBill account.');
  return `Bearer ${account.accessToken}`;
}

export const accountUser = () => current?.user;

export async function rejectAccount(authorization: string | undefined) {
  if (!current || authorization !== `Bearer ${current.accessToken}` || refresh) return;
  await SecureStore.deleteItemAsync(refreshKey);
  publish(undefined);
}

export async function signOutAccount(deleted = false) {
  if (!deleted) {
    const account = await restoreAccount();
    if (account) await auth('logout?scope=local', {}, account.accessToken);
  }
  await SecureStore.deleteItemAsync(refreshKey);
  publish(undefined);
}
