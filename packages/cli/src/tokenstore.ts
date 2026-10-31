import process from 'node:process';
import { UsageError } from './exit.ts';
import * as credfile from './credfile.ts';
import * as keychain from './keychain.ts';
import * as keyring from './keyring.ts';

export type Backend = 'keychain' | 'keyring' | 'file';

export type Store = {
  backend: Backend;
  detail: string;
  description: string;
  read: (url: string) => Promise<string | undefined>;
  save: (url: string, token: string) => Promise<void>;
  remove: (url: string) => Promise<boolean>;
};

type Env = Record<string, string | undefined>;

const BACKENDS = ['keychain', 'keyring', 'file'] as const;

function storeOf(backend: Backend, env: Env): Store {
  if (backend === 'keychain') {
    return {
      backend,
      detail: 'keychain',
      description: 'the macOS Keychain',
      read: (url) => keychain.read(url, env),
      save: (url, token) => keychain.save(url, token, env),
      remove: (url) => keychain.remove(url, env),
    };
  }
  if (backend === 'keyring') {
    return {
      backend,
      detail: 'keyring',
      description: 'the Linux keyring',
      read: (url) => keyring.read(url, env),
      save: (url, token) => keyring.save(url, token, env),
      remove: (url) => keyring.remove(url, env),
    };
  }
  const file = credfile.credentialsPath(env);
  return {
    backend,
    detail: `file ${file}`,
    description: `${file} (mode 600)`,
    read: (url) => credfile.read(file, url),
    save: (url, token) => credfile.save(file, url, token),
    remove: (url) => credfile.remove(file, url),
  };
}

// RSHOW_TOKEN_STORE forces one backend, which a test uses to run a backend the
// machine it runs on does not have.
export function forced(env: Env): Backend | undefined {
  const text = (env.RSHOW_TOKEN_STORE ?? '').trim();
  if (text === '') return undefined;
  for (const backend of BACKENDS) {
    if (backend === text) return backend;
  }
  throw new UsageError(`RSHOW_TOKEN_STORE must be keychain, keyring or file, not ${text}`);
}

// The keychain holds the token on macOS, the keyring on a Linux desktop that
// has one, and a 0600 file everywhere else.
export async function choose(env: Env = process.env, platform: string = process.platform): Promise<Store> {
  const forcedBackend = forced(env);
  if (forcedBackend !== undefined) return storeOf(forcedBackend, env);
  if (keychain.canSave(platform, env.RSHOW_SECURITY_BIN)) return storeOf('keychain', env);
  if (keyring.canUse(env, platform) && (await keyring.usable(env))) return storeOf('keyring', env);
  return storeOf('file', env);
}

// Every store this machine may hold a token in, so that logout leaves nothing
// behind after a switch of backend.
export async function every(env: Env = process.env, platform: string = process.platform): Promise<Store[]> {
  const stores: Store[] = [];
  if (keychain.canSave(platform, env.RSHOW_SECURITY_BIN)) stores.push(storeOf('keychain', env));
  if (keyring.canUse(env, platform) && (await keyring.usable(env))) stores.push(storeOf('keyring', env));
  stores.push(storeOf('file', env));
  return stores;
}
