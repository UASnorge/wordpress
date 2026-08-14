# Kontekst-prompt: WordPress Infosak Batch Administrator

> Lim inn hele denne teksten som første melding til en annen AI for å gi den full
> kontekst om verktøyet. Skriv gjerne til slutt hva du konkret vil ha hjelp med.

Du får nå kontekst om et verktøy som er bygget og satt i produksjon. Les hele
beskrivelsen før du svarer på noe om det.

## Hva verktøyet gjør

**WordPress Infosak Batch Administrator** er et internt nettbasert verktøy for
UAS Norge (uasnorway.no) som automatiserer opplasting av nyhetssaker til
WordPress. Før dette verktøyet ble laget, ble 20+ saker fra ett Word-dokument
lagt inn manuelt, én og én, i WordPress-admin.

Verktøyet gjør tre ting:
1. **Ny batch**: Last opp ett Word-dokument med flere saker (tittel, ingress,
   hovedtekst, bilde) + bildefilene → verktøyet tolker dem automatisk, du
   redigerer/godkjenner, og alle opprettes som **utkast** i WordPress i én
   operasjon.
2. **Oversikt**: Administrer eksisterende saker i WordPress (utkast og
   publiserte) med bulk-handlinger: publisere flere, endre stikkord på flere,
   slette flere, kopiere lenker.
3. **AI-assistent**: En flytende chat-boble som kan slå opp faktiske saker/
   lenker i WordPress på forespørsel, og ta imot filvedlegg (Word-dokument
   eller bilde) for analyse.

## Live og kildekode

- Live-app: https://wordpress-infosak.netlify.app/
- GitHub-repo: https://github.com/UASnorge/wordpress (privat repo)
- WordPress-nettstedet det snakker med: https://www.uasnorway.no

## Arkitektur

Ren statisk frontend + serverless backend, ingen database, ingen frontend-
rammeverk (bevisst valg for enkelhet og null build-steg):

```
uas-innholdsverktoy/
├── netlify.toml              # Netlify build/deploy-config
├── package.json              # avhengigheter: @anthropic-ai/sdk, busboy, mammoth
├── public/                   # statisk frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── netlify/functions/        # backend - én fil = én serverless-funksjon (Node.js)
│   ├── login.js              # sjekker delt passord, utsteder signert sesjonstoken
│   ├── parse-docx.js         # mammoth (docx→tekst) + egen parser → sak-liste
│   ├── wp-taxonomies.js      # henter WP-kategorier/stikkord
│   ├── analyze-article.js    # Claude-kall: kvalitetsvurdering av én sak (rådgivende)
│   ├── upload-image.js       # laster bilde opp til WP media library
│   ├── create-post.js        # oppretter WP-innlegg (utkast) med alle felt
│   ├── list-posts.js         # henter eksisterende WP-innlegg m/filter (Oversikt-fanen)
│   ├── bulk-update.js        # bulk-handlinger: publiser/utkast/slett/tagger
│   ├── assistant.js          # AI-assistenten: Claude tool-use-loop + filvedlegg
│   └── lib/
│       ├── auth.js           # HMAC-signert sesjonstoken (ingen brukerdatabase)
│       ├── wp.js             # tynn klient mot WordPress REST API (Basic Auth)
│       ├── parseArticles.js  # regex-basert tolker av dokumentformatet
│       └── multipart.js      # busboy-wrapper for fil-opplastinger
└── docs/
    └── Mal-opplasting-av-saker.docx   # ferdig eksempel-mal for sluttbrukeren
```

**Deploy**: GitHub-repoet er koblet til Netlify med automatisk deploy på hver
push til `main`. Ingen manuell deploy-prosess.

## Dokumentformatet (input)

Word-dokumentet bruker faste feltnavn per sak, adskilt med en linje med kun `===`:

```
TITTEL: ...
INGRESS: ...
HOVEDTEKST:
(flere avsnitt, tom linje mellom)
BILDE: filnavn.jpg
ALT-TEKST BILDE: ...
===
(neste sak...)
```

Bilder lastes opp som egne filer (ikke embedded i Word) og matches til saken
via filnavn. Ingen øvre grense på antall saker (testet med 24+).

## Integrasjoner og autentisering

- **WordPress**: REST API (`/wp-json/wp/v2/...`) med Basic Auth via et
  WordPress *Application Password* (ikke hovedpassordet til kontoen).
  Environment-variabler: `WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`.
- **Anthropic Claude API**: brukes til (a) rådgivende kvalitetsanalyse av
  saker under opplasting, og (b) selve AI-assistenten (tool-use-loop).
  Environment-variabel: `ANTHROPIC_API_KEY` (+ valgfri `ANTHROPIC_MODEL`,
  standard `claude-sonnet-5`).
- **App-innlogging**: ett delt passord (`APP_ACCESS_PASSWORD`), ingen
  brukerdatabase. Innlogging gir et HMAC-SHA256-signert tidsbegrenset token
  (12t) lagret i `localStorage`, sendt som `Authorization: Bearer`-header.

Alle hemmeligheter ligger kun som Netlify-miljøvariabler, aldri i kode eller
klientsiden.

## Viktige designvalg (verdt å vite før du foreslår endringer)

1. **Utkast som standard**: Alle saker opprettes som `draft` i WordPress, aldri
   publisert automatisk. Bevisst sikkerhetsvalg.
2. **Yoast SEO / sosiale medier løses uten egen plugin**: Ved live-testing ble
   det bekreftet at `_yoast_wpseo_title` og `_yoast_wpseo_metadesc` er
   REST-skrivbare på dette nettstedet, og at Yoast automatisk bruker disse +
   `featured_media` som fallback for sosial tittel/beskrivelse/bilde. De
   direkte `opengraph-*`-metafeltene er IKKE REST-skrivbare og trengs ikke.
3. **Batch-gruppering via WordPress-tagger, ikke custom meta**: Alle saker i
   én opplasting merkes automatisk med en skjult tag
   (`batch-ÅÅÅÅMMDD-TTMM`), fordi tagger er REST-skrivbare uten videre, mens
   egendefinert post-meta krever `register_post_meta` på WP-siden (unngått
   bevisst for å slippe å røre WordPress-installasjonen).
4. **AI-assistenten er bevisst read-only overfor WordPress**: Den kan hente
   info (`list_posts`-verktøy den kaller selv via Claude tool-use), men kan
   ALDRI publisere, redigere eller slette noe selv. Alle skrivehandlinger går
   via eksplisitte knapper i Oversikt-fanen, med bekreftelsesdialog for
   destruktive handlinger. Dette er et bevisst sikkerhetsvalg, ikke en
   begrensning i Claude API-et.
5. **CSS-fallgruve løst**: `[hidden] { display: none !important; }` måtte
   legges til øverst i stilarket, fordi komponent-klasser som `.chat-widget`
   satte eksplisitt `display: flex`, som (ved lik CSS-spesifisitet) vant over
   nettleserens standard `[hidden]`-oppførsel og gjorde chat-widgeten synlig
   før innlogging.
6. **Bilder matches på filnavn, ikke embedding**: Unngår kompleks uttrekking
   av bilder fra .docx-filer — bildene lastes opp som egne filer ved siden av
   dokumentet.

## Kjente begrensninger

- Ingen automatisk bildekomprimering.
- Ingen duplikatsjekk på tittel/slug.
- Oversikt-fanen henter maks 40 saker per side, ingen paginering i UI ennå.
- AI-kvalitetsanalysen er rådgivende og blokkerer aldri innsending.

---

**Til deg som leser dette (AI-modell)**: Bruk konteksten over til å svare
presist på det brukeren spør om under. Ikke anta funksjonalitet som ikke er
beskrevet her — spør heller om å få se konkret kildekode hvis du trenger detaljer
utover dette dokumentet.
