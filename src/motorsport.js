// Motorsport (Formula 1/2/3, MotoGP/Moto2/Moto3): riconoscimento, titolo pulito, copertine.
// Modulo indipendente: usato da server.js, nessuna dipendenza esterna.
import { readdirSync } from 'node:fs';

// Per aggiungere una categoria (es. MotoE, Formula E) basta una riga: chiave, nome, sigla, cartella copertine e
// "token" = come compare all'inizio del titolo EasySports. Poi serve la voce in league-art.js.
export const MOTOR_SERIES = [
  { key: 'formula-1', label: 'Formula 1', short: 'F1',     folder: 'formula-1', token: '(?:formula[\\s-]*(?:1|one)(?!\\d)|f1(?!\\w))(?!\\s*academy)' },
  { key: 'formula-2', label: 'Formula 2', short: 'F2',     folder: 'formula-2', token: '(?:formula[\\s-]*2(?!\\d)|f2(?!\\w))' },
  { key: 'formula-3', label: 'Formula 3', short: 'F3',     folder: 'formula-3', token: '(?:formula[\\s-]*3(?!\\d)|f3(?!\\w))' },
  { key: 'motogp',    label: 'MotoGP',    short: 'MotoGP', folder: 'motogp',    token: 'moto[\\s-]?gp(?!\\w)' },
  { key: 'moto2',     label: 'Moto2',     short: 'Moto2',  folder: 'moto2',     token: 'moto[\\s-]?2(?!\\d)' },
  { key: 'moto3',     label: 'Moto3',     short: 'Moto3',  folder: 'moto3',     token: 'moto[\\s-]?3(?!\\d)' }
];
const SERIES_RES = MOTOR_SERIES.map(s => [s, new RegExp(`^${s.token}`, 'i')]);
// "FIA Formula 2", "FIM MotoGP World Championship" ecc.
const PREFIX = /^(?:(?:fia|fim)\s+)?(?:world\s+championship\s+)?/i;

// Toglie emoji, bandiere, selettori di variante; riduce gli spazi.
export const stripEmoji = s =>
  s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();

export const slug = s =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Sessione normalizzata: slug (nome file), etichetta italiana (titolo), known = riconosciuta.
export function parseSession(raw = '') {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  let m;
  if ((m = t.match(/^(?:free practice|fp|practice)(?: nr\.?)?\s*(\d)?$/)))
    return m[1] ? { slug: `free-practice-${m[1]}`, it: `Prove libere ${m[1]}`, known: true } : { slug: 'free-practice', it: 'Prove libere', known: true };
  if (/^sprint[\s-]*(qualifying|shootout)$/.test(t)) return { slug: 'sprint-qualifying', it: 'Sprint Qualifiche', known: true };
  if ((m = t.match(/^(?:qualifying(?: nr\.?)?\s*(\d)?|q\s?([123]))$/))) {
    const n = m[1] || m[2];
    return n ? { slug: `qualifying-${n}`, it: `Qualifiche ${n}`, known: true } : { slug: 'qualifying', it: 'Qualifiche', known: true };
  }
  if (/^sprint( race)?$/.test(t)) return { slug: 'sprint', it: 'Sprint', known: true };
  if (/^feature race$/.test(t)) return { slug: 'feature-race', it: 'Feature Race', known: true };
  if (/^(race|main race|grand prix)$/.test(t)) return { slug: 'race', it: 'Gara', known: true };
  if (/^warm[\s-]?up$/.test(t)) return { slug: 'warm-up', it: 'Warm Up', known: true };
  return raw.trim() ? { slug: slug(raw), it: raw.trim(), known: false } : { slug: 'event', it: '', known: false };
}

// Sessione scritta in coda al testo ("Valencia Practice 1", "Qatar Grand Prix Sprint Race").
const SESSION_TAIL = /\b(free practice(?: nr\.?)?\s*\d|fp\s?\d|practice(?: nr\.?)?\s*\d?|sprint[\s-]*(?:qualifying|shootout)|sprint race|feature race|qualifying(?: nr\.?)?\s*\d?|q\s?[123]|sprint|warm[\s-]?up|main race|race)\s*$/i;

const cleanGp = s => s
  .replace(/\b(?:grand prix|gp)\b(?:\s+of)?/ig, ' ')
  .replace(/^the\s+/i, '').replace(/\s+/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '');

function splitGpSession(text) {
  const dash = text.split(/\s+[–—-]\s+/);
  if (dash.length > 1) return { gp: dash[0], sess: dash.slice(1).join(' - ') };
  const tail = text.match(SESSION_TAIL);
  if (tail) return { gp: text.slice(0, tail.index), sess: tail[1] };
  return { gp: text, sess: '' };
}

// Ritorna null se l'evento non è di una delle categorie supportate.
// Formati gestiti (esempi reali e varianti):
//   "🏎️🇶🇦 Formula 1 Qatar Grand Prix – Practice 1 | Lusail, Qatar | 27 November 2026"
//   "🏎️ MotoGP : Round 22 | Valencia Practice 1"   (anche Moto2, Moto3, "Moto 2", "FIM MotoGP ...")
//   "Formula 2 Qatar Grand Prix - Sprint Race", "F3: Abu Dhabi GP | Feature Race | Yas Marina"
export function parseMotorsport(name) {
  if (typeof name !== 'string') return null;
  const parts = stripEmoji(name).split('|').map(p => p.trim());
  let head = parts[0].replace(PREFIX, '');
  const hit = SERIES_RES.find(([, re]) => re.test(head));
  if (!hit) return null;
  const [series, re] = hit;
  head = head.replace(re, '').replace(/^\s*(?:world\s+)?championship\b/i, '');
  const round = (head.match(/\b(?:round|rd)\.?\s*(\d+)/i) || [])[1] || null;
  const trim = s => s.replace(/^[\s:–—-]+|[\s:–—-]+$/g, '');
  const text0 = trim(head.replace(/\b(?:round|rd)\.?\s*\d+/ig, ' ').replace(/\btissot\b/ig, ''));

  // Testo con GP/sessione: nel titolo stesso, oppure (stile MotoGP) dopo il primo "|".
  const rest = parts.slice(1);
  let used = -1, text = text0;
  if (!text) {
    used = Math.max(0, rest.findIndex(p => SESSION_TAIL.test(p)));
    text = trim((rest[used] || '').replace(/\btissot\b/ig, ''));
  }
  let { gp, sess } = splitGpSession(text);
  // Sessione in un'altra parte ("Formula 1 Qatar GP | Practice 1 | Lusail").
  if (!sess) {
    const other = rest.find((p, i) => i !== used && parseSession(p).known);
    if (other) sess = other;
  }
  // "Qatar Grand Prix" senza altro = gara.
  if (!sess && /grand prix\s*$/i.test(gp)) sess = 'Race';
  gp = cleanGp(gp);
  if (!gp) return null;

  const session = parseSession(sess);
  return {
    key: series.key, label: series.label, short: series.short, folder: series.folder,
    gp, round, session,
    title: `${series.short} ${gp}${session.it ? ' – ' + session.it : ''}`, // "F1 Qatar – Prove libere 1"
    coverName: `${slug(gp)}-${session.slug}`                                // "qatar-free-practice-1"
  };
}

// Copertine locali di una categoria: src/covers/<cartella>/<gp>-<sessione>.(jpg|png|webp)
// Ordine: gp-sessione -> gp (valida per tutte le sessioni) -> default. Nessun file: copertina originale.
export function makeMotorCovers(dir, urlPath) {
  const files = new Map();
  for (const file of readdirSync(dir)) {
    const m = file.match(/^(.+)\.(webp|png|jpe?g)$/i);
    if (m) files.set(slug(m[1]), file); // "qatar_free_practice_1.JPG" == "qatar-free-practice-1"
  }
  return {
    files,
    cover(info, base) {
      const file = [info.coverName, slug(info.gp), 'default'].map(k => files.get(k)).find(Boolean);
      return file ? `${base}${urlPath}/${encodeURIComponent(file)}` : null;
    }
  };
}
