import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer as createTlsServer } from 'node:https';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import tls from 'node:tls';
import { run as login } from '../src/commands/login.ts';
import type { Ctx } from '../src/context.ts';
import { EXIT } from '../src/exit.ts';
import { canSave } from '../src/keychain.ts';
import { faultOf, installCaCertificates, networkDetail, pemCertificatesOf } from '../src/network.ts';
import { Output } from '../src/output.ts';
import { artifact, makeTempDir, runCli } from './helpers.ts';

function openssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const noOpenssl = openssl() ? false : 'openssl is not installed';

// A certificate and its key for localhost, made here rather than checked in.
async function selfSigned(dir: string): Promise<{ cert: string; key: string }> {
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  return { cert, key };
}

type TlsApi = { url: string; close: () => Promise<void> };

async function startTlsApi(cert: string, key: string): Promise<TlsApi> {
  const server = createTlsServer({ cert: await readFile(cert), key: await readFile(key) }, (req, res) => {
    if (req.method === 'GET' && req.url === '/api/artifacts') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ artifacts: [artifact('site')] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  // Every interface, so that localhost may resolve to ::1 or to 127.0.0.1.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `https://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 9;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function stderrOf(work: () => Promise<void>): Promise<string> {
  const original = process.stderr.write;
  let text = '';
  process.stderr.write = ((chunk: string) => {
    text += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    await work();
  } finally {
    process.stderr.write = original;
  }
  return text;
}

function failure(code: string, message = 'fetch failed'): Error {
  return new Error(message, { cause: Object.assign(new Error(`connect ${code}`), { code }) });
}

test('a certificate node does not trust is named as such, with a hint', () => {
  for (const code of [
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ]) {
    assert.equal(faultOf(failure(code), {}).reason, 'certificate not trusted');
  }
  const detail = networkDetail(failure('DEPTH_ZERO_SELF_SIGNED_CERT'), 'https://artd.example.com/api/me');
  assert.equal(detail, 'network error: artd.example.com: certificate not trusted');
  const hint = faultOf(failure('DEPTH_ZERO_SELF_SIGNED_CERT'), {}).hint ?? '';
  assert.match(hint, /RSHOW_EXTRA_CA_FILE/);
});

test('the deepest code wins, and an unknown one is printed', () => {
  const nested = new Error('fetch failed', {
    cause: new Error('connect failed', { cause: Object.assign(new Error('dns'), { code: 'ENOTFOUND' }) }),
  });
  assert.deepEqual(faultOf(nested, {}), {
    reason: 'host not found',
    hint: 'check the url in rshow config and your DNS',
  });

  assert.deepEqual(faultOf(failure('ECONNREFUSED'), {}), { reason: 'connection refused' });
  assert.deepEqual(faultOf(failure('ECONNABORTED'), {}), { reason: 'ECONNABORTED' });
  assert.deepEqual(faultOf(new Error('fetch failed'), {}), { reason: 'fetch failed' });
  const badPort = new Error('fetch failed', { cause: new Error('bad port') });
  assert.deepEqual(faultOf(badPort, {}), { reason: 'bad port' });
});

test('a timeout or a reset hints at the proxy only when none is set', () => {
  for (const code of ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET']) {
    const direct = faultOf(failure(code), {});
    assert.ok(direct.hint !== undefined && direct.hint.includes('https_proxy'), `${code} needs a proxy hint`);
    const proxied = faultOf(failure(code), { https_proxy: 'http://proxy.example.com:3128' });
    assert.equal(proxied.hint, undefined);
  }
});

test('a PEM file gives the certificates it holds', () => {
  const one = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  const other = '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----';
  assert.deepEqual(pemCertificatesOf(one), [one]);
  assert.deepEqual(pemCertificatesOf(`text\n${one}\n${other}\n`), [one, other]);
  assert.deepEqual(pemCertificatesOf('nothing here'), []);
});

test('RSHOW_EXTRA_CA_FILE joins the trusted roots', { skip: noOpenssl }, async () => {
  const dir = await makeTempDir({});
  const { cert } = await selfSigned(dir);
  const wanted = (pemCertificatesOf(await readFile(cert, 'utf8'))[0] ?? '').replace(/\s+/g, '');
  assert.ok(wanted !== '');

  await installCaCertificates({ RSHOW_EXTRA_CA_FILE: cert, RSHOW_SYSTEM_CA: '0' });
  assert.ok(tls.getCACertificates('default').some((root) => root.replace(/\s+/g, '') === wanted));

  const missing = path.join(dir, 'missing.pem');
  const warning = await stderrOf(() => installCaCertificates({ RSHOW_EXTRA_CA_FILE: missing }));
  assert.match(warning, /cannot read RSHOW_EXTRA_CA_FILE/);
});

test('the system store is trusted unless RSHOW_SYSTEM_CA=0', async () => {
  const system = tls.getCACertificates('system');
  await installCaCertificates({});
  const roots = tls.getCACertificates('default').map((root) => root.replace(/\s+/g, ''));
  for (const cert of system) assert.ok(roots.includes(cert.replace(/\s+/g, '')), 'a system root is missing');
});

test('a self-signed host is refused until its CA is trusted', { skip: noOpenssl }, async (t) => {
  const dir = await makeTempDir({});
  const { cert, key } = await selfSigned(dir);
  const api = await startTlsApi(cert, key);
  t.after(() => api.close());
  const env = { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' };

  const refused = await runCli(['list'], env);
  assert.equal(refused.code, EXIT.api);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^rshow: network error: localhost:\d+: certificate not trusted$/m);
  assert.match(refused.stderr, /^hint: .*RSHOW_EXTRA_CA_FILE/m);

  const trusted = await runCli(['list'], { ...env, RSHOW_EXTRA_CA_FILE: cert });
  assert.equal(trusted.stderr, '');
  assert.equal(trusted.code, EXIT.ok);
  assert.equal(trusted.stdout, 'site private v1 site\n');

  const alone = await runCli(['list'], { ...env, RSHOW_EXTRA_CA_FILE: cert, RSHOW_SYSTEM_CA: '0' });
  assert.equal(alone.code, EXIT.ok);
  assert.equal(alone.stdout, 'site private v1 site\n');
});

test('a refused port names the host and the reason', async () => {
  const port = await closedPort();
  const result = await runCli(['list'], {
    RSHOW_URL: `http://127.0.0.1:${port}`,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, EXIT.api);
  assert.equal(result.stderr, `rshow: network error: 127.0.0.1:${port}: connection refused\n`);
});

test('doctor says the same reason on its api and art lines', async () => {
  const port = await closedPort();
  const url = `http://127.0.0.1:${port}`;
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url, art: url }) });

  const result = await runCli(['doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, EXIT.check);
  const reason = `network error: 127.0.0.1:${port}: connection refused`;
  assert.match(result.stdout, new RegExp(`^fail {2}api {2}${reason}$`, 'm'));
  assert.match(result.stdout, new RegExp(`^warn {2}art {2}${reason}$`, 'm'));
});

test('a proxy variable node will ignore is named once', async () => {
  const port = await closedPort();
  const url = `http://127.0.0.1:${port}`;
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url, art: url }) });
  const env = { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_secret', https_proxy: 'http://proxy.example.com:3128' };

  const warned = await runCli(['doctor'], env);
  const lines = warned.stderr.split('\n').filter((line) => line.includes('NODE_USE_ENV_PROXY'));
  assert.deepEqual(lines, [
    'rshow: warning: https_proxy is set; run with NODE_USE_ENV_PROXY=1 (Node 24+) so rshow uses it',
  ]);

  const enabled = await runCli(['doctor'], { ...env, NODE_USE_ENV_PROXY: '1' });
  assert.doesNotMatch(enabled.stderr, /NODE_USE_ENV_PROXY/);
});

test('login off macOS says what to do before it asks for a token', async () => {
  const ctx: Ctx = {
    config: () => {
      throw new Error('login read the config');
    },
    api: () => {
      throw new Error('login called the api');
    },
    out: new Output(false),
  };

  await assert.rejects(login([], ctx, 'linux'), {
    name: 'UsageError',
    message: 'rshow login keeps the token in the macOS Keychain; on this system set RSHOW_TOKEN instead (see rshow doctor)',
  });

  assert.equal(canSave('linux', undefined), false);
  assert.equal(canSave('linux', '/fake/security'), true);
  assert.equal(canSave('darwin', undefined), true);
});
