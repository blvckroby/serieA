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
const LABELS = { 'serie-a': 'Serie A', 'serie-b': 'Serie B', 'champions-league': 'Champions League', 'europa-league': 'Europa League',
  'premier-league': 'Premier League', 'ligue-1': 'Ligue 1', 'bundesliga': 'Bundesliga', 'la-liga': 'La Liga' };
const catalog = async (key, prefix = '') => (await json(`${prefix}/catalog/Live%20Sports/calcio/genre=${encodeURIComponent(LABELS[key])}.json`)).metas;
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

test('manifest: un solo catalogo con genere, id con prefisso proprio e logo', async () => {
  const m = await json('/manifest.json');
  assert.equal(m.catalogs.length, 1);
  assert.equal(m.catalogs[0].id, 'calcio');
  assert.deepEqual(m.catalogs[0].extra[0].options, Object.values(LABELS));
  assert.equal(m.catalogs[0].extra[0].isRequired, false);
  assert.equal(m.behaviorHints.configurable, true);
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
  assert.deepEqual(metas.map(m => m.id), ['seriea:soccer:8', 'seriea:soccer:11', 'seriea:soccer:12', 'seriea:soccer:22', 'seriea:soccer:23', 'seriea:soccer:24', 'seriea:soccer:25']);
  assert.equal(metas[0].name, 'Roma vs Porto');
  assert.equal(metas[0].poster, 'https://addon.test/covers/europa/default.webp');
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
  assert.equal((await json('/meta/Live%20Sports/seriea%3Asoccer%3A14.json')).meta, null);
  assert.deepEqual((await json('/stream/Live%20Sports/seriea%3Asoccer%3A14.json')).streams, []);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Asoccer%3A3.json')).streams.length, 1);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Asoccer%3A8.json')).streams.length, 1);
});

test('Europa League: Simulcast diventa Diretta Goal con la copertina Europa', async () => {
  const metas = await catalog('europa-league');
  for (const n of [11, 12]) {
    const m = byId(metas, n);
    assert.equal(m.name, 'Diretta Goal');
    assert.equal(m.poster, 'https://www.today.it/~shared/images/tv/locandine/calcio-diretta-gol-europa-e-conference-league-ep2z.jpg');
    assert.equal(m.background, m.poster);
  }
  // la copertina Diretta Goal della Serie A resta diversa
  assert.notEqual(byId(await catalog('serie-a'), 2).poster, byId(metas, 11).poster);
});

test('Europa League: meta dell\'evento Simulcast coerente con il catalogo', async () => {
  const { meta } = await json('/meta/Live%20Sports/seriea%3Asoccer%3A11.json');
  assert.equal(meta.name, 'Diretta Goal');
  assert.match(meta.poster, /today\.it/);
  assert.equal((await json('/stream/Live%20Sports/seriea%3Asoccer%3A11.json')).streams.length, 1);
});

test('Conference League non finisce in nessun catalogo', async () => {
  for (const c of Object.keys(LABELS)) {
    assert.ok(!(await catalog(c)).some(m => m.id === 'seriea:soccer:13'), c);
  }
});

// Una riga per competizione: titolo EasySports -> catalogo, nome atteso, copertina attesa.
const TABLE = [
  ['Serie A', 'serie-a', 1, 'Inter vs Juventus', /raw\.githubusercontent\.com\/.*inter_vs_juventus\.png$/],
  ['Serie A Simulcast', 'serie-a', 2, 'Diretta Goal', /indazn\.com/],
  ['Champions', 'champions-league', 3, 'AEK Athens vs Real Madrid', /\/covers\/champions\/aek-athens_vs_real-madrid\.webp$/],
  ['Champions (Bodø)', 'champions-league', 4, 'Bodø/Glimt vs Borussia Dortmund', /bodo-glimt_vs_borussia-dortmund\.webp$/],
  ['Europa League', 'europa-league', 8, 'Roma vs Porto', /\/covers\/europa\/default\.webp$/],
  ['Europa League Simulcast', 'europa-league', 11, 'Diretta Goal', /today\.it/]
];
for (const [label, cat, n, name, poster] of TABLE) {
  test(`competizione ${label}`, async () => {
    const m = byId(await catalog(cat), n);
    assert.ok(m, 'evento presente nel catalogo giusto');
    assert.equal(m.name, name);
    assert.match(m.poster, poster);
  });
}

test('Europa League: copertina di default servita e usata come sfondo', async () => {
  const m = byId(await catalog('europa-league'), 8);
  assert.equal(m.background, m.poster);
  const r = await fetch(m.poster.replace('https://addon.test', BASE));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
});

test('catalogo senza genere: tutte le competizioni supportate, niente Serie C / AFC / Bundesliga austriaca / La Liga 2', async () => {
  const metas = (await json('/catalog/Live%20Sports/calcio.json')).metas;
  const ids = metas.map(m => m.id.replace('seriea:soccer:', '')).sort((a, b) => a - b);
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '15', '16', '17', '21', '22', '23', '24', '25'].sort((a, b) => a - b));
});

test('altre competizioni: titolo pulito dal prefisso e dalle bandiere', async () => {
  assert.equal(byId(await catalog('premier-league'), 15).name, 'Arsenal vs Chelsea');
  assert.equal(byId(await catalog('ligue-1'), 16).name, 'Lyon vs Marseille');
  assert.equal(byId(await catalog('bundesliga'), 17).name, 'Bayern Munich vs RB Leipzig');
  assert.equal(byId(await catalog('la-liga'), 21).name, 'Sevilla vs Valencia');
  assert.equal(byId(await catalog('serie-b'), 10).name, 'Bari vs Palermo');
});

test('ogni genere contiene solo la sua competizione', async () => {
  assert.deepEqual((await catalog('bundesliga')).map(m => m.id), ['seriea:soccer:17']);
  assert.deepEqual((await catalog('la-liga')).map(m => m.id), ['seriea:soccer:7', 'seriea:soccer:21']);
  assert.deepEqual((await catalog('serie-b')).map(m => m.id), ['seriea:soccer:10']);
});

test('configurazione: /cfg/ limita le competizioni nel manifest, nel catalogo, in meta e stream', async () => {
  const cfg = '/cfg/serie-a,bundesliga';
  const m = await json(`${cfg}/manifest.json`);
  assert.deepEqual(m.catalogs[0].extra[0].options, ['Serie A', 'Bundesliga']);
  const all = (await json(`${cfg}/catalog/Live%20Sports/calcio.json`)).metas.map(x => x.id);
  assert.deepEqual(all, ['seriea:soccer:1', 'seriea:soccer:2', 'seriea:soccer:17']);
  assert.deepEqual(await catalog('la-liga', cfg), []);
  assert.equal((await json(`${cfg}/meta/Live%20Sports/seriea%3Asoccer%3A15.json`)).meta, null);
  assert.deepEqual((await json(`${cfg}/stream/Live%20Sports/seriea%3Asoccer%3A15.json`)).streams, []);
  assert.equal((await json(`${cfg}/stream/Live%20Sports/seriea%3Asoccer%3A17.json`)).streams.length, 1);
});

test('pagina di configurazione disponibile', async () => {
  const r = await fetch(`${BASE}/configure`);
  assert.equal(r.status, 200);
  const html = await r.text();
  for (const l of Object.values(LABELS)) assert.ok(html.includes(l), l);
  const r2 = await (await fetch(`${BASE}/cfg/la-liga/configure`)).text();
  assert.match(r2, /value="la-liga" checked/);
  assert.doesNotMatch(r2, /value="serie-a" checked/);
});

test('vecchi ID di catalogo (serie-a) ancora funzionanti', async () => {
  const metas = (await json('/catalog/Live%20Sports/serie-a.json')).metas;
  assert.deepEqual(metas.map(m => m.id), ['seriea:soccer:1', 'seriea:soccer:2']);
});

test('Europa League: copertine PNG dedicate (anche con "_" nel nome file e nomi diversi)', async () => {
  const metas = await catalog('europa-league');
  assert.equal(byId(metas, 22).poster, 'https://addon.test/covers/europa/real_sociedad_vs_viktoria-plzen.png');
  assert.equal(byId(metas, 23).poster, 'https://addon.test/covers/europa/crystal_palace_vs_real_sociedad.png');
  assert.equal(byId(metas, 24).poster, 'https://addon.test/covers/europa/hapoel-beer-sheva_vs_celta-vigo.png');
  assert.equal(byId(metas, 25).poster, 'https://addon.test/covers/europa/lyon_vs_union-saint-gilloise.png');
  assert.equal(byId(metas, 22).name, 'Real Sociedad vs FC Viktoria Plzeň');
});

test('Europa League: ogni copertina referenziata esiste e ha un tipo immagine', async () => {
  for (const m of await catalog('europa-league')) {
    if (!m.poster.startsWith('https://addon.test')) continue; // copertine esterne (Diretta Goal)
    const r = await fetch(m.poster.replace('https://addon.test', BASE));
    assert.equal(r.status, 200, m.poster);
    assert.match(r.headers.get('content-type'), /^image\//, m.poster);
  }
});
