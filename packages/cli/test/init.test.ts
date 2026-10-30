import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { makeTempDir, runCli } from './helpers.ts';

test('init writes the global config file and names the next step', async () => {
  const xdg = await makeTempDir({});
  const result = await runCli(['init', '--url', 'https://admin.test/', '--art', 'https://view.test//'], {
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);

  const file = path.join(xdg, 'rshow', 'config.json');
  assert.equal(result.stdout, `wrote ${file}\nnext: rshow login\n`);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    url: 'https://admin.test',
    art: 'https://view.test',
  });

  const printed = await runCli(['config', '--offline'], { XDG_CONFIG_HOME: xdg });
  assert.equal(printed.code, 0);
  assert.equal(JSON.parse(printed.stdout).url, 'https://admin.test');
  assert.equal(JSON.parse(printed.stdout).art, 'https://view.test');
});

test('init --json prints the path and the two urls', async () => {
  const xdg = await makeTempDir({});
  const result = await runCli(
    ['--json', 'init', '--url', 'https://admin.test', '--art', 'https://view.test', '--theme', 'mono'],
    { XDG_CONFIG_HOME: xdg },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const body = JSON.parse(result.stdout);
  assert.deepEqual(body, {
    path: path.join(xdg, 'rshow', 'config.json'),
    url: 'https://admin.test',
    art: 'https://view.test',
  });
  assert.equal(JSON.parse(await readFile(body.path, 'utf8')).theme, 'mono');
});

test('init needs both urls', async () => {
  const xdg = await makeTempDir({});
  const noUrl = await runCli(['init', '--art', 'https://view.test'], { XDG_CONFIG_HOME: xdg });
  assert.equal(noUrl.code, 2);
  assert.match(noUrl.stderr, /--url/);

  const noArt = await runCli(['init', '--url', 'https://admin.test'], { XDG_CONFIG_HOME: xdg });
  assert.equal(noArt.code, 2);
  assert.match(noArt.stderr, /--art/);

  const empty = await runCli(['init', '--url', 'https://admin.test', '--art', '  '], { XDG_CONFIG_HOME: xdg });
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /--art/);
});

test('init wants https except on loopback', async () => {
  const xdg = await makeTempDir({});
  const plain = await runCli(['init', '--url', 'http://admin.test', '--art', 'https://view.test'], {
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(plain.code, 2);
  assert.match(plain.stderr, /--url must be an https:\/\/ url/);

  const local = await runCli(
    ['init', '--url', 'http://127.0.0.1:8787', '--art', 'http://localhost:8788'],
    { XDG_CONFIG_HOME: xdg },
  );
  assert.equal(local.code, 0);
  const body = JSON.parse(await readFile(path.join(xdg, 'rshow', 'config.json'), 'utf8'));
  assert.equal(body.url, 'http://127.0.0.1:8787');
  assert.equal(body.art, 'http://localhost:8788');
});

test('init keeps other fields and refuses to replace a url unless forced', async () => {
  const xdg = await makeTempDir({
    'rshow/config.json': JSON.stringify({
      url: 'https://old.test',
      art: 'https://view.test',
      theme: 'mono@2',
      tokens: { '--ink': '#111111' },
    }),
  });
  const file = path.join(xdg, 'rshow', 'config.json');

  const refused = await runCli(['init', '--url', 'https://new.test', '--art', 'https://view.test'], {
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /already has https:\/\/old\.test/);
  assert.match(refused.stderr, /--force/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    url: 'https://old.test',
    art: 'https://view.test',
    theme: 'mono@2',
    tokens: { '--ink': '#111111' },
  });

  const swapped = await runCli(['init', '--url', 'https://new.test', '--art', 'https://view2.test', '--force'], {
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(swapped.code, 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    url: 'https://new.test',
    art: 'https://view2.test',
    theme: 'mono@2',
    tokens: { '--ink': '#111111' },
  });
});
