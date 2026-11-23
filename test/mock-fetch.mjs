// Sostituisce fetch con un finto EasySports/GitHub, così i test non usano la rete.
import { readFileSync } from 'node:fs';
// Per provare titoli reali: MOCK_EVENTS_FILE=miei-eventi.json npm run demo  (array di {id, name})
const events = process.env.MOCK_EVENTS_FILE ? JSON.parse(readFileSync(process.env.MOCK_EVENTS_FILE, 'utf8')) : [
  { id: 'soccer:1', name: '⚽ Italy - Serie A : Inter 🇮🇹 vs Juventus 🇮🇹', poster: 'orig' },
  { id: 'soccer:2', name: '⚽ Italy - Serie A : Simulcast' },
  { id: 'soccer:3', name: '⚽ UEFA Champions League : AEK Athens 🇬🇷 vs Real Madrid 🇪🇸' },
  { id: 'soccer:4', name: '⚽ UEFA Champions League : Bodø/Glimt 🇳🇴 vs Borussia Dortmund 🇩🇪' },
  { id: 'soccer:5', name: '⚽ UEFA Champions League : Villarreal CF vs Paris SG' },
  { id: 'soccer:6', name: "⚽ UEFA Women's Champions League : Roma vs Lyon" },
  { id: 'soccer:7', name: '⚽ Spain - La Liga : Real Madrid vs Barcelona' },
  { id: 'soccer:8', name: '⚽ UEFA Europa League : Roma 🇮🇹 vs Porto 🇵🇹', poster: 'orig' },
  { id: 'soccer:9', name: '⚽ UEFA Champions League : Napoli vs Squadra Sconosciuta' },
  { id: 'soccer:10', name: '⚽ Italy - Serie B : Bari vs Palermo' },
  { id: 'soccer:11', name: '⚽ UEFA Europa League : Simulcast' },
  { id: 'soccer:12', name: '⚽ UEFA Europa League : Simulcast 2' },
  { id: 'soccer:13', name: '⚽ UEFA Conference League : Fiorentina vs Betis' }
];
const real = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.includes('/catalog/')) return Response.json({ metas: events });
  if (url.includes('/meta/')) {
    const id = decodeURIComponent(url.split('/').pop().replace(/\.json$/, ''));
    return Response.json({ meta: events.find(e => e.id === id) });
  }
  if (url.includes('/stream/')) return Response.json({ streams: [{ title: 'ok' }] });
  if (url.includes('api.github.com')) return Response.json([{ type: 'file', name: 'inter_vs_juventus.png' }]);
  return real(url, opts);
};
