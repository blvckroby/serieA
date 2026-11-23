import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'logo.png');
const ID_PREFIX = 'seriea:';

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
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:|•\s]+|[-–—:|•\s]+$/g, '')
    .trim();
}

function cleanMatchTitle(name) {
  return stripCompetitionPrefix(name);
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

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const cleanName = cleanMatchTitle(meta.name);
  const cover = coverForMatch(meta.name || meta.title || '');
  const result = {
    ...meta,
    // ID proprio: così Stremio chiede meta e stream a questo addon e non
    // all'addon EasySports originale (che sovrascriverebbe la copertina).
    id: toOwnId(meta.id),
    ...(typeof meta.name === 'string' ? { name: cleanName } : {}),
    ...(typeof meta.title === 'string' ? { title: cleanMatchTitle(meta.title) } : {}),
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

async function getSerieACatalog(force = false) {
  if (!force && catalogCache.expiresAt > Date.now()) return catalogCache.metas;
  const data = await fetchJson(upstreamUrl('catalog', 'Live Sports', 'soccer'));
  await loadCoverFiles();
  const metas = Array.isArray(data?.metas)
    ? data.metas.filter(isItalianSerieA).map(cleanMeta)
    : [];
  catalogCache = { metas, expiresAt: Date.now() + CACHE_TTL_MS };
  return metas;
}

const manifest = {
  id: 'it.roby.seriea.easysports',
  version: '0.3.0',
  name: 'Serie A Italia',
  description: 'Solo eventi della Serie A italiana, con gli stream forniti da EasySports.',
  logo: `${PUBLIC_BASE_URL}/logo.png`,
  resources: ['catalog', 'meta', 'stream'],
  types: ['Live Sports'],
  idPrefixes: [ID_PREFIX],
  catalogs: [{ type: 'Live Sports', id: 'serie-a', name: 'Serie A' }],
  behaviorHints: { configurable: false, configurationRequired: false }
};

app.get('/', (_req, res) => res.json({ name: 'Serie A Italia addon', manifest: '/manifest.json' }));
app.get('/health', (_req, res) => res.json({ ok: true, upstreamConfigured: Boolean(upstreamPrefix) }));
app.get('/logo.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(LOGO_PATH);
});
app.get('/manifest.json', (req, res) => {
  // Senza PUBLIC_BASE_URL ricava l'URL pubblico dalla richiesta.
  const proto = req.get('x-forwarded-proto')?.split(',')[0] || req.protocol;
  const base = PUBLIC_BASE_URL || `${proto}://${req.get('host')}`;
  res.json({ ...manifest, logo: `${base}/logo.png`, background: `${base}/logo.png` });
});

app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (type !== 'Live Sports' || catalogId !== 'serie-a') return res.json({ metas: [] });
  try {
    const metas = await getSerieACatalog(req.query.refresh === '1');
    res.set('Cache-Control', 'public, max-age=20');
    return res.json({ metas });
  } catch (error) {
    console.error('[catalog]', error.message);
    return jsonError(res, 502, 'Impossibile recuperare il catalogo Serie A da EasySports.');
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  const { type } = req.params;
  const id = toUpstreamId(req.params.id);
  if (type !== 'Live Sports' || !id.startsWith('soccer:')) return res.json({ meta: null });
  try {
    const data = await fetchJson(upstreamUrl('meta', type, id));
    const meta = data?.meta;
    if (!isItalianSerieA(meta)) return res.json({ meta: null });
    await loadCoverFiles();
    return res.json({ ...data, meta: cleanMeta(meta) });
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
    const metas = await getSerieACatalog();
    if (!metas.some(item => item.id === toOwnId(id))) return res.json({ streams: [] });
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
