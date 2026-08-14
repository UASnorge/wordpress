# UAS Innholdsverktøy

Batch-opplasting av saker (tittel, ingress, hovedtekst, bilde) fra et Word-dokument
til WordPress som utkast, med AI-analyse av innholdet og automatisk utfylling av
sosiale medier-felt (Yoast SEO) og konferanseplakat.

## Word-mal

Ett dokument kan inneholde flere saker. Skille mellom saker: en egen linje med `===`.

```
TITTEL: Ny E-VTOL-forskrift vedtatt av EASA
INGRESS: Kort ingress-tekst, 1-3 setninger.
HOVEDTEKST:
Første avsnitt.

Nytt avsnitt.
BILDE: bilde-01.jpg
ALT-TEKST BILDE: Beskrivelse av bildet for skjermlesere/SEO
===
TITTEL: Neste sak...
...
```

Last opp bildene som egne filer sammen med dokumentet (ikke limt inn i Word) —
filnavnet i `BILDE:`-feltet må stemme med det opplastede bildets filnavn.

Kategori og stikkord velges i appen, ikke i dokumentet.

## Miljøvariabler (settes i Netlify → Site settings → Environment variables)

| Variabel | Beskrivelse |
|---|---|
| `WP_URL` | f.eks. `https://www.uasnorway.no` |
| `WP_USERNAME` | WordPress-brukernavn (es@uasnorway.no) |
| `WP_APP_PASSWORD` | Application Password fra WP-admin → Din profil |
| `ANTHROPIC_API_KEY` | Egen API-nøkkel fra console.anthropic.com |
| `ANTHROPIC_MODEL` | (valgfritt) standard: `claude-sonnet-5` |
| `APP_ACCESS_PASSWORD` | Passordet du selv logger inn i verktøyet med |
| `APP_SESSION_SECRET` | (valgfritt) egen hemmelighet for signering av innloggingsøkt. Faller tilbake til `APP_ACCESS_PASSWORD` hvis ikke satt |

**Ingen av disse skal noensinne limes inn i en chat med Claude** — legg dem
direkte inn i Netlifys miljøvariabel-skjema.

## Yoast SEO-felt (sosiale medier)

Verifisert ved test mot uasnorway.no (14.08.2026, sak-id 19520): `_yoast_wpseo_title`
og `_yoast_wpseo_metadesc` er allerede skrivbare via REST API på dette nettstedet.
Yoast bruker disse to feltene, sammen med hovedbildet (`featured_media`), som
automatisk fallback for sosiale medier-fanen når ingen egne Facebook/Twitter-felt
er satt eksplisitt:

- **Sosial tittel** ← `_yoast_wpseo_title` (= sakens tittel)
- **Sosial beskrivelse** ← `_yoast_wpseo_metadesc` (= ingressen)
- **Sosialt bilde** ← hovedbildet (featured image)

Dette dekker kravet uten behov for noen ekstra plugin. De direkte
`opengraph-*`-metafeltene er IKKE skrivbare via REST på dette nettstedet (testet
og bekreftet ignorert av WP), men trengs altså ikke siden fallback-verdiene
allerede blir riktige.

## Deploy

1. Opprett et nytt (privat) GitHub-repo og push dette prosjektet dit.
2. På [app.netlify.com](https://app.netlify.com): "Add new site" → "Import an existing project" → velg repoet.
3. Build-innstillinger fylles automatisk fra `netlify.toml` (publish: `public`, functions: `netlify/functions`).
4. Legg inn miljøvariablene over under Site settings → Environment variables.
5. Deploy. Hver push til hovedgrenen deployer automatisk på nytt.

## Bruk

1. Åpne appen, logg inn med `APP_ACCESS_PASSWORD`.
2. Last opp Word-dokumentet og alle tilhørende bilder.
3. Trykk "Tolk dokument" — sakene vises som kort du kan redigere.
4. Sett ev. konferanseplakat + lenke (gjelder for hele batchen).
5. For hver sak: sjekk/rediger tekst, huk av kategori, skriv stikkord, evt. trykk
   "Analyser med AI" for en rask kvalitetssjekk.
6. Trykk "Send inn batch som utkast" — alle saker opprettes som **utkast** i
   WordPress. Åpne lenkene i resultat-tabellen for å kvalitetssikre og publisere
   manuelt.

## Kjente begrensninger / videre arbeid

- Ingen automatisk bildekomprimering ennå (forbedringsforslag fra tidligere).
- Duplikatsjekk på tittel/slug er ikke implementert.
- AI-analysen er rådgivende og blokkerer ikke innsending.
