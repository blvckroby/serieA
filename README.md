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
