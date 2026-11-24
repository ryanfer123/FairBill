import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
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
  timeline: { id: number; revision: number; title: string; detail: string; role: string; at: string }[];
  drafts: Partial<Record<Action, Draft>>;
  approvals: Partial<Record<Action, Draft>>;
  receipts: Record<string, Receipt>;
}

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';
const hostedApi: string | undefined = Constants.expoConfig?.extra?.fairbillHostedApi;
export const hostedBuild = !!hostedApi;
const INVITE_KEY = 'fairbill_tester_invite';
const TOKEN_KEY = 'fairbill_installation';
const ENDPOINT_KEY = 'fairbill_endpoint';
const CASE_KEY = 'fairbill_last_case';
let tokenPromise: Promise<string> | undefined;
let endpointPromise: Promise<string> | undefined;
let backendPromise: Promise<Backend> | undefined;

export interface Backend {
  origin: string;
  prefix: '' | '/v1';
  profile: 'local' | 'fixtures';
  mode?: 'Offline' | 'Gemini';
}

async function createToken() {
  const saved = await SecureStore.getItemAsync(TOKEN_KEY);
  if (saved) return saved;
  const generated = Array.from(await Crypto.getRandomBytesAsync(32))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(TOKEN_KEY, generated);
  return generated;
}

export async function headers() {
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

export function endpoint() {
  if (hostedApi) return Promise.resolve(hostedApi);
  endpointPromise ??= SecureStore.getItemAsync(ENDPOINT_KEY).then((value) => value || DEFAULT_ENDPOINT);
  return endpointPromise;
}

function validEndpoint(raw: string) {
  const value = raw.trim().replace(/\/$/, '');
  const match = /^https?:\/\/([a-zA-Z0-9.-]+)(:\d{1,5})?$/.exec(value);
  if (!match) throw new Error('Use a local address such as http://192.168.1.5:8765.');
  const host = match[1] ?? '';
  const octets = host.split('.').map(Number);
  const [first, second] = octets;
  const privateIP = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (first === 127 || first === 10 || (first === 192 && second === 168)
      || (first === 172 && typeof second === 'number' && second >= 16 && second <= 31));
  if (!privateIP && host !== 'localhost' && !host.endsWith('.local')) {
    throw new Error('Choose a loopback or private network address.');
  }
  return value;
}

async function discover(base: string): Promise<Backend> {
  const origin = hostedApi ?? validEndpoint(base);
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), 5000);
  try {
    const versioned = await fetch(`${origin}/v1/health`, { signal: signal.signal });
    const prefix = !hostedBuild && versioned.status === 404 ? '' : '/v1';
    const response = prefix ? versioned : await fetch(`${origin}/health`, { signal: signal.signal });
    const result: Partial<V1['Health']> = await response.json();
    if (!response.ok || result.demo !== 'synthetic' || result.status !== 'ok'
      || (hostedBuild && result.profile !== 'fixtures')) {
      throw new Error('FairBill demo service did not respond.');
    }
    return {
      origin, prefix, profile: result.profile === 'fixtures' ? 'fixtures' : 'local',
      mode: result.mode === 'Gemini' || result.mode === 'Offline' ? result.mode : undefined,
    };
  } catch {
    throw new Error(hostedBuild ? 'FairBill could not reach the test server. Check your network connection and retry.'
      : 'FairBill could not reach the laptop API. Start the demo server, then check USB forwarding or the local Wi-Fi address.');
  } finally {
    clearTimeout(timer);
  }
}

export async function testEndpoint(base: string): Promise<Backend> {
  const backend = await discover(base);
  if (base === await endpoint()) backendPromise = Promise.resolve(backend);
  return backend;
}

export function getBackend() {
  backendPromise ??= endpoint().then(discover).catch((error: unknown) => {
    backendPromise = undefined;
    throw error;
  });
  return backendPromise;
}

export async function apiUrl(path: string) {
  const backend = await getBackend();
  return `${backend.origin}${backend.prefix}${path}`;
}

export async function configureEndpoint(raw: string) {
  if (hostedBuild) throw new Error('This test build uses its configured FairBill server.');
  const base = validEndpoint(raw);
  const backend = await discover(base);
  await SecureStore.setItemAsync(ENDPOINT_KEY, base);
  endpointPromise = Promise.resolve(base);
  backendPromise = Promise.resolve(backend);
  return base;
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

export const lastCase = () => SecureStore.getItemAsync(CASE_KEY);
export const rememberCase = (id: string) => SecureStore.setItemAsync(CASE_KEY, id);

export class ApiError extends Error {
  constructor(readonly status: number, detail: string) { super(detail); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const [backend, auth] = await Promise.all([getBackend(), headers()]);
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 65000);
  try {
    const requestHeaders = new Headers(options.headers);
    for (const [key, value] of Object.entries(auth)) requestHeaders.set(key, value);
    if (backend.prefix && options.method && options.method !== 'GET') {
      requestHeaders.set('Idempotency-Key', Crypto.randomUUID());
    }
    const response = await fetch(`${backend.origin}${backend.prefix}${path}`, {
      ...options,
      headers: requestHeaders,
      signal: control.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, typeof payload.message === 'string' ? payload.message : typeof payload.detail === 'string'
        ? payload.detail : 'Could not complete the request.');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    backendPromise = undefined;
    throw new Error(hostedBuild ? 'FairBill could not reach the test server. Check your network connection and retry.'
      : 'FairBill could not reach the laptop API. Start the demo server, check USB forwarding or the local Wi-Fi address in Settings, then retry.');
  } finally {
    clearTimeout(timer);
  }
}

export const getCase = (id: string) => request<Case>(`/cases/${id}`);
export const createCase = (sample: boolean) => postCase('/cases', { sample });
export function postCase(path: string, data: object | FormData) {
  const multipart = data instanceof FormData;
  return request<Case>(path, {
    method: 'POST',
    body: multipart ? data : JSON.stringify(data),
    headers: multipart ? {} : { 'Content-Type': 'application/json' },
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
