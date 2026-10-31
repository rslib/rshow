import { readFile } from 'node:fs/promises';
import process from 'node:process';
import tls from 'node:tls';
import type { Env } from './config.ts';
import { ApiError } from './exit.ts';
import { warn } from './warn.ts';

// Lowercase wins in node, and its name is the one the warning prints.
const PROXY_VARIABLES = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'] as const;

const TRUST_HINT =
  'your network may inspect HTTPS: set RSHOW_EXTRA_CA_FILE to its root certificate, or check that the system store has it';
const PROXY_HINT =
  'if a proxy stands between you and that host, set https_proxy and run with NODE_USE_ENV_PROXY=1';
const DNS_HINT = 'check the url in rshow config and your DNS';

type Fault = { reason: string; hint?: string; proxyHint?: boolean };

const TRUSTED = { reason: 'certificate not trusted', hint: TRUST_HINT };

// The code on the deepest error is the one that explains the failure; the
// wrappers above it only say that fetch gave up.
const REASONS: Record<string, Fault> = {
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: TRUSTED,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: TRUSTED,
  SELF_SIGNED_CERT_IN_CHAIN: TRUSTED,
  DEPTH_ZERO_SELF_SIGNED_CERT: TRUSTED,
  CERT_HAS_EXPIRED: TRUSTED,
  ERR_TLS_CERT_ALTNAME_INVALID: TRUSTED,
  ENOTFOUND: { reason: 'host not found', hint: DNS_HINT },
  EAI_AGAIN: { reason: 'host not found', hint: DNS_HINT },
  ECONNREFUSED: { reason: 'connection refused' },
  ETIMEDOUT: { reason: 'connection timed out', proxyHint: true },
  UND_ERR_CONNECT_TIMEOUT: { reason: 'connection timed out', proxyHint: true },
  ECONNRESET: { reason: 'connection reset', proxyHint: true },
};

export type NetworkFault = { reason: string; hint?: string };

type TlsCertificates = {
  getCACertificates?: (type: 'default' | 'system') => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function pemCertificatesOf(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

async function extraCertificates(env: Env): Promise<string[]> {
  const file = (env.RSHOW_EXTRA_CA_FILE ?? '').trim();
  if (file === '') return [];
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    warn(`cannot read RSHOW_EXTRA_CA_FILE ${file}: ${messageOf(err)}`);
    return [];
  }
  const certs = pemCertificatesOf(text);
  if (certs.length === 0) warn(`RSHOW_EXTRA_CA_FILE ${file} holds no PEM certificate`);
  return certs;
}

// Node's fetch trusts only the roots it bundles, which leaves out a cluster's
// own CA and the root of an HTTPS-inspecting proxy. The system store, and the
// file RSHOW_EXTRA_CA_FILE names, join those roots before the first request.
export async function installCaCertificates(env: Env = process.env): Promise<void> {
  const extra = await extraCertificates(env);
  const api = tls as TlsCertificates;
  if (typeof api.getCACertificates !== 'function' || typeof api.setDefaultCACertificates !== 'function') return;
  try {
    const certs = [...api.getCACertificates('default')];
    if (env.RSHOW_SYSTEM_CA !== '0') certs.push(...api.getCACertificates('system'));
    certs.push(...extra);
    api.setDefaultCACertificates([...new Set(certs)]);
  } catch {
    // A store node cannot read is no reason to stop: a request that needed a
    // root rshow did not add reports the reason instead.
  }
}

export function proxyVariableOf(env: Env): string | undefined {
  return PROXY_VARIABLES.find((name) => (env[name] ?? '').trim() !== '');
}

function envProxyEnabled(env: Env): boolean {
  const flag = (env.NODE_USE_ENV_PROXY ?? '').trim();
  if (flag !== '' && flag !== '0') return true;
  return process.execArgv.includes('--use-env-proxy');
}

let proxyNoticed = false;

// Node reads the proxy environment at startup and offers no switch after it, so
// the binary passes --use-env-proxy while an npm install needs the variable.
// Say so once, when a request is about to go out, and not on --help.
function noticeProxy(env: Env): void {
  if (proxyNoticed) return;
  proxyNoticed = true;
  const name = proxyVariableOf(env);
  if (name === undefined || envProxyEnabled(env)) return;
  warn(`${name} is set; run with NODE_USE_ENV_PROXY=1 (Node 24+) so rshow uses it`);
}

let installed: Promise<void> | undefined;

// Reading the system store costs about half a second on macOS, so it waits for
// the first request: a command that never reaches the network, such as --help,
// does not pay for it. Every request still goes through here first.
export function readyNetwork(env: Env = process.env): Promise<void> {
  installed ??= installCaCertificates(env);
  noticeProxy(env);
  return installed;
}

function codesOf(err: unknown, depth = 0): string[] {
  if (depth > 5 || err === null || typeof err !== 'object') return [];
  const out: string[] = [];
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code !== '') out.push(code);
  const inner = (err as { errors?: unknown }).errors;
  if (Array.isArray(inner)) for (const one of inner) out.push(...codesOf(one, depth + 1));
  out.push(...codesOf((err as { cause?: unknown }).cause, depth + 1));
  return out;
}

// The deepest message is the one with a fact in it: the wrappers above it only
// say that fetch failed.
function deepestMessageOf(err: unknown, depth = 0): string {
  if (depth > 5 || err === null || typeof err !== 'object') return '';
  const cause = deepestMessageOf((err as { cause?: unknown }).cause, depth + 1);
  if (cause !== '') return cause;
  const message = messageOf(err);
  return message === '' ? '' : message;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function faultOf(err: unknown, env: Env = process.env): NetworkFault {
  const codes = codesOf(err).reverse();
  for (const code of codes) {
    const known = REASONS[code];
    if (known === undefined) continue;
    const hint = known.proxyHint === true ? (proxyVariableOf(env) === undefined ? PROXY_HINT : undefined) : known.hint;
    return hint === undefined ? { reason: known.reason } : { reason: known.reason, hint };
  }
  return { reason: codes[0] ?? deepestMessageOf(err) };
}

// One line, for the table doctor prints and for a line that ends in ": detail".
export function networkDetail(err: unknown, url: string, env: Env = process.env): string {
  return `network error: ${hostOf(url)}: ${faultOf(err, env).reason}`;
}

// The same line, then the hint that tells the person what to try next.
export function networkText(err: unknown, url: string, env: Env = process.env): string {
  const fault = faultOf(err, env);
  const line = `network error: ${hostOf(url)}: ${fault.reason}`;
  return fault.hint === undefined ? line : `${line}\nhint: ${fault.hint}`;
}

export async function sendRequest(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
  env: Env = process.env,
): Promise<Response> {
  await readyNetwork(env);
  try {
    return await fetchImpl(url, init);
  } catch (err) {
    throw new ApiError(networkText(err, url, env));
  }
}
