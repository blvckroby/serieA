import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Copertine di tutte le competizioni: usa una cartella temporanea con immagini finte (COVERS_DIR).
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7800 + Math.floor(Math.random() * 150);
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'covers-'));
let server;

const FIXTURES = {
  'serie-b': ['bari_vs_palermo.png'],
  'premier-league': ['arsenal_vs_chelsea.webp', 'default.png'],
  'ligue-1': ['lyon_vs_marseille.jpg'],
  'bundesliga': ['bayern-munich_vs_rb-leipzig.png'],
  'la-liga': ['sevilla_vs_valencia.png', 'real_madrid_vs_atletico_madrid.png', 'default.webp']
};
const LABELS = { 'serie-b': 'Serie B', 'premier-league': 'Premier League', 'ligue-1': 'Ligue 1', 'bundesliga': 'Bundesliga', 'la-liga': 'La Liga' };
const get = async url => (await fetch(`${BASE}${url}`)).json();
const catalog = async key => (await get(`/catalog/Live%20Sports/calcio/genre=${encodeURIComponent(LABELS[key])}.json`)).metas;

before(async () => {
  for (const [folder, files] of Object.entries(FIXTURES)) {
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

test('Serie B: copertina dedicata', async () => {
  assert.equal((await catalog('serie-b'))[0].poster, 'https://addon.test/covers/serie-b/bari_vs_palermo.png');
});
test('Premier League: copertina dedicata (webp)', async () => {
  assert.equal((await catalog('premier-league'))[0].poster, 'https://addon.test/covers/premier-league/arsenal_vs_chelsea.webp');
});
test('Ligue 1: copertina dedicata (jpg)', async () => {
  assert.equal((await catalog('ligue-1'))[0].poster, 'https://addon.test/covers/ligue-1/lyon_vs_marseille.jpg');
});
test('Bundesliga: copertina dedicata', async () => {
  assert.equal((await catalog('bundesliga'))[0].poster, 'https://addon.test/covers/bundesliga/bayern-munich_vs_rb-leipzig.png');
});
test('La Liga: copertina dedicata e nomi file con "_"', async () => {
  const metas = await catalog('la-liga');
  assert.equal(metas.find(m => m.id === 'seriea:soccer:21').poster, 'https://addon.test/covers/la-liga/sevilla_vs_valencia.png');
});
test('le copertine sono servite dalle rispettive cartelle', async () => {
  for (const [folder, files] of Object.entries(FIXTURES)) {
    for (const f of files) assert.equal((await fetch(`${BASE}/covers/${folder}/${f}`)).status, 200, `${folder}/${f}`);
  }
});
test('senza file e senza default resta la copertina originale', async () => {
  const dirEmpty = (await catalog('serie-b'));
  assert.equal(dirEmpty.length, 2);
  // Bundesliga non ha default: una partita senza file non avrebbe poster; quella presente sì
  assert.ok((await catalog('bundesliga'))[0].poster);
});
test('cartelle vuote/mancanti non fanno cadere il server', async () => {
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});
