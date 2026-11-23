import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

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
const TOKEN_KEY = 'fairbill_installation';
const ENDPOINT_KEY = 'fairbill_endpoint';
const CASE_KEY = 'fairbill_last_case';
let tokenPromise: Promise<string> | undefined;
let endpointPromise: Promise<string> | undefined;

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
  return { Authorization: `Bearer ${await tokenPromise}` };
}

export function endpoint() {
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

export async function testEndpoint(base: string) {
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), 5000);
  try {
    const response = await fetch(`${validEndpoint(base)}/health`, { signal: signal.signal });
    const result = await response.json();
    if (!response.ok || result.demo !== 'synthetic') throw new Error('FairBill demo service did not respond.');
  } catch {
    throw new Error('Could not reach the FairBill demo. Check the local server and USB or Wi-Fi connection.');
  } finally {
    clearTimeout(timer);
  }
}

export async function configureEndpoint(raw: string) {
  const base = validEndpoint(raw);
  await testEndpoint(base);
  await SecureStore.setItemAsync(ENDPOINT_KEY, base);
  endpointPromise = Promise.resolve(base);
  return base;
}

export const lastCase = () => SecureStore.getItemAsync(CASE_KEY);
export const rememberCase = (id: string) => SecureStore.setItemAsync(CASE_KEY, id);

export class ApiError extends Error {
  constructor(readonly status: number, detail: string) { super(detail); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const [base, auth] = await Promise.all([endpoint(), headers()]);
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 65000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...auth, ...options.headers },
      signal: control.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, typeof payload.detail === 'string' ? payload.detail : 'Could not complete the request.');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('Could not reach the FairBill demo. Check the connection in Settings and try again.');
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
  const fraction = paise % 100;
  return `₹${Math.floor(paise / 100).toLocaleString('en-IN')}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}
