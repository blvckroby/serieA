# Serie A Italia — Stremio addon

Addon Node.js per Stremio che usa EasySports come sorgente, ma pubblica un solo catalogo: **Serie A**.

## Cosa fa questa prima versione

- Espone un unico catalogo `Serie A` (non mostra basket, golf, tennis o gli altri cataloghi EasySports).
- Legge il catalogo `soccer` di EasySports e conserva soltanto gli eventi il cui titolo corrisponde a `Italy - Serie A : ...`.
- Mantiene gli ID originali EasySports, necessari per recuperare scheda evento e stream.
- Inoltra le richieste `meta` e `stream` a EasySports dopo aver verificato che l'evento appartenga alla Serie A italiana.
- Aggiorna il catalogo ogni 30 secondi (configurabile).
- Se EasySports non risponde, restituisce un errore 502 leggibile nei log.

Gli eventi usano un ID proprio (`seriea:`), così Stremio chiede scheda e stream solo a questo addon e la copertina personalizzata resta anche nella schermata delle fonti. Il logo è servito su `/logo.png`.

## Avvio locale

Serve Node.js 20 o superiore.

1. Apri la cartella del progetto. L’URL EasySports è già configurato nel codice.
2. Esegui:

```bash
npm install
npm start
```

Apri `http://localhost:7000/health` e poi `http://localhost:7000/manifest.json`.

## Installazione su Stremio

Dopo il deploy, incolla in Stremio:

```text
https://TUO-DOMINIO-NORTHFLANK/manifest.json
```

## Deploy su Northflank

1. Crea un nuovo servizio da repository Git oppure carica questa cartella in un repository GitHub.
2. Scegli buildpack Dockerfile (è incluso il `Dockerfile`).
3. Aggiungi le variabili:
   - `PORT`: `7000` (oppure la porta dinamica fornita dalla piattaforma).
   - `PUBLIC_BASE_URL`: URL HTTPS pubblico del servizio, facoltativo.
4. Esporre la porta HTTP `7000` e avviare il servizio.
5. Verifica `/health` e `/manifest.json`.

## Verifica rapida

```bash
curl https://TUO-DOMINIO/health
curl https://TUO-DOMINIO/catalog/Live%20Sports/serie-a.json
```

Il filtro è volutamente restrittivo: `Italy - Serie A` viene incluso, mentre `Italy - Serie C`, `Serie B` e le leghe omonime di altri paesi restano fuori.


## Titoli e copertine

Il catalogo rimuove dal titolo il prefisso `Italy - Serie A:` e le icone iniziali. Per ogni partita cerca una copertina con il formato `squadra_casa_vs_squadra_ospite.png` nel repository [qwertyuiop8899/logo – SerieA](https://github.com/qwertyuiop8899/logo/tree/main/SerieA). Se il file non è presente, mantiene la copertina originale di EasySports.

## Verifica link

Per controllare che i link in catalogo e in scheda coincidano e rispondano 200:

```bash
BASE=https://TUO-DOMINIO npm run verify
```


## Cataloghi: Serie A e UEFA Champions League

L'addon pubblica due cataloghi: `Serie A` e `UEFA Champions League` (eventi il cui titolo contiene `Champions League :`, esclusa la versione femminile). Le copertine Champions sono in `src/covers/champions/` (formato `squadra-casa_vs_squadra-ospite.webp`, con i nomi delle squadre separati da trattini) e vengono servite dall'addon su `/covers/champions/`. Per aggiungerne di nuove copia il file nella cartella e rifai il deploy. Se non esiste la copertina di una partita, resta quella originale EasySports.

Gli eventi `Simulcast` di Serie A, Champions ed Europa League diventano `Diretta Goal` (in Serie B `Zona Goal`, copertina `src/covers/serie-b/zona-goal.webp`) con una copertina dedicata per competizione (quella della Champions è `src/covers/champions/diretta-goal.webp`).

Anche la `UEFA Europa League` ha un catalogo (titoli `Europa League :`, esclusa la femminile); per ora usa le copertine originali EasySports, tranne gli eventi `Simulcast`, che diventano `Diretta Goal` con una copertina dedicata.

## Test

```bash
npm test
```

I test avviano l'addon con un finto EasySports (`test/mock-fetch.mjs`, nessuna rete) e controllano cataloghi, titoli puliti, copertine, Diretta Goal, meta e stream.

### Provare i titoli a mano

```bash
npm run demo
```

Avvia l'addon su `http://localhost:7000` con eventi finti (nessuna rete): apri `/catalog/Live%20Sports/serie-a.json`, `champions-league.json` o `europa-league.json`. Per provare titoli veri crea un file `miei-eventi.json` con `[{"id":"soccer:1","name":"⚽ UEFA Champions League : AEK Athens 🇬🇷 vs Real Madrid 🇪🇸"}]` e avvia con:

```bash
MOCK_EVENTS_FILE=miei-eventi.json npm run demo
```

### Copertine Europa League

Cartella `src/covers/europa/` (accetta `.webp`, `.png`, `.jpg`; nei nomi delle squadre vanno bene sia `-` sia `_`): `default.webp` è la copertina usata per tutte le partite che non ne hanno una dedicata. Per una partita specifica aggiungi `squadra-casa_vs_squadra-ospite.webp` (minuscolo, nomi con i trattini, per esempio `real-sociedad_vs_viktoria-plzen.webp`) e rifai il deploy: ha la precedenza sulla copertina di default.

## Catalogo unico con scelta della competizione

Il manifest espone un solo catalogo, `Calcio`, con il filtro **genere**: Serie A, Serie B, Champions League, Europa League, Premier League, Ligue 1, Bundesliga, La Liga. Senza genere selezionato mostra tutte le competizioni abilitate.

Il riconoscimento usa il titolo EasySports (`Paese - Lega :`), in modo stretto: per esempio `Italy - Serie B :`, `England - Premier League :`, `France - Ligue 1 :`, `Germany - Bundesliga :`, `Spain - La Liga :`, `UEFA Champions League :`, `UEFA Europa League :`. Restano fuori Serie C, La Liga 2, Bundesliga austriaca, AFC/CAF Champions League, Conference League e le versioni femminili. Se un titolo reale è scritto diversamente, basta correggere la riga corrispondente in `LEAGUES` in `src/server.js`.

### Pagina di configurazione

Apri `https://TUO-DOMINIO/configure` (in Stremio è il pulsante *Configura* dell'addon): spunti le competizioni che vuoi, poi premi *Installa in Stremio* oppure copia il link. Il link con una scelta parziale ha la forma `https://TUO-DOMINIO/cfg/serie-a,la-liga/manifest.json`: il catalogo, il filtro genere e le richieste di scheda e stream sono limitati a quelle competizioni. Senza spunte parziali vale `https://TUO-DOMINIO/manifest.json` (tutte).

### Cartelle copertine per competizione

Ogni competizione ha la sua cartella in `src/covers/`: `serie-b`, `champions` (Champions League), `europa` (Europa League), `premier-league`, `ligue-1`, `bundesliga`, `la-liga` (la Serie A usa il repository GitHub). Basta caricare le immagini nella cartella giusta (`squadra-casa_vs_squadra-ospite.png`, anche `.webp`/`.jpg`) e rifare il deploy; `default.png` facoltativa per le partite senza copertina dedicata. Il file `README.md` in ogni cartella ricorda il formato.

### Grafica della pagina di configurazione

La pagina (`src/configure.html`) ha colori, stemma e (per Serie A, Serie B, Champions, Europa League, Ligue 1 e Premier League) un'immagine di sfondo per ogni competizione (definiti in `src/league-art.js`). Gli stemmi sono disegni originali: per usare i loghi ufficiali metti i file in `src/assets/leagues/` (es. `serie-a.png`), vedi il `README.md` nella cartella.
