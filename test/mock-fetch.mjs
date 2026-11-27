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
  { id: 'soccer:13', name: '⚽ UEFA Conference League : Fiorentina vs Betis' },
  { id: 'soccer:14', name: '⚽ Italy - Serie C : Ascoli vs Rimini' },
  { id: 'soccer:15', name: '⚽ England - Premier League : Arsenal 🏴 vs Chelsea 🏴' },
  { id: 'soccer:16', name: '⚽ France - Ligue 1 : Lyon vs Marseille' },
  { id: 'soccer:17', name: '⚽ Germany - Bundesliga : Bayern Munich vs RB Leipzig' },
  { id: 'soccer:18', name: '⚽ Austria - Bundesliga : Sturm Graz vs Rapid Wien' },
  { id: 'soccer:19', name: '⚽ AFC Champions League : Al Hilal vs Al Nassr' },
  { id: 'soccer:20', name: '⚽ Spain - La Liga 2 : Eibar vs Levante' },
  { id: 'soccer:21', name: '⚽ Spain - La Liga : Sevilla 🇪🇸 vs Valencia 🇪🇸' },
  { id: 'soccer:22', name: '⚽ UEFA Europa League : Real Sociedad 🇪🇸 vs FC Viktoria Plzeň 🇨🇿' },
  { id: 'soccer:23', name: "⚽ UEFA Europa League : Crystal Palace 🏴 vs Real Sociedad 🇪🇸" },
  { id: 'soccer:24', name: "⚽ UEFA Europa League : Hapoel Be'er Sheva 🇮🇱 vs Celta Vigo 🇪🇸" },
  { id: 'soccer:27', name: '⚽ Italy Serie B : Spezia 🇮🇹 vs Cesena 🇮🇹' },
  { id: 'soccer:28', name: '⚽ England Premier League : Liverpool vs Everton' },
  { id: 'soccer:29', name: '⚽ Italy Serie B : Simulcast' },
  { id: 'soccer:26', name: '⚽ UEFA Champions League : Simulcast' },
  { id: 'soccer:25', name: '⚽ UEFA Europa League : Olympique Lyonnais vs Union St. Gilloise' }
];
// Catalogo motorsport (titoli reali EasySports + varianti simili; gli ultimi tre devono restare fuori).
const motorEvents = [
  { id: 'motorsport:1', name: '🏎️🇶🇦 Formula 1 Qatar Grand Prix – Practice 1 | Lusail, Qatar | 27 November 2026', poster: 'orig' },
  { id: 'motorsport:2', name: '🏎️ MotoGP : Round 22 | Valencia Practice 1', poster: 'orig' },
  { id: 'motorsport:3', name: '🏎️ Moto2 : Round 22 | Valencia Practice 1', poster: 'orig' },
  { id: 'motorsport:4', name: '🏎️ Moto3 : Round 22 | Valencia Qualifying 1', poster: 'orig' },
  { id: 'motorsport:5', name: '🏎️🇶🇦 Formula 2 Qatar Grand Prix – Sprint Race | Lusail, Qatar', poster: 'orig' },
  { id: 'motorsport:6', name: '🏎️🇶🇦 Formula 3 Qatar Grand Prix – Feature Race | Lusail, Qatar', poster: 'orig' },
  { id: 'motorsport:7', name: '🏎️🇶🇦 Formula 1 Qatar Grand Prix – Race | Lusail, Qatar', poster: 'orig' },
  { id: 'motorsport:8', name: '🏎️ MotoGP : Round 22 | Valencia Tissot Sprint', poster: 'orig' },
  { id: 'motorsport:9', name: '🏎️ Formula E Berlin E-Prix – Race', poster: 'orig' },
  { id: 'motorsport:10', name: '🏎️ MotoE : Round 5 | Valencia Race', poster: 'orig' },
  { id: 'motorsport:11', name: '🏎️ F1 Academy Miami – Race', poster: 'orig' }
];
const real = globalThis.fetch;
const customEvents = [{ id: 'soccer:900', name: '⚽ Italy - Serie A : Custom vs Utente' }];
globalThis.fetch = async (url, opts) => {
  url = String(url);
  // Manifest EasySports personale (test): contiene questo segmento nel percorso
  if (url.includes('/CUSTOMTOKEN12345678/')) {
    if (url.includes('/catalog/')) return Response.json({ metas: customEvents });
    if (url.includes('/meta/')) return Response.json({ meta: customEvents[0] });
    if (url.includes('/stream/')) return Response.json({ streams: [{ title: 'custom' }] });
  }
  if (url.includes('/catalog/Live%20Sports/motorsport.json')) return Response.json({ metas: motorEvents });
  if (url.includes('/catalog/')) return Response.json({ metas: events });
  if (url.includes('/meta/')) {
    const id = decodeURIComponent(url.split('/').pop().replace(/\.json$/, ''));
    return Response.json({ meta: [...events, ...motorEvents].find(e => e.id === id) });
  }
  if (url.includes('/stream/')) return Response.json({ streams: [{ title: 'ok' }] });
  if (url.includes('api.github.com')) return Response.json([{ type: 'file', name: 'inter_vs_juventus.png' }]);
  return real(url, opts);
};
