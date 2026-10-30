import type { Client } from './client.ts';
import type { AppConfig } from './config.ts';
import type { Output } from './output.ts';

export type Ctx = {
  api: (dir?: string) => Promise<Client>;
  config: (dir?: string) => Promise<AppConfig>;
  out: Output;
};
