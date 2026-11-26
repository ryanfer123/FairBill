import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { accountUser, cloudAuthorization, cloudBuild, rejectAccount } from './cloud-auth';
import type { components } from './generated/fairbill-v1';

type V1 = components['schemas'];
export type AssistanceResult = V1['AssistanceResult'];
export type CasePage = V1['CasePage'];

export type Kind = 'invoice' | 'policy' | 'settlement' | 'service_record';
export type RowType = 'charge' | 'invoice_total' | 'deduction' | 'clause' | 'order' | 'quantity';
export type Action = 'letter' | 'call';

export interface Row {
  id: string;
  type: RowType;
  page: number;
  line: number;
  description: string;
  code: string;
  service_date: string;
  reference: string;
  units: number | null;
  amount: number | null;
  unit_price: number | null;
  received: boolean | null;
}

export interface Document {
  id: string;
  kind: Kind;
  pages: string[];
  rows: Row[];
  notes: string[];
  sha256: string;
  confirmed: boolean;
  edited_rows?: string[];
}

export interface Source {
  document_id: string;
  document_kind: Kind;
  sha256: string;
  row_id: string;
  page: number;
  line: number;
  quote: string;
  relation: 'supports' | 'contradicts' | 'context' | 'patient_report';
  basis: 'patient_confirmed' | 'document';
}

export interface Finding {
  id: string;
  check: string;
  title: string;
  explanation: string;
  amount: number | null;
  status: 'active' | 'withdrawn' | 'linked';
  evidence: Source[];
}

export interface Scenario {
  billed: number | null;
  reconciled: boolean;
  adjustments: number | null;
  conditional: number | null;
  unresolved_deduction: number | null;
  included: string[];
  sources?: Partial<Record<'billed' | 'adjustments' | 'conditional' | 'unresolved_deduction', Source[]>>;
}

export interface Draft {
  action: Action;
  revision: number;
  hash: string;
  text: string;
  mode: string;
}

export interface Receipt {
  id: string;
  action: Action;
  revision: number;
  state: 'awaiting_identity' | 'verified' | 'completed';
  progress?: 'IDLE' | 'IDENTITY_PENDING' | 'IDENTITY_VERIFIED' | 'ADVOCATE_ACTIVE' | 'ENDED' | null;
  turns?: V1['Turn'][];
  outcome?: V1['Receipt']['outcome'];
}

export interface History {
  revision: number;
  scenario: Scenario;
  findings: Finding[];
  at: string;
}

export interface Case {
  id: string;
  sample: boolean;
  revision: number;
  investigated_revision: number | null;
  agent_mode: string | null;
  scenario: Scenario | null;
  findings: Finding[];
  documents: Document[];
  history: History[];
  follow_ups?: V1['FollowUp'][];
  timeline: { id: number; revision: number; title: string; detail: string; role: string; at: string }[];
  drafts: Partial<Record<Action, Draft>>;
  approvals: Partial<Record<Action, Draft>>;
  receipts: Record<string, Receipt>;
}

const hostedApi: string | undefined = Constants.expoConfig?.extra?.fairbillHostedApi;
const localDevApi: string | undefined = Constants.expoConfig?.extra?.fairbillLocalApi;
const networkError = 'FairBill could not reach its server. Check your internet connection and try again.';
export const hostedBuild = !!hostedApi && !cloudBuild;
const INVITE_KEY = 'fairbill_tester_invite';
const TOKEN_KEY = 'fairbill_installation';
const CASE_KEY = 'fairbill_last_case';
let tokenPromise: Promise<string> | undefined;
let backendPromise: Promise<Backend> | undefined;
let checkedAt: number | undefined;

export interface Backend {
  origin: string;
  prefix: '' | '/v1';
  profile: 'local' | 'fixtures' | 'hosted';
  mode?: 'Offline' | 'Gemini';
  indiaReview?: boolean;
  policyLookup?: boolean;
  reportLinks?: boolean;
  followUps?: boolean;
}

async function createToken() {
  const saved = await SecureStore.getItemAsync(TOKEN_KEY);
  if (saved) return saved;
  const generated = Array.from(await Crypto.getRandomBytesAsync(32))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(TOKEN_KEY, generated);
  return generated;
}

export async function headers(): Promise<Record<string, string>> {
  if (cloudBuild) return { Authorization: await cloudAuthorization() };
  tokenPromise ??= createToken().catch((error: unknown) => {
    tokenPromise = undefined;
    throw error;
  });
  const result: Record<string, string> = { Authorization: `Bearer ${await tokenPromise}` };
  if (hostedBuild) {
    const invite = await SecureStore.getItemAsync(INVITE_KEY);
    if (invite) result['X-FairBill-Invite'] = invite;
  }
  return result;
}

export async function endpoint() {
  const configured = hostedApi ?? localDevApi;
  if (!configured) throw new Error('FairBill is missing its server configuration.');
  return configured;
}

async function discover(origin: string): Promise<Backend> {
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), cloudBuild ? 65000 : 5000);
  try {
    const versioned = await fetch(`${origin}/v1/health`, { signal: signal.signal });
    const prefix = !hostedApi && versioned.status === 404 ? '' : '/v1';
    const response = prefix ? versioned : await fetch(`${origin}/health`, { signal: signal.signal });
    const result: Partial<Omit<V1['Health'], 'profile'>> & { profile?: string } = await response.json();
    if (!response.ok || result.status !== 'ok'
      || (cloudBuild ? result.profile !== 'hosted' || result.demo !== null : result.demo !== 'synthetic' || (hostedBuild && result.profile !== 'fixtures'))) {
      throw new Error('FairBill server health check failed.');
    }
    const features = response.headers.get('X-FairBill-Features')?.split(',').map((feature) => feature.trim()) ?? [];
    return {
      origin, prefix, profile: cloudBuild ? 'hosted' : result.profile === 'fixtures' ? 'fixtures' : 'local',
      indiaReview: features.includes('india-review'),
      policyLookup: features.includes('policy-lookup'),
      reportLinks: features.includes('report-links'),
      followUps: features.includes('follow-ups'),
      mode: result.mode === 'Gemini' || result.mode === 'Offline' ? result.mode : undefined,
    };
  } catch {
    throw new Error(networkError);
  } finally {
    clearTimeout(timer);
  }
}

export function getBackend(refresh = false) {
  if (refresh && checkedAt !== undefined && Date.now() - checkedAt > 2000) backendPromise = undefined;
  if (!backendPromise) {
    checkedAt = undefined;
    backendPromise = endpoint().then(discover).then((backend) => {
      checkedAt = Date.now();
      return backend;
    }).catch((error: unknown) => {
      backendPromise = undefined;
      throw error;
    });
  }
  return backendPromise;
}

export async function apiUrl(path: string) {
  const backend = await getBackend();
  return `${backend.origin}${backend.prefix}${path}`;
}

export async function configureInvite(raw: string) {
  if (!hostedBuild) return;
  const invite = raw.trim();
  if (!invite || invite.length > 256 || /[\r\n]/.test(invite)) throw new Error('Enter a valid tester invite code.');
  const backend = await getBackend();
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), 5000);
  try {
    const response = await fetch(`${backend.origin}${backend.prefix}/cases?limit=1`, {
      headers: { ...await headers(), 'X-FairBill-Invite': invite }, signal: signal.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error('The tester invite code was rejected.');
    if (!response.ok) throw new Error('Could not validate the tester invite. Try again.');
    await SecureStore.setItemAsync(INVITE_KEY, invite);
  } finally {
    clearTimeout(timer);
  }
}

function lastCaseKey() {
  if (!cloudBuild) return CASE_KEY;
  const user = accountUser();
  if (!user) throw new Error('Sign in to open your cases.');
  return `${CASE_KEY}.${user.id}`;
}

export const lastCase = async () => SecureStore.getItemAsync(lastCaseKey());
export const rememberCase = async (id: string) => SecureStore.setItemAsync(lastCaseKey(), id);
export const forgetCase = async () => SecureStore.deleteItemAsync(lastCaseKey());

export class ApiError extends Error {
  constructor(readonly status: number, detail: string) { super(detail); }
}

async function readWithRetry(url: string, init: RequestInit, signal: AbortSignal) {
  for (const delay of [350, 900, 0]) {
    try {
      const response = await fetch(url, init);
      if (!delay || signal.aborted || ![502, 503, 504].includes(response.status)) return response;
    } catch (error) {
      if (!delay || signal.aborted) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (signal.aborted) throw new Error(networkError);
  }
  throw new Error(networkError);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const [backend, auth] = await Promise.all([getBackend(), headers()]);
  const control = new AbortController();
  const abort = () => control.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 65000);
  try {
    const requestHeaders = new Headers(options.headers);
    for (const [key, value] of Object.entries(auth)) requestHeaders.set(key, value);
    if (backend.prefix && options.method && options.method !== 'GET') {
      if (!requestHeaders.has('Idempotency-Key')) requestHeaders.set('Idempotency-Key', Crypto.randomUUID());
    }
    const url = `${backend.origin}${backend.prefix}${path}`;
    const init = { ...options, headers: requestHeaders, signal: control.signal };
    const read = !options.method || options.method.toUpperCase() === 'GET';
    const response = await (read ? readWithRetry(url, init, control.signal) : fetch(url, init));
    if (response.status === 204) return undefined as T;
    if ([502, 503, 504].includes(response.status)) throw new Error(networkError);
    const payload = await response.json();
    if (!response.ok) {
      if (cloudBuild && response.status === 401) await rejectAccount(auth.Authorization);
      throw new ApiError(response.status, typeof payload.message === 'string' ? payload.message : typeof payload.detail === 'string'
        ? payload.detail : 'Could not complete the request.');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    backendPromise = undefined;
    throw new Error(networkError);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export const getCase = (id: string) => request<Case>(`/cases/${id}`);
export const createCase = (sample: boolean) => postCase('/cases', { sample });
export const deleteCase = (id: string) => request<void>(`/cases/${id}`, { method: 'DELETE' });
export const newImportId = () => Crypto.randomUUID().replace(/-/g, '');
export function postCase(path: string, data: object | FormData, importId?: string, signal?: AbortSignal) {
  const multipart = data instanceof FormData;
  return request<Case>(path, {
    method: 'POST', signal,
    body: multipart ? data : JSON.stringify(data),
    headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(importId ? { 'Idempotency-Key': `import-${importId}` } : {}) },
  });
}

export const KINDS: Record<Kind, string> = {
  invoice: 'Hospital invoice', policy: 'Insurance policy',
  settlement: 'Settlement statement', service_record: 'Service record',
};

export function money(paise: number | null) {
  if (paise === null) return '—';
  const digits = String(Math.abs(paise)).padStart(3, '0');
  const rupees = Number(digits.slice(0, -2)).toLocaleString('en-IN');
  const remainder = digits.slice(-2);
  return `${paise < 0 ? '−' : ''}₹${rupees}${remainder === '00' ? '' : `.${remainder}`}`;
}

export function parseRupees(value: string) {
  const cleaned = value.trim().replace(/[₹,]/g, '');
  if (!cleaned) return null;
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(cleaned)) throw new Error('Use a rupee amount with up to two decimal places.');
  const [whole = '', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
