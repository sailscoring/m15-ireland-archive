# Irish Melges 15 results → Sail Scoring

A capture of the **Irish Melges 15 class**'s published event results and the
**as-published** ingest config that feeds them into
[Sail Scoring](https://app.sailscoring.ie) (app ADR-010): the results as
originally published are ingested and displayed faithfully — structured ranks
plus verbatim display cells — and **never re-scored**.

It is a deliberately minimal sibling of `irish-sailing-archive`: an event
list, the verbatim captures, an emit script and the identity bootstrap.

## What's here

```
sources/
  events.json                the event list (the only hand-written input)
  sailwave.com/results/      captured Sailwave pages (verbatim bytes)
scripts/
  emit-as-published-config.ts  events + captures → as-published.config.json
  bootstrap-identities.ts      generated rows → identities.json
identity-curation.json       hand-maintained spelling merges and splits
identities.json              the competitor-identity manifest (generated,
                             committed; never edit by hand)
as-published.config.json     generated ingest config (committed)
.github/workflows/
  as-published.yml           emit → generate → push to the m15 workspace
```

## Adding an event

1. Capture the page verbatim — bytes as served, never re-encoded:

   ```
   curl -sS -o sources/sailwave.com/results/<File>.htm '<url>'
   ```

2. Add an entry to `sources/events.json`. `title` is the page's `<h1>`
   exactly; dates go in only at the precision a published source states, with
   `datesFrom` saying which one.
3. Emit, generate, and rebuild the identity manifest — it is built from the
   generated rows, so the loop runs through the app:

   ```
   pnpm emit-as-published
   (cd ../sailscoring && pnpm archive-generate ../m15-ireland-archive/as-published.config.json)
   pnpm identities
   (cd ../sailscoring && pnpm archive-generate ../m15-ireland-archive/as-published.config.json)
   ```

4. Commit the capture, the event list, the config and `identities.json`
   together. Pushing to `main` ingests them.

## Identities

`pnpm identities` treats one normalised name as one sailor, helm and crew
alike, and skips cells that name nobody recognisable ("TBC", a bare "John").
Spellings that are one person go in `identity-curation.json`, on evidence —
the same boat, sail number and club at another event is enough; a similar
name alone is not. Slugs are public URLs, minted once and never moved.

The class's live-scored events in the same workspace are linked to these
identities by the app's reconcile pass, not by this repo.

`key` and `slug` are permanent: the key seeds the series' UUIDv5 id, and the
slug is a public URL. Changing either is a migration, not a rename.

## Events

| Season | Event | Source |
|--------|-------|--------|
| 2026 | Melges 15 Irish National Championships, Royal Irish YC, 22–23 Aug | [Sailwave](https://www.sailwave.com/results/RIYC/Melges15IrishNationalChampionship2026.htm) |

The 2026 page is headed "Results are provisional as of 14:22 on August 23,
2026" and was never re-published as final; it is ingested as published.

## Licensing

- **Code** — `scripts/`: [MIT](LICENSE).
- **Normalised data & docs** — `sources/events.json`,
  `as-published.config.json`, `README.md`: [CC0 1.0](LICENSE-DATA).
- **Source pages** — the verbatim captures under `sources/sailwave.com/`:
  **not covered by either license.** These are results published by their
  organising clubs (hosted by Sailwave), included only for reproducibility.
  All rights remain with their owners.
