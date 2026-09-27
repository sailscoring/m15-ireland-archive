/**
 * `pnpm emit-as-published` — emit `as-published.config.json` from the event
 * list and the captures (app ADR-010). It is the input to the app repo's
 * `pnpm archive-generate`.
 *
 * One as-published series per event, one fleet per summary section on its
 * page. `sources/events.json` supplies only what the page cannot state for
 * itself — the season, the slug, the display name, the dates; the fleets, the
 * race tables and the venue are read off the capture through the app's
 * Sailwave parser, so the config can never disagree with what gets ingested.
 *
 * Series ids are UUIDv5 over `m15-ireland-archive/series/<key>`, so
 * regeneration updates rows in place and can never mint duplicates. **Never
 * change an emitted key or slug** — one re-mints the series id, the other
 * orphans a public URL.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeCapture } from '../../sailscoring/lib/archive-kit/capture-encoding';
import { seriesIdForKey } from '../../sailscoring/lib/archive-kit/ids';
import { parseSailwaveHtml } from '../../sailscoring/lib/archive-kit/sailwave-html';

const EVENTS_FILE = 'sources/events.json';
/** Where captures land, mirroring the source URL's host. */
const CAPTURE_DIR = 'sources/sailwave.com/results';
const OUT = 'as-published.config.json';
const REPO_KEY = 'm15-ireland-archive';
/** The workspace category the class files its events under. Applied on a
 *  series' first ingest only; a refiling in the app is never undone. */
const CATEGORY = 'M15 Ireland Events';

interface ArchiveEvent {
  /** Permanent: the series id is UUIDv5 over it. */
  key: string;
  /** Where the result was published. */
  url: string;
  /** The capture's filename under `CAPTURE_DIR`. */
  file: string;
  /** The published slug's season folder (app ADR-011). */
  season: string;
  /** The event's slug within its season. Public URL; never changed. */
  slug: string;
  name: string;
  /** The page's `<h1>` as published, checked against the capture on every
   *  emit so a re-publish under a different title is noticed. */
  title: string;
  startDate?: string;
  endDate?: string;
  /** Which published text the dates were read from. */
  datesFrom?: string;
  eventUrl?: string;
  seriesNote?: string;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'fleet'
  );
}

/** Sailwave puts the venue in the `<h2>`, under the event name. */
function venueOf(subtitle: string | null): string | undefined {
  const line = subtitle?.trim();
  return line && !/^https?:\/\//i.test(line) ? line : undefined;
}

function buildSeries(event: ArchiveEvent) {
  const file = join(CAPTURE_DIR, event.file);
  const { text } = decodeCapture(readFileSync(file));
  const page = parseSailwaveHtml(text);

  const title = page.title?.replace(/\s+/g, ' ').trim() ?? '';
  if (title !== event.title) {
    throw new Error(
      `${event.file}: the page's <h1> is now "${title}", but events.json ` +
        `records "${event.title}". Check what changed before updating it.`,
    );
  }
  if (page.summaries.length === 0) {
    throw new Error(`${event.file}: no summary sections — nothing to publish`);
  }

  const multi = page.summaries.length > 1;
  const fleets = page.summaries.map((summary) => {
    const name = summary.title?.trim() || 'Overall';
    return {
      name,
      subPath: multi ? `${event.slug}/${slug(name)}` : event.slug,
      file,
      ...(summary.title ? { sectionTitle: summary.title } : {}),
      ...(page.races.length > 0 ? { includeRaces: true } : {}),
    };
  });

  return {
    key: event.key,
    id: seriesIdForKey(REPO_KEY, event.key),
    publishedSlug: event.season,
    category: CATEGORY,
    name: event.name,
    ...(venueOf(page.subtitle) ? { venue: venueOf(page.subtitle) } : {}),
    ...(event.startDate ? { startDate: event.startDate } : {}),
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.eventUrl ? { eventUrl: event.eventUrl } : {}),
    ...(event.seriesNote ? { seriesNote: event.seriesNote } : {}),
    source: 'sailwave' as const,
    fleets,
    ...(multi ? { folders: [{ path: event.slug, label: event.name }] } : {}),
  };
}

function main(): void {
  const { events } = JSON.parse(readFileSync(EVENTS_FILE, 'utf8')) as {
    events: ArchiveEvent[];
  };

  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const event of events) {
    if (keys.has(event.key)) throw new Error(`duplicate event key: ${event.key}`);
    keys.add(event.key);
    const path = `${event.season}/${event.slug}`;
    if (paths.has(path)) throw new Error(`duplicate published path: ${path}`);
    paths.add(path);
  }

  const series = events
    .slice()
    .sort((a, b) => a.season.localeCompare(b.season) || a.slug.localeCompare(b.slug))
    .map(buildSeries);

  writeFileSync(OUT, `${JSON.stringify({ version: 1, out: 'as-published', series }, null, 2)}\n`);
  console.log(`${series.length} series -> ${OUT}`);
}

main();
