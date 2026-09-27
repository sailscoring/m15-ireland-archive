# CLAUDE.md

Read `README.md` first. This is a minimal as-published archive (app ADR-010)
for the Irish Melges 15 class — a data pipeline, not an application, modelled
on `../irish-sailing-archive` but deliberately smaller. Keep it that way:
add machinery (identity manifest, capture script) only when an event needs it.

## Rules

1. **Captures are verbatim third-party pages.** Never edit or re-encode
   anything under `sources/sailwave.com/`. Never decode one by hand either —
   the emit script uses the app's `decodeCapture`, the same reader
   `archive-generate` uses.
2. **Only real published data.** Dates carry a `datesFrom` naming the
   published text they came from; if nothing states it, leave it out.
3. **Never change an emitted `key` or `slug`.** The key seeds the series'
   UUIDv5 id; the slug is a public URL.
4. **The `<h1>` check is not noise.** A re-published page with a new title is
   a change to review, not to absorb.
5. **The `m15` workspace is shared with live-scored series.** The class
   scores its current events in the app and publishes them under
   `/p/m15/<season>/…`, so check <https://app.sailscoring.ie/p/m15> for a
   slug before minting one here — the emit script only sees this repo's.

## Relationship to the app repo

Assumes the app checkout at `../sailscoring`; the emit script imports its
archive-kit by relative path. Pushing to the production workspace is CI's
job — this repo's job ends at a validated config.

## Git conventions

- One coherent change per commit.
- Commit as `markbmc@gmail.com`, unsigned (`commit.gpgsign=false`).
- End every commit message with the `Co-Authored-By` trailer.
- **Do not push unless asked.**
