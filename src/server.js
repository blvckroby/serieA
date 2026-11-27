import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { LEAGUE_ART } from './league-art.js';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'logo.png');
const ID_PREFIX = 'seriea:';
const VERSION = '0.10.0';
// Hash del file: cambia l'URL del logo quando cambia l'immagine, così Stremio/Nuvio non usano la cache vecchia.
const LOGO_HASH = createHash('md5').update(readFileSync(LOGO_PATH)).digest('hex').slice(0, 8);

const COVERS_DIR = process.env.COVERS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'covers');

const app = express();
app.disable('x-powered-by');


const PORT = Number(process.env.PORT || 7000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const UPSTREAM_MANIFEST_URL = 'https://easysports.realbestia.com/aHR0cHM6Ly9ibGFwcm8tcDZxZmZhLmZseS5kZXYvfFNjYXRvcmNoaWE3fEV1cm9wZS9Sb21lfGh0dHBzOi8vZWFzeXNwb3J0cy5yZWFsYmVzdGlhLmNvbQ/manifest.json';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12_000);
const COVERS_API_URL = 'https://api.github.com/repos/qwertyuiop8899/logo/contents/SerieA';
const COVERS_RAW_BASE = 'https://raw.githubusercontent.com/qwertyuiop8899/logo/main/SerieA';

let upstreamPrefix; // manifest EasySports predefinito (quello del proprietario)
const catalogCaches = new Map(); // prefisso EasySports -> { expiresAt, metas }
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

function upstreamUrl(resource, type, id, prefix = upstreamPrefix) {
  const safeType = encodeURIComponent(type);
  const safeId = encodeURIComponent(id);
  return `${prefix}/${resource}/${safeType}/${safeId}.json`;
}

// Competizioni supportate. Il titolo EasySports ha la forma "⚽ Paese - Lega : Casa vs Ospite";
// i riconoscimenti sono volutamente stretti (niente Serie C, Bundesliga austriaca, AFC/CAF Champions League, ecc.).
const LEAGUES = [
  { key: 'serie-a', label: 'Serie A', re: /\bItaly\s*[-–—:]?\s*Serie\s*A\s*:/i },
  { key: 'serie-b', label: 'Serie B', re: /\bItaly\s*[-–—:]?\s*Serie\s*B\s*:/i },

  { key: 'champions-league', label: 'Champions League', re: /\bUEFA\s*[-–—:]?\s*Champions\s*League\s*:/i },
  { key: 'europa-league', label: 'Europa League', re: /\bUEFA\s*[-–—:]?\s*Europa\s*League\s*:/i },
  { key: 'conference-league', label: 'Conference League', re: /\bUEFA\s*[-–—:]?\s*Europa\s*Conference\s*League\s*:/i },

  { key: 'premier-league', label: 'Premier League', re: /\bEngland\s*[-–—:]?\s*Premier\s*League\s*:/i },
  { key: 'championship', label: 'Championship', re: /\bEngland\s*[-–—:]?\s*Championship\s*:/i },

  { key: 'ligue-1', label: 'Ligue 1', re: /\bFrance\s*[-–—:]?\s*Ligue\s*1\s*:/i },
  { key: 'bundesliga', label: 'Bundesliga', re: /\bGermany\s*[-–—:]?\s*Bundesliga\s*:/i },
  { key: 'la-liga', label: 'La Liga', re: /\bSpain\s*[-–—:]?\s*La\s*Liga\s*:/i },

  { key: 'eredivisie', label: 'Eredivisie', re: /\bNetherlands\s*[-–—:]?\s*Eredivisie\s*:/i },
  { key: 'primeira-liga', label: 'Primeira Liga', re: /\bPortugal\s*[-–—:]?\s*Primeira\s*Liga\s*:/i },
  { key: 'super-lig', label: 'Super Lig', re: /\bTurkey\s*[-–—:]?\s*Super\s*Lig\s*:/i },
  { key: 'mls', label: 'MLS', re: /\bUSA\s*[-–—:]?\s*MLS\s*:/i },
  { key: 'saudi-pro-league', label: 'Saudi Pro League', re: /\bSaudi\s*Arabia\s*[-–—:]?\s*Pro\s*League\s*:/i },
];

const LEAGUE_KEYS = LEAGUES.map(l => l.key);

const LEAGUE_STRIP_RE = new RegExp(
  `^.*?(?:${LEAGUES.map(l => l.re.source).join('|')})\\s*`,
  'iu'
);

function leagueOf(meta) {
  const name = meta?.name;
  if (typeof name !== 'string' || /women|femminile/i.test(name)) return undefined;
  return LEAGUES.find(l => l.re.test(name))?.key;
}
const isSupportedEvent = meta => Boolean(leagueOf(meta));

// ---- Configurazione nell'URL di installazione ----
//   /cfg/serie-a,la-liga/manifest.json            competizioni scelte
//   /cfg/all/u/<manifest EasySports base64url>/…   manifest EasySports personale (altrimenti si usa quello predefinito)
const UPSTREAM_ALLOWED_HOST = new URL(UPSTREAM_MANIFEST_URL).hostname;
const b64url = text => Buffer.from(text, 'utf8').toString('base64url');

// Accetta solo manifest https dello stesso servizio EasySports (evita che l'addon contatti host arbitrari).
function parseUpstreamManifest(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== UPSTREAM_ALLOWED_HOST || url.port || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.endsWith('/manifest.json') || url.pathname.length < 20) return null;
    return `${url.origin}${url.pathname.slice(0, -'/manifest.json'.length)}`;
  } catch { return null; }
}

app.use((req, res, next) => {
  const m = req.url.match(/^\/cfg\/([a-z0-9,-]*)(?:\/u\/([A-Za-z0-9_-]+))?(\/.*)?$/i);
  if (m) {
    const keys = m[1].split(',').filter(k => LEAGUE_KEYS.includes(k));
    req.enabled = keys.length ? keys : undefined;
    if (m[2]) {
      const decoded = Buffer.from(m[2], 'base64url').toString('utf8');
      const prefix = parseUpstreamManifest(decoded);
      if (!prefix) return res.status(400).json({ error: 'Manifest EasySports non valido.' });
      req.upstreamPrefix = prefix;
      req.upstreamManifest = decoded;
    }
    req.url = m[3] || '/';
  }
  next();
});
const enabledKeys = req => req.enabled || LEAGUE_KEYS;

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
    // Toglie bandiere/icone e il prefisso "Paese - Lega :" di qualunque competizione supportata.
    .replace(LEAGUE_STRIP_RE, '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:|•\s]+|[-–—:|•\s]+$/g, '')
    .trim();
}

function cleanMatchTitle(name) {
  return stripCompetitionPrefix(name);
}

// ---- Copertine locali (Champions, Europa League e le altre competizioni, in src/covers/<cartella>) ----
const CHAMPIONS_ALIASES = {
  'psg': 'paris-saint-germain', 'paris sg': 'paris-saint-germain', 'paris saint germain': 'paris-saint-germain',
  'bayern': 'bayern-munich', 'bayern munchen': 'bayern-munich', 'fc bayern munchen': 'bayern-munich',
  'sporting': 'sporting-cp', 'sporting lisbon': 'sporting-cp', 'sporting lisboa': 'sporting-cp',
  'slavia praha': 'slavia-prague', 'sk slavia praha': 'slavia-prague',
  'shakhtar': 'shakhtar-donetsk', 'shakhtar donetsk': 'shakhtar-donetsk',
  'bodo glimt': 'bodo-glimt', 'fk bodo glimt': 'bodo-glimt', 'bod glimt': 'bodo-glimt', 'fk bod glimt': 'bodo-glimt',
  'man city': 'manchester-city', 'man united': 'manchester-united', 'man utd': 'manchester-united',
  'atletico': 'atletico-madrid', 'atletico de madrid': 'atletico-madrid', 'club atletico de madrid': 'atletico-madrid',
  'leipzig': 'rb-leipzig', 'red bull leipzig': 'rb-leipzig', 'rasenballsport leipzig': 'rb-leipzig',
  'dortmund': 'borussia-dortmund', 'bvb': 'borussia-dortmund', 'borussia dortmund': 'borussia-dortmund',
  'betis': 'real-betis', 'real betis balompie': 'real-betis',
  'internazionale': 'inter', 'inter milan': 'inter', 'inter milano': 'inter', 'fc internazionale milano': 'inter',
  'as roma': 'roma', 'ssc napoli': 'napoli', 'sk slovan bratislava': 'slovan-bratislava',
  'aek': 'aek-athens', 'aek athens fc': 'aek-athens', 'brugge': 'club-brugge', 'psv eindhoven': 'psv',
  'fc barcelona': 'barcelona', 'real madrid cf': 'real-madrid', 'vfb stuttgart': 'stuttgart',
  'hapoel be er sheva': 'hapoel-beer-sheva', 'hapoel beer sheva': 'hapoel-beer-sheva', 'sparta praha': 'sparta-prague',
  'olympiakos': 'olympiacos', 'olympiakos piraeus': 'olympiacos', 'olympiacos piraeus': 'olympiacos',
  'union st gilloise': 'union-saint-gilloise', 'royale union saint gilloise': 'union-saint-gilloise',
  'ferencvarosi tc': 'ferencvaros', 'ferencvarosi': 'ferencvaros', 'rb salzburg': 'salzburg', 'red bull salzburg': 'salzburg',
  'fc salzburg': 'salzburg', 'besiktas jk': 'besiktas', 'celta': 'celta-vigo', 'celta de vigo': 'celta-vigo',
  'ofi': 'ofi-crete', 'ofi crete': 'ofi-crete', 'ararat armenia': 'ararat-armenia', 'dinamo zagreb': 'dinamo-zagreb', 'gnk dinamo zagreb': 'dinamo-zagreb',
  'omonia': 'omonia-nicosia', 'ac omonia': 'omonia-nicosia', 'bodo/glimt': 'bodo-glimt', 'real sociedad de futbol': 'real-sociedad',
  'olympique lyonnais': 'lyon', 'stade rennais': 'rennes', 'stade rennais fc': 'rennes', 'nec': 'nec-nijmegen',
  'rc lens': 'lens', 'losc lille': 'lille', 'lask linz': 'lask', 'fc porto': 'porto', 'como 1907': 'como'
};
const SLUG_VARIANTS = { 'bodo-glimt': ['bod-glimt'], 'bod-glimt': ['bodo-glimt'] };
const LATIN_FIX = { 'ø': 'o', 'Ø': 'o', 'ð': 'd', 'đ': 'd', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe' };

// Copertine locali di una competizione: cartella con file "squadra-casa_vs_squadra-ospite.webp".
// Se la partita non ha un file dedicato si usa "default.webp" (se presente nella cartella).
function makeLocalCovers(dir, urlPath) {
  // Accetta webp/png/jpg. Nome canonico: minuscolo, con i trattini anche al posto di "_" dentro i nomi squadra
  // (es. "crystal_palace_vs_real_sociedad.png" -> "crystal-palace_vs_real-sociedad").
  const canonical = new Map();
  let defaultFile = null;
  for (const file of readdirSync(dir)) {
    const m = file.match(/^(.+)\.(webp|png|jpe?g)$/i);
    if (!m) continue;
    const stem = m[1].toLowerCase();
    if (stem === 'default') { defaultFile = file; continue; }
    if (!stem.includes('_vs_')) continue;
    const [home, away] = stem.split('_vs_').map(t => t.replace(/_/g, '-'));
    canonical.set(`${home}_vs_${away}`, file);
  }
  const slugs = new Set([...canonical.keys()].flatMap(k => k.split('_vs_')));
  const url = (base, file) => `${base}${urlPath}/${encodeURIComponent(file)}`;

  function slug(value) {
    const normalized = normalizeTeamName(String(value || '').replace(/[øØðđłßæœ]/g, c => LATIN_FIX[c]))
      .split(' ').filter(w => !['fc', 'cf', 'sc', 'fk', 'sk', 'afc', 'ac'].includes(w)).join(' ');
    const plain = normalized.replace(/\s+/g, '-');
    const alias = CHAMPIONS_ALIASES[normalized];
    // Alcuni file usano grafie diverse (es. "bod-glimt" al posto di "bodo-glimt"): si accettano entrambe.
    const spelled = candidate => [candidate, ...(SLUG_VARIANTS[candidate] || [])].find(c => slugs.has(c));
    if (alias && spelled(alias)) return spelled(alias);
    if (spelled(plain)) return spelled(plain);
    if (slugs.has(plain)) return plain;
    const words = new Set(normalized.split(' '));
    let best = null;
    for (const candidate of slugs) {
      const slugWords = candidate.split('-');
      if (slugWords.every(w => words.has(w)) && (!best || slugWords.length > best.split('-').length)) best = candidate;
    }
    if (best) return best;
    // Nome incompleto (es. "Sporting"): accetta solo se identifica una sola squadra.
    const partial = [...slugs].filter(candidate => [...words].every(w => candidate.split('-').includes(w)));
    if (partial.length === 1) return partial[0];
    return alias || plain; // nome non ancora noto: prova comunque il nome "pulito" come nome file
  }

  return {
    files: canonical,
    cover(name, base) {
      const match = cleanMatchTitle(name).match(/^(.+?)\s+(?:vs\.?|v\.?|[-–—])\s+(.+)$/i);
      if (match) {
        const file = canonical.get(`${slug(match[1])}_vs_${slug(match[2])}`);
        if (file) return url(base, file);
      }
      return defaultFile ? url(base, defaultFile) : null;
    }
  };
}

// Cartella delle copertine di ogni competizione (src/covers/<cartella>/). La Serie A usa il repository GitHub.
const COVER_FOLDERS = {
  'serie-b': 'serie-b',
  'champions-league': 'champions',
  'europa-league': 'europa',
  'premier-league': 'premier-league',
  'ligue-1': 'ligue-1',
  'bundesliga': 'bundesliga',
  'la-liga': 'la-liga'
};
const localCovers = {};
for (const [key, folder] of Object.entries(COVER_FOLDERS)) {
  const dir = path.join(COVERS_DIR, folder);
  mkdirSync(dir, { recursive: true });
  localCovers[key] = { dir, urlPath: `/covers/${folder}`, ...makeLocalCovers(dir, `/covers/${folder}`) };
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
  // Canale Simulcast: nome e copertina dedicati per competizione (Serie B: "Zona Goal").
  const simulcastInfo = (isSimulcast(meta.name) || isSimulcast(meta.title)) ? {
    'serie-a': { name: DIRETTA_GOAL_NAME, cover: DIRETTA_GOAL_COVER },
    'europa-league': { name: DIRETTA_GOAL_NAME, cover: DIRETTA_GOAL_EUROPA_COVER },
    'champions-league': { name: DIRETTA_GOAL_NAME, cover: `${base}/simulcast/champions-diretta-goal.webp` },
    'serie-b': { name: 'Zona Goal', cover: `${base}/simulcast/serie-b-zona-goal.webp` }
  }[league] : undefined;
  const simulcast = Boolean(simulcastInfo);
  const cleanName = simulcast ? simulcastInfo.name : cleanMatchTitle(meta.name);
  const cover = simulcast ? simulcastInfo.cover
    : league === 'serie-a' ? coverForMatch(meta.name || meta.title || '')
    : localCovers[league]?.cover(meta.name || meta.title || '', base) ?? null;
  const result = {
    ...meta,
    // ID proprio: così Stremio chiede meta e stream a questo addon e non
    // all'addon EasySports originale (che sovrascriverebbe la copertina).
    id: toOwnId(meta.id),
    ...(typeof meta.name === 'string' ? { name: cleanName } : {}),
    ...(typeof meta.title === 'string' ? { title: simulcast ? simulcastInfo.name : cleanMatchTitle(meta.title) } : {}),
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
async function getUpstreamEvents(req, force = false) {
  const prefix = req?.upstreamPrefix || upstreamPrefix;
  const cached = catalogCaches.get(prefix);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.metas;
  const data = await fetchJson(upstreamUrl('catalog', 'Live Sports', 'soccer', prefix));
  await loadCoverFiles();
  const metas = Array.isArray(data?.metas) ? data.metas.filter(isSupportedEvent) : [];
  if (catalogCaches.size >= 50) catalogCaches.delete(catalogCaches.keys().next().value);
  catalogCaches.set(prefix, { metas, expiresAt: Date.now() + CACHE_TTL_MS });
  return metas;
}

function buildManifest(req) {
  const base = publicBase(req);
  const options = LEAGUES.filter(l => enabledKeys(req).includes(l.key)).map(l => l.label);
  return {
    id: 'it.roby.seriea.easysports',
    version: VERSION,
    name: 'Calcio Live',
    description: 'Serie A, Serie B, Champions League, Europa League, Premier League, Ligue 1, Bundesliga e La Liga, con gli stream forniti da EasySports.',
    logo: `${base}/logo.png?v=${LOGO_HASH}`,
    background: `${base}/logo.png?v=${LOGO_HASH}`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['Live Sports'],
    idPrefixes: [ID_PREFIX],
    // Un solo catalogo: il genere sceglie la competizione (senza genere: tutte quelle abilitate).
    catalogs: [{ type: 'Live Sports', id: 'calcio', name: 'Calcio', extra: [{ name: 'genre', options, isRequired: false }] }],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

app.get('/', (_req, res) => res.json({ name: 'Calcio Live addon', manifest: '/manifest.json', configure: '/configure' }));
app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION, logo: LOGO_HASH, upstreamConfigured: Boolean(upstreamPrefix) }));
app.get('/logo.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(LOGO_PATH);
});
// Copertine dei canali Simulcast (fuori da src/covers, così non vengono sovrascritte aggiornando le cartelle delle partite).
app.use('/simulcast', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'simulcast'), { maxAge: '5m' }));
for (const { dir, urlPath } of Object.values(localCovers)) app.use(urlPath, express.static(dir, { maxAge: '1d' }));
app.get('/manifest.json', (req, res) => res.json(buildManifest(req)));

const CONFIGURE_TEMPLATE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'configure.html'), 'utf8');
const LEAGUE_LOGOS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'leagues');
app.use('/league-logos', express.static(LEAGUE_LOGOS_DIR, { maxAge: '5m' }));

// Logo ufficiale facoltativo (src/assets/leagues/<chiave>.png|svg|webp), altrimenti lo stemma disegnato.
function leagueLogoMarkup(league) {
  const file = ['png', 'svg', 'webp'].map(ext => `${league.key}.${ext}`).find(f => existsSync(path.join(LEAGUE_LOGOS_DIR, f)));
  return file
    ? `<img class="emblem-img" src="/league-logos/${file}" alt="">`
    : `<svg class="emblem" viewBox="0 0 64 64" aria-hidden="true">${LEAGUE_ART[league.key].svg}</svg>`;
}

app.get('/configure', (req, res) => {
  const checked = new Set(enabledKeys(req));
  const cards = LEAGUES.map((l, i) => {
    const art = LEAGUE_ART[l.key];
    const photo = art.bg ? `<span class="photo"></span>` : '';
    return `<label class="card${art.bg ? ' has-photo' : ''}" style="--c1:${art.c1};--c2:${art.c2};--i:${i}${art.logoBg ? `;--logo-bg:${art.logoBg};--logo-bg-image:none` : ''}${art.bg ? `;--bg:url('${art.bg}')` : ''}">
  <input type="checkbox" value="${l.key}"${checked.has(l.key) ? ' checked' : ''}>
  ${photo}<span class="glow"></span>
  <span class="logo">${leagueLogoMarkup(l)}</span>
  <span class="name">${l.label}</span><span class="note">${art.note}</span>
  <span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
</label>`;
  }).join('\n');
  res.type('html').send(CONFIGURE_TEMPLATE.replaceAll('{{CARDS}}', cards).replaceAll('{{LOGO_HASH}}', LOGO_HASH).replaceAll('{{VERSION}}', VERSION)
    .replaceAll('{{ALLOWED_HOST}}', UPSTREAM_ALLOWED_HOST)
    .replaceAll('{{UPSTREAM_VALUE}}', (req.upstreamManifest || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))));
});

// Catalogo unico: il "genere" seleziona la competizione. I vecchi ID (serie-a, ...) restano validi.
async function handleCatalog(req, res) {
  const { type, catalogId } = req.params;
  const legacy = LEAGUE_KEYS.includes(catalogId);
  if (type !== 'Live Sports' || (catalogId !== 'calcio' && !legacy)) return res.json({ metas: [] });
  try {
    const extra = new URLSearchParams(req.params.extra || '');
    const genre = extra.get('genre');
    let keys = enabledKeys(req);
    if (legacy) keys = keys.filter(k => k === catalogId);
    if (genre) keys = keys.filter(k => LEAGUES.find(l => l.key === k).label.toLowerCase() === genre.toLowerCase());
    const base = publicBase(req);
    const metas = (await getUpstreamEvents(req, req.query.refresh === '1'))
      .filter(meta => keys.includes(leagueOf(meta))).map(meta => cleanMeta(meta, base));
    res.set({ 'Cache-Control': 'no-store', Vary: 'User-Agent' });
    return res.json({ metas });
  } catch (error) {
    console.error('[catalog]', error.message);
    return jsonError(res, 502, 'Impossibile recuperare il catalogo da EasySports.');
  }
}
app.get('/catalog/:type/:catalogId.json', handleCatalog);
app.get('/catalog/:type/:catalogId/:extra.json', handleCatalog);

app.get('/meta/:type/:id.json', async (req, res) => {
  const { type } = req.params;
  const id = toUpstreamId(req.params.id);
  if (type !== 'Live Sports' || !id.startsWith('soccer:')) return res.json({ meta: null });
  try {
    const data = await fetchJson(upstreamUrl('meta', type, id, req.upstreamPrefix));
    const meta = data?.meta;
    if (!enabledKeys(req).includes(leagueOf(meta))) return res.json({ meta: null });
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
    const metas = await getUpstreamEvents(req);
    const event = metas.find(item => item.id === id);
    if (!event || !enabledKeys(req).includes(leagueOf(event))) return res.json({ streams: [] });
    const data = await fetchJson(upstreamUrl('stream', type, id, req.upstreamPrefix));
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
