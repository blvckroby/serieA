import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
let server;

const json = async url => (await fetch(`${BASE}${url}`)).json();
const catalog = async id => (await json(`/catalog/Live%20Sports/${id}.json`)).metas;
const byId = (metas, n) => metas.find(m => m.id === `seriea:soccer:${n}`);

before(async () => {
  server = spawn('node', ['--import', path.join(root, 'test/mock-fetch.mjs'), 'src/server.js'],
    { cwd: root, env: { ...process.env, PORT: String(PORT), PUBLIC_BASE_URL: 'https://addon.test' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server non avviato');
});
after(() => server?.kill());

test('manifest: tre cataloghi, id con prefisso proprio e logo', async () => {
  const m = await json('/manifest.json');
  assert.deepEqual(m.catalogs.map(c => c.id), ['serie-a', 'champions-league', 'europa-league']);
  assert.deepEqual(m.idPrefixes, ['seriea:']);
  assert.match(m.logo, /^https:\/\/addon\.test\/logo\.png\?v=/);
  assert.equal((await fetch(`${BASE}/logo.png`)).status, 200);
});

test('Serie A: titolo pulito, niente Serie B / altre leghe / Champions', async () => {
  const metas = await catalog('serie-a');
  assert.deepEqual(metas.map(m => m.id), ['seriea:soccer:1', 'seriea:soccer:2']);
  assert.equal(byId(metas, 1).name, 'Inter vs Juventus');
});

test('Serie A: Simulcast diventa Diretta Goal con la sua copertina', async () => {
  const m = byId(await catalog('serie-a'), 2);
  assert.equal(m.name, 'Diretta Goal');
  assert.match(m.poster, /^https:\/\/image\.discovery\.indazn\.com\//);
  assert.equal(m.background, m.poster);
});

test('Champions: titolo senza prefisso né bandiere', async () => {
  const metas = await catalog('champions-league');
  assert.equal(byId(metas, 3).name, 'AEK Athens vs Real Madrid');
  assert.equal(byId(metas, 4).name, 'Bodø/Glimt vs Borussia Dortmund');
});

test('Champions: esclusa la femminile e le altre competizioni', async () => {
  const ids = (await catalog('champions-league')).map(m => m.id);
  assert.ok(!ids.includes('seriea:soccer:6'));
  assert.ok(!ids.includes('seriea:soccer:8'));
  assert.ok(!ids.includes('seriea:soccer:7'));
});

test('Champions: copertina locale abbinata anche con nomi diversi', async () => {
  const metas = await catalog('champions-league');
  assert.equal(byId(metas, 3).poster, 'https://addon.test/covers/champions/aek-athens_vs_real-madrid.webp');
  assert.equal(byId(metas, 4).poster, 'https://addon.test/covers/champions/bodo-glimt_vs_borussia-dortmund.webp');
  assert.equal(byId(metas, 5).poster, 'https://addon.test/covers/champions/villarreal_vs_paris-saint-germain.webp');
});

test('Champions: ogni copertina referenziata esiste davvero', async () => {
  for (const m of await catalog('champions-league')) {
    if (!m.poster) continue;
    const r = await fetch(m.poster.replace('https://addon.test', BASE));
    assert.equal(r.status, 200, m.poster);
    assert.equal(r.headers.get('content-type'), 'image/webp');
  }
});

test('Champions: senza copertina resta quella originale', async () => {
  const m = byId(await catalog('champions-league'), 9);
  assert.equal(m.name, 'Napoli vs Squadra Sconosciuta');
  assert.equal(m.poster, undefined);
});

test('Europa League: catalogo separato, titolo pulito', async () => {
  const metas = await catalog('europa-league');
  assert.deepEqual(metas.map(m => m.id), ['seriea:soccer:8']);
  assert.equal(metas[0].name, 'Roma vs Porto');
  assert.equal(metas[0].poster, 'orig');
});

test('meta: ID proprio, stesso poster del catalogo', async () => {
  const cat = byId(await catalog('champions-league'), 3);
  const { meta } = await json('/meta/Live%20Sports/seriea%3Asoccer%3A3.json');
  assert.equal(meta.id, 'seriea:soccer:3');
  assert.equal(meta.name, cat.name);
  assert.equal(meta.poster, cat.poster);
  assert.equal(meta.background, cat.background);
});

test('meta/stream: eventi di altre competizioni rifiutati', async () => {
  assert.equal((await json('/meta/Live%20Sports/seriea%3Asoccer%3A7.json')).meta, null);
  assert.deepEqual((await json('/stream/Live%20Sports/seriea%3Asoccer%3A10.json')).streams, []);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Asoccer%3A3.json')).streams.length, 1);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Asoccer%3A8.json')).streams.length, 1);
});
