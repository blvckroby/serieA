import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMotorsport, makeMotorCovers } from '../src/motorsport.js';

// ---------- Parser (nessun server) ----------
const P = name => parseMotorsport(name);
const SHAPE = r => r && [r.key, r.title, r.coverName];

test('parser: titoli reali EasySports', () => {
  assert.deepEqual(SHAPE(P('🏎️🇶🇦 Formula 1 Qatar Grand Prix – Practice 1 | Lusail, Qatar | 27 November 2026')),
    ['formula-1', 'F1 Qatar – Prove libere 1', 'qatar-free-practice-1']);
  assert.deepEqual(SHAPE(P('🏎️ MotoGP : Round 22 | Valencia Practice 1')),
    ['motogp', 'MotoGP Valencia – Prove libere 1', 'valencia-free-practice-1']);
});

test('parser: tutte le categorie e le varianti di scrittura', () => {
  const table = [
    ['🏎️ Moto2 : Round 22 | Valencia Qualifying 2', 'moto2', 'valencia-qualifying-2'],
    ['🏎️ Moto 3 : Round 22 | Valencia Q1', 'moto3', 'valencia-qualifying-1'],
    ['🏎️ MotoGP : Round 22 | Valencia Tissot Sprint', 'motogp', 'valencia-sprint'],
    ['🏎️ MotoGP : Round 22 | Valencia Grand Prix', 'motogp', 'valencia-race'],
    ['🏎️ FIM MotoGP World Championship : Round 3 | Qatar Warm Up', 'motogp', 'qatar-warm-up'],
    ['🏎️ Formula 2 Abu Dhabi Grand Prix – Sprint Race | Yas Marina', 'formula-2', 'abu-dhabi-sprint'],
    ['🏎️ F3: Abu Dhabi GP | Feature Race | Yas Marina', 'formula-3', 'abu-dhabi-feature-race'],
    ['🏎️ FIA Formula 3 Emilia-Romagna Grand Prix - Qualifying', 'formula-3', 'emilia-romagna-qualifying'],
    ['🏎️ Formula 1 Qatar Grand Prix | Sprint Qualifying | Lusail', 'formula-1', 'qatar-sprint-qualifying'],
    ['🏎️ Formula One Monaco Grand Prix Free Practice 2', 'formula-1', 'monaco-free-practice-2'],
    ['🏎️ Formula 1 Qatar Grand Prix', 'formula-1', 'qatar-race']
  ];
  for (const [name, key, cover] of table) {
    const r = P(name);
    assert.ok(r, name);
    assert.equal(r.key, key, name);
    assert.equal(r.coverName, cover, name);
  }
});

test('parser: Formula E, MotoE, F1 Academy, calcio e altro restano fuori', () => {
  for (const x of ['🏎️ Formula E Berlin E-Prix – Race', '🏎️ MotoE : Round 5 | Valencia Race', '🏎️ F1 Academy Miami – Race',
    '⚽ Italy - Serie A : Inter vs Juventus', 'NASCAR Cup', '', undefined, null, 42]) assert.equal(P(x), null, String(x));
});

test('copertine: gp-sessione -> gp -> default -> nessuna', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'ms-'));
  try {
    const info = P('🏎️ Formula 1 Qatar Grand Prix – Practice 1 | Lusail');
    assert.equal(makeMotorCovers(d, '/covers/x').cover(info, 'https://b'), null);
    writeFileSync(path.join(d, 'default.png'), 'x');
    assert.equal(makeMotorCovers(d, '/covers/x').cover(info, 'https://b'), 'https://b/covers/x/default.png');
    writeFileSync(path.join(d, 'Qatar.JPG'), 'x');
    assert.equal(makeMotorCovers(d, '/covers/x').cover(info, 'https://b'), 'https://b/covers/x/Qatar.JPG');
    writeFileSync(path.join(d, 'qatar_free_practice_1.webp'), 'x'); // "_" e maiuscole accettati
    assert.equal(makeMotorCovers(d, '/covers/x').cover(info, 'https://b'), 'https://b/covers/x/qatar_free_practice_1.webp');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---------- Addon completo con sorgente finta ----------
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8000 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'motor-covers-'));
let server;
const json = async url => (await fetch(`${BASE}${url}`)).json();
const motor = async (genre, prefix = '') =>
  (await json(`${prefix}/catalog/Live%20Sports/motorsport${genre ? `/genre=${encodeURIComponent(genre)}` : ''}.json`)).metas;
const byId = (metas, n) => metas.find(m => m.id === `seriea:motorsport:${n}`);

before(async () => {
  for (const [folder, files] of Object.entries({
    'formula-1': ['qatar-free-practice-1.jpg', 'default.png'],
    'motogp': ['valencia.webp'],
    'moto2': ['valencia_free_practice_1.png']
  })) {
    mkdirSync(path.join(dir, folder), { recursive: true });
    for (const f of files) writeFileSync(path.join(dir, folder, f), 'x');
  }
  server = spawn('node', ['--import', path.join(root, 'test/mock-fetch.mjs'), 'src/server.js'],
    { cwd: root, env: { ...process.env, PORT: String(PORT), PUBLIC_BASE_URL: 'https://addon.test', COVERS_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server non avviato');
});
after(() => { server?.kill(); rmSync(dir, { recursive: true, force: true }); });

test('motorsport: catalogo senza genere = solo le sei categorie, niente Formula E / MotoE / F1 Academy', async () => {
  const ids = (await motor()).map(m => m.id.replace('seriea:motorsport:', '')).sort((a, b) => a - b);
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('motorsport: titolo pulito e copertina gp-sessione (stile qatar-free-practice-1.jpg)', async () => {
  const m = byId(await motor('Formula 1'), 1);
  assert.equal(m.name, 'F1 Qatar – Prove libere 1');
  assert.equal(m.poster, 'https://addon.test/covers/formula-1/qatar-free-practice-1.jpg');
  assert.equal(m.background, m.poster);
  assert.equal((await fetch(m.poster.replace('https://addon.test', BASE))).status, 200);
});

test('motorsport: se manca la copertina della sessione si usa quella del GP, poi default', async () => {
  assert.equal(byId(await motor('Formula 1'), 7).poster, 'https://addon.test/covers/formula-1/default.png'); // nessun qatar-race
  const gp = await motor('MotoGP');
  assert.equal(byId(gp, 2).poster, 'https://addon.test/covers/motogp/valencia.webp');   // file per GP
  assert.equal(byId(gp, 8).poster, 'https://addon.test/covers/motogp/valencia.webp');   // vale per ogni sessione
});

test('motorsport: ogni genere contiene solo la sua categoria', async () => {
  assert.deepEqual((await motor('Formula 1')).map(m => m.id), ['seriea:motorsport:1', 'seriea:motorsport:7']);
  assert.deepEqual((await motor('Formula 2')).map(m => m.id), ['seriea:motorsport:5']);
  assert.deepEqual((await motor('Formula 3')).map(m => m.id), ['seriea:motorsport:6']);
  assert.deepEqual((await motor('MotoGP')).map(m => m.id), ['seriea:motorsport:2', 'seriea:motorsport:8']);
  assert.deepEqual((await motor('Moto2')).map(m => m.id), ['seriea:motorsport:3']);
  assert.deepEqual((await motor('Moto3')).map(m => m.id), ['seriea:motorsport:4']);
  assert.equal(byId(await motor('Moto2'), 3).poster, 'https://addon.test/covers/moto2/valencia_free_practice_1.png');
});

test('motorsport: senza file né default resta la copertina originale', async () => {
  assert.equal(byId(await motor('Formula 2'), 5).poster, 'orig');
  assert.equal(byId(await motor('Formula 2'), 5).name, 'F2 Qatar – Sprint');
});

test('motorsport: gli eventi non finiscono nel catalogo calcio (e viceversa)', async () => {
  const calcio = (await json('/catalog/Live%20Sports/calcio.json')).metas;
  assert.ok(calcio.length > 0 && calcio.every(m => m.id.startsWith('seriea:soccer:')));
  assert.ok((await motor()).every(m => m.id.startsWith('seriea:motorsport:')));
});

test('motorsport: meta coerente con il catalogo, stream inoltrato, eventi esclusi rifiutati', async () => {
  const cat = byId(await motor('Formula 1'), 1);
  const { meta } = await json('/meta/Live%20Sports/seriea%3Amotorsport%3A1.json');
  assert.equal(meta.id, 'seriea:motorsport:1');
  assert.equal(meta.name, cat.name);
  assert.equal(meta.poster, cat.poster);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Amotorsport%3A1.json')).streams.length, 1);
  assert.equal((await json('/meta/Live%20Sports/seriea%3Amotorsport%3A9.json')).meta, null);       // Formula E
  assert.deepEqual((await json('/stream/Live%20Sports/seriea%3Amotorsport%3A9.json')).streams, []);
  assert.deepEqual((await json('/stream/Live%20Sports/seriea%3Amotorsport%3A10.json')).streams, []); // MotoE
});

test('configurazione: /cfg/ con categorie motorsport e calcio', async () => {
  const onlyF1 = await json('/cfg/formula-1/manifest.json');
  assert.deepEqual(onlyF1.catalogs.map(c => c.id), ['motorsport']);
  assert.deepEqual(onlyF1.catalogs[0].extra[0].options, ['Formula 1']);
  assert.deepEqual((await motor(undefined, '/cfg/formula-1')).map(m => m.id), ['seriea:motorsport:1', 'seriea:motorsport:7']);
  assert.deepEqual((await json('/cfg/formula-1/catalog/Live%20Sports/calcio.json')).metas, []);
  assert.deepEqual((await json('/cfg/formula-1/stream/Live%20Sports/seriea%3Amotorsport%3A2.json')).streams, []); // MotoGP non abilitato

  const mixed = await json('/cfg/serie-a,moto3/manifest.json');
  assert.deepEqual(mixed.catalogs.map(c => c.id), ['calcio', 'motorsport']);
  assert.deepEqual(mixed.catalogs[1].extra[0].options, ['Moto3']);

  const onlySoccer = await json('/cfg/serie-a/manifest.json');
  assert.deepEqual(onlySoccer.catalogs.map(c => c.id), ['calcio']);
});

test('pagina configure: schede motorsport presenti e selezionabili', async () => {
  const html = await (await fetch(`${BASE}/configure`)).text();
  for (const k of ['formula-1', 'formula-2', 'formula-3', 'motogp', 'moto2', 'moto3']) assert.ok(html.includes(`value="${k}"`), k);
  assert.match(await (await fetch(`${BASE}/cfg/motogp/configure`)).text(), /value="motogp" checked/);
});
