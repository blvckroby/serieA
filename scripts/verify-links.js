// Uso: BASE=http://localhost:7000 node scripts/verify-links.js
// Per ogni evento controlla che poster/background in catalogo e in scheda evento
// coincidano e che tutti gli URL immagine rispondano 200.
const BASE = (process.env.BASE || 'http://localhost:7000').replace(/\/$/, '');
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const get = async (url, ua) => (await fetch(url, ua ? { headers: { 'user-agent': ua } } : undefined)).json();
const status = async url => (await fetch(url, { method: 'GET' })).status;

let problems = 0;
const metas = [];
for (const cat of ['serie-a', 'champions-league', 'motorsport']) metas.push(...(await get(`${BASE}/catalog/Live%20Sports/${cat}.json`)).metas);
console.log(`Eventi in catalogo: ${metas.length}`);
for (const m of metas) {
  const enc = encodeURIComponent(m.id);
  const desktop = (await get(`${BASE}/meta/Live%20Sports/${enc}.json`)).meta;
  const mobile = (await get(`${BASE}/meta/Live%20Sports/${enc}.json`, MOBILE_UA)).meta;
  const checks = [['catalogo.poster', m.poster], ['catalogo.background', m.background],
    ['meta.poster', desktop?.poster], ['meta.background', desktop?.background],
    ['meta.mobile.poster', mobile?.poster], ['meta.mobile.background', mobile?.background]];
  const notes = [];
  if (m.poster !== desktop?.poster) notes.push('poster catalogo != meta');
  if (m.background !== desktop?.background) notes.push('background catalogo != meta');
  if (m.poster !== mobile?.poster) notes.push('poster desktop != mobile');
  for (const [label, url] of checks) {
    if (!url) { notes.push(`${label} mancante`); continue; }
    const code = await status(url).catch(() => 0);
    if (code !== 200) notes.push(`${label} HTTP ${code}`);
  }
  if (notes.length) problems++;
  console.log(`${notes.length ? 'KO' : 'OK'}  ${m.name}${notes.length ? '  -> ' + notes.join('; ') : ''}`);
}
console.log(problems ? `\n${problems} eventi con problemi` : '\nTutto coerente e funzionante');
process.exit(problems ? 1 : 0);
