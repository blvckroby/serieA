import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'logo.png');
const ID_PREFIX = 'seriea:';
const VERSION = '0.5.1';
// Hash del file: cambia l'URL del logo quando cambia l'immagine, così Stremio/Nuvio non usano la cache vecchia.
const LOGO_HASH = createHash('md5').update(readFileSync(LOGO_PATH)).digest('hex').slice(0, 8);

const CHAMPIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'covers', 'champions');
const championsFiles = new Set(readdirSync(CHAMPIONS_DIR).filter(f => f.endsWith('.webp')).map(f => f.toLowerCase()));

const app = express();
app.disable('x-powered-by');


const PORT = Number(process.env.PORT || 7000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const UPSTREAM_MANIFEST_URL = 'https://easysports.realbestia.com/aHR0cHM6Ly9ibGFwcm8tcDZxZmZhLmZseS5kZXYvfFNjYXRvcmNoaWE3fEV1cm9wZS9Sb21lfGh0dHBzOi8vZWFzeXNwb3J0cy5yZWFsYmVzdGlhLmNvbQ/manifest.json';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12_000);
const COVERS_API_URL = 'https://api.github.com/repos/qwertyuiop8899/logo/contents/SerieA';
const COVERS_RAW_BASE = 'https://raw.githubusercontent.com/qwertyuiop8899/logo/main/SerieA';

let upstreamPrefix;
let catalogCache = { expiresAt: 0, metas: [] };
let coverFiles = new Set();
let coverFilesLoadedAt = 0;

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'SerieA-Stremio-Addon/0.1.0' }
    });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function upstreamUrl(resource, type, id) {
  const safeType = encodeURIComponent(type);
  const safeId = encodeURIComponent(id);
  return `${upstreamPrefix}/${resource}/${safeType}/${safeId}.json`;
}

function isItalianSerieA(meta) {
  // Deliberately strict: excludes Serie B/C and other countries' Serie A leagues.
  return typeof meta?.name === 'string' && /\bItaly\s*-\s*Serie\s*A\s*:/i.test(meta.name);
}

function isChampionsLeague(meta) {
  const name = meta?.name;
  // Solo la Champions League maschile (esclude "Women's Champions League").
  return typeof name === 'string' && /Champions\s*League\s*:/i.test(name) && !/women|femminile/i.test(name);
}

function isEuropaLeague(meta) {
  const name = meta?.name;
  return typeof name === 'string' && /Europa\s*League\s*:/i.test(name) && !/women|femminile/i.test(name);
}

const LEAGUE_CHECKS = { 'serie-a': isItalianSerieA, 'champions-league': isChampionsLeague, 'europa-league': isEuropaLeague };
const isSupportedEvent = meta => Object.values(LEAGUE_CHECKS).some(check => check(meta));
const leagueOf = meta => Object.keys(LEAGUE_CHECKS).find(key => LEAGUE_CHECKS[key](meta));

const TEAM_ALIASES = [
  [['ac monza', 'monza'], 'monza'],
  [['acf fiorentina', 'fiorentina'], 'fiorentina'],
  [['atalanta bc', 'atalanta'], 'atalanta'],
  [['bologna fc 1909', 'bologna fc', 'bologna'], 'bologna'],
  [['cagliari calcio', 'cagliari'], 'cagliari'],
  [['como 1907', 'como'], 'como'],
  [['cremonese', 'us cremonese'], 'cremonese'],
  [['frosinone calcio', 'frosinone'], 'frosinone'],
  [['genoa cfc', 'genoa'], 'genoa'],
  [['hellas verona', 'verona'], 'verona'],
  [['inter milano', 'internazionale', 'inter milan', 'inter'], 'inter'],
  [['juventus turin', 'juventus fc', 'juventus'], 'juventus'],
  [['lazio rome', 'ss lazio', 'lazio'], 'lazio'],
  [['us lecce', 'lecce'], 'lecce'],
  [['ac milan', 'milan'], 'milan'],
  [['ssc napoli', 'napoli'], 'napoli'],
  [['parma calcio 1913', 'parma calcio', 'parma'], 'parma'],
  [['pisa sporting club', 'pisa'], 'pisa'],
  [['as roma', 'roma'], 'roma'],
  [['sassuolo calcio', 'us sassuolo', 'sassuolo'], 'sassuolo'],
  [['torino fc', 'torino'], 'torino'],
  [['udinese calcio', 'udinese'], 'udinese'],
  [['venezia fc', 'venezia'], 'venezia']
];

function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamSlug(value) {
  const normalized = normalizeTeamName(value);
  for (const [aliases, slug] of TEAM_ALIASES) {
    if (aliases.some(alias => normalized === normalizeTeamName(alias) || normalized.includes(normalizeTeamName(alias)))) {
      return slug;
    }
  }
  return normalized.replace(/\s+/g, '_');
}

function stripCompetitionPrefix(name) {
  if (typeof name !== 'string') return name;
  return name
    // Handles leading flags/emojis before the competition label as well.
    .replace(/^\s*(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\s]*)Italy\s*-\s*Serie\s*A\s*:\s*/iu, '')
    .replace(/^\s*Italy\s*-\s*Serie\s*A\s*:\s*/i, '')
    // Champions League: toglie qualsiasi prefisso (bandiere, "Europe -", "UEFA") fino ai due punti.
    .replace(/^.*?Champions\s*League\s*:\s*/iu, '')
    // Europa League: stessa logica.
    .replace(/^.*?Europa\s*League\s*:\s*/iu, '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:|•\s]+|[-–—:|•\s]+$/g, '')
    .trim();
}

function cleanMatchTitle(name) {
  return stripCompetitionPrefix(name);
}

// ---- UEFA Champions League (copertine locali in src/covers/champions) ----
const championsSlugs = new Set([...championsFiles].flatMap(f => f.replace(/\.webp$/, '').split('_vs_')));
const CHAMPIONS_ALIASES = {
  'psg': 'paris-saint-germain', 'paris sg': 'paris-saint-germain', 'paris saint germain': 'paris-saint-germain',
  'bayern': 'bayern-munich', 'bayern munchen': 'bayern-munich', 'fc bayern munchen': 'bayern-munich',
  'sporting': 'sporting-cp', 'sporting lisbon': 'sporting-cp', 'sporting lisboa': 'sporting-cp',
  'slavia praha': 'slavia-prague', 'sk slavia praha': 'slavia-prague',
  'shakhtar': 'shakhtar-donetsk', 'shakhtar donetsk': 'shakhtar-donetsk',
  'bodo glimt': 'bodo-glimt', 'fk bodo glimt': 'bodo-glimt',
  'man city': 'manchester-city', 'man united': 'manchester-united', 'man utd': 'manchester-united',
  'atletico': 'atletico-madrid', 'atletico de madrid': 'atletico-madrid', 'club atletico de madrid': 'atletico-madrid',
  'leipzig': 'rb-leipzig', 'red bull leipzig': 'rb-leipzig', 'rasenballsport leipzig': 'rb-leipzig',
  'dortmund': 'borussia-dortmund', 'bvb': 'borussia-dortmund', 'borussia dortmund': 'borussia-dortmund',
  'betis': 'real-betis', 'real betis balompie': 'real-betis',
  'internazionale': 'inter', 'inter milan': 'inter', 'inter milano': 'inter', 'fc internazionale milano': 'inter',
  'as roma': 'roma', 'ssc napoli': 'napoli', 'sk slovan bratislava': 'slovan-bratislava',
  'aek': 'aek-athens', 'aek athens fc': 'aek-athens', 'brugge': 'club-brugge', 'psv eindhoven': 'psv',
  'fc barcelona': 'barcelona', 'real madrid cf': 'real-madrid', 'vfb stuttgart': 'stuttgart',
  'rc lens': 'lens', 'losc lille': 'lille', 'lask linz': 'lask', 'fc porto': 'porto', 'como 1907': 'como'
};
const LATIN_FIX = { 'ø': 'o', 'Ø': 'o', 'ð': 'd', 'đ': 'd', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe' };

function championsSlug(value) {
  const normalized = normalizeTeamName(String(value || '').replace(/[øØðđłßæœ]/g, c => LATIN_FIX[c]))
    .split(' ').filter(w => !['fc', 'cf', 'sc', 'fk', 'sk', 'afc', 'ac'].includes(w)).join(' ');
  if (CHAMPIONS_ALIASES[normalized]) return CHAMPIONS_ALIASES[normalized];
  const direct = normalized.replace(/\s+/g, '-');
  if (championsSlugs.has(direct)) return direct;
  const words = new Set(normalized.split(' '));
  let best = null;
  for (const slug of championsSlugs) {
    const slugWords = slug.split('-');
    if (slugWords.every(w => words.has(w)) && (!best || slugWords.length > best.split('-').length)) best = slug;
  }
  if (best) return best;
  // Nome incompleto (es. "Sporting"): accetta solo se identifica una sola squadra.
  const partial = [...championsSlugs].filter(slug => [...words].every(w => slug.split('-').includes(w)));
  return partial.length === 1 ? partial[0] : null;
}

function championsCover(name, base) {
  const match = cleanMatchTitle(name).match(/^(.+?)\s+(?:vs\.?|v\.?|[-–—])\s+(.+)$/i);
  if (!match) return null;
  const home = championsSlug(match[1]);
  const away = championsSlug(match[2]);
  if (!home || !away) return null;
  const filename = `${home}_vs_${away}.webp`;
  return championsFiles.has(filename) ? `${base}/covers/champions/${filename}` : null;
}

async function loadCoverFiles() {
  if (coverFilesLoadedAt && Date.now() - coverFilesLoadedAt < 10 * 60_000) return coverFiles;
  try {
    const files = await fetchJson(COVERS_API_URL);
    coverFiles = new Set(Array.isArray(files)
      ? files.filter(file => file?.type === 'file' && typeof file.name === 'string').map(file => file.name.toLowerCase())
      : []);
    coverFilesLoadedAt = Date.now();
  } catch (error) {
    console.warn('[covers] Impossibile aggiornare l’elenco GitHub:', error.message);
    // Keep a previously loaded list if GitHub is temporarily unavailable.
  }
  return coverFiles;
}

function coverForMatch(name) {
  const cleanName = cleanMatchTitle(name);
  const match = cleanName.match(/^(.+?)\s+(?:vs\.?|v\.?|[-–—])\s+(.+)$/i);
  if (!match) return null;
  const home = teamSlug(match[1]);
  const away = teamSlug(match[2]);
  if (!home || !away) return null;
  const filename = `${home}_vs_${away}.png`.toLowerCase();
  if (!coverFiles.has(filename)) return null;
  return `${COVERS_RAW_BASE}/${filename}`;
}

const toOwnId = id => (typeof id === 'string' && !id.startsWith(ID_PREFIX) ? ID_PREFIX + id : id);
const toUpstreamId = id => (id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : id);

function publicBase(req) {
  const proto = req.get('x-forwarded-proto')?.split(',')[0] || req.protocol;
  return PUBLIC_BASE_URL || `${proto}://${req.get('host')}`;
}

// Eventi "Simulcast" (o simili): diventano il canale "Diretta Goal" con copertina dedicata.
const SIMULCAST_RE = /simul\s*cast|simulcas|simulc|simulat/i;
const DIRETTA_GOAL_NAME = 'Diretta Goal';
const DIRETTA_GOAL_COVER = 'https://image.discovery.indazn.com/ca/v3/ca/none/4b2pkfqfso35dqdxe5mx6u5m6_image-header_pIt_1756299253000/fit/center/top/none/100/0/0/auto/image';
const DIRETTA_GOAL_EUROPA_COVER = 'https://www.today.it/~shared/images/tv/locandine/calcio-diretta-gol-europa-e-conference-league-ep2z.jpg';
const isSimulcast = value => typeof value === 'string' && SIMULCAST_RE.test(cleanMatchTitle(value));

function cleanMeta(meta, base) {
  if (!meta || typeof meta !== 'object') return meta;
  const league = leagueOf(meta);
  const champions = league === 'champions-league';
  const simulcast = (league === 'serie-a' || league === 'europa-league') && (isSimulcast(meta.name) || isSimulcast(meta.title));
  const cleanName = simulcast ? DIRETTA_GOAL_NAME : cleanMatchTitle(meta.name);
  const cover = simulcast ? (league === 'europa-league' ? DIRETTA_GOAL_EUROPA_COVER : DIRETTA_GOAL_COVER)
    : champions ? championsCover(meta.name || meta.title || '', base)
    : league === 'serie-a' ? coverForMatch(meta.name || meta.title || '')
    : null; // Europa League: copertina originale EasySports finché non ci sono quelle personalizzate
  const result = {
    ...meta,
    // ID proprio: così Stremio chiede meta e stream a questo addon e non
    // all'addon EasySports originale (che sovrascriverebbe la copertina).
    id: toOwnId(meta.id),
    ...(typeof meta.name === 'string' ? { name: cleanName } : {}),
    ...(typeof meta.title === 'string' ? { title: simulcast ? DIRETTA_GOAL_NAME : cleanMatchTitle(meta.title) } : {}),
    ...(cover ? { poster: cover, background: cover, thumbnail: cover } : {})
  };
  if (Array.isArray(meta.videos)) {
    result.videos = meta.videos.map(video => ({
      ...video,
      id: toOwnId(video?.id),
      ...(cover ? { thumbnail: cover } : {})
    }));
  }
  return result;
}

// Catalogo EasySports grezzo (in cache): i due cataloghi vengono filtrati e puliti a ogni richiesta.
async function getUpstreamEvents(force = false) {
  if (!force && catalogCache.expiresAt > Date.now()) return catalogCache.metas;
  const data = await fetchJson(upstreamUrl('catalog', 'Live Sports', 'soccer'));
  await loadCoverFiles();
  const metas = Array.isArray(data?.metas) ? data.metas.filter(isSupportedEvent) : [];
  catalogCache = { metas, expiresAt: Date.now() + CACHE_TTL_MS };
  return metas;
}

const manifest = {
  id: 'it.roby.seriea.easysports',
  version: VERSION,
  name: 'Serie A + Europa',
  description: 'Eventi della Serie A italiana, della UEFA Champions League e della UEFA Europa League, con gli stream forniti da EasySports.',
  logo: `${PUBLIC_BASE_URL}/logo.png?v=${LOGO_HASH}`,
  resources: ['catalog', 'meta', 'stream'],
  types: ['Live Sports'],
  idPrefixes: [ID_PREFIX],
  catalogs: [
    { type: 'Live Sports', id: 'serie-a', name: 'Serie A' },
    { type: 'Live Sports', id: 'champions-league', name: 'UEFA Champions League' },
    { type: 'Live Sports', id: 'europa-league', name: 'UEFA Europa League' }
  ],
  behaviorHints: { configurable: false, configurationRequired: false }
};

app.get('/', (_req, res) => res.json({ name: 'Serie A + Europa addon', manifest: '/manifest.json' }));
app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION, logo: LOGO_HASH, upstreamConfigured: Boolean(upstreamPrefix) }));
app.get('/logo.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(LOGO_PATH);
});
app.use('/covers/champions', express.static(CHAMPIONS_DIR, { maxAge: '1d', immutable: false }));
app.get('/manifest.json', (req, res) => {
  // Senza PUBLIC_BASE_URL ricava l'URL pubblico dalla richiesta.
  const base = publicBase(req);
  res.json({ ...manifest, logo: `${base}/logo.png?v=${LOGO_HASH}`, background: `${base}/logo.png?v=${LOGO_HASH}` });
});

app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (type !== 'Live Sports' || !LEAGUE_CHECKS[catalogId]) return res.json({ metas: [] });
  try {
    const base = publicBase(req);
    const metas = (await getUpstreamEvents(req.query.refresh === '1'))
      .filter(LEAGUE_CHECKS[catalogId]).map(meta => cleanMeta(meta, base));
    res.set({ 'Cache-Control': 'no-store', Vary: 'User-Agent' });
    return res.json({ metas });
  } catch (error) {
    console.error('[catalog]', error.message);
    return jsonError(res, 502, 'Impossibile recuperare il catalogo da EasySports.');
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  const { type } = req.params;
  const id = toUpstreamId(req.params.id);
  if (type !== 'Live Sports' || !id.startsWith('soccer:')) return res.json({ meta: null });
  try {
    const data = await fetchJson(upstreamUrl('meta', type, id));
    const meta = data?.meta;
    if (!isSupportedEvent(meta)) return res.json({ meta: null });
    await loadCoverFiles();
    return res.json({ ...data, meta: cleanMeta(meta, publicBase(req)) });
  } catch (error) {
    console.error('[meta]', error.message);
    return jsonError(res, 502, 'Impossibile recuperare i dettagli della partita da EasySports.');
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  const { type } = req.params;
  const id = toUpstreamId(req.params.id);
  if (type !== 'Live Sports' || !id.startsWith('soccer:')) return res.json({ streams: [] });
  try {
    // Validate the event against the filtered league before forwarding its original ID.
    const metas = await getUpstreamEvents();
    if (!metas.some(item => item.id === id)) return res.json({ streams: [] });
    const data = await fetchJson(upstreamUrl('stream', type, id));
    return res.json(data);
  } catch (error) {
    console.error('[stream]', error.message);
    return jsonError(res, 502, 'Impossibile recuperare gli stream da EasySports.');
  }
});

async function start() {
  const parsed = new URL(UPSTREAM_MANIFEST_URL);
  if (!parsed.pathname.endsWith('/manifest.json')) {
    throw new Error('UPSTREAM_MANIFEST_URL deve terminare con /manifest.json');
  }
  upstreamPrefix = `${parsed.origin}${parsed.pathname.slice(0, -'/manifest.json'.length)}`;

  // Il manifest è già noto e il suo URL è incorporato nel progetto.
  // Non lo scarichiamo all'avvio: alcuni host EasySports rispondono 403 al fetch
  // del manifest pur consentendo le richieste del catalogo dal client.

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serie A addon in ascolto sulla porta ${PORT}`);
    if (PUBLIC_BASE_URL) console.log(`Manifest: ${PUBLIC_BASE_URL}/manifest.json`);
  });
}

start().catch(error => {
  console.error('[startup]', error.message);
  process.exit(1);
});
