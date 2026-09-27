/**
 * `pnpm identities` — build `identities.json`, the competitor-identity
 * manifest the ingest applies.
 *
 * It runs over `archive-generate`'s output rather than the captures, so the
 * member rows it writes address exactly the rows the ingest will create.
 * That makes it an operator step, not a CI one:
 *
 *   pnpm emit-as-published
 *   (cd ../sailscoring && pnpm archive-generate ../m15-ireland-archive/as-published.config.json)
 *   pnpm identities
 *
 * Two sources decide who is who:
 *
 *  1. **One normalised name is one sailor.** This corpus is small and its
 *     names are distinctive, so a shared name is a shared person. A name that
 *     really is two people goes in `separate` in the curation file.
 *  2. **Curated aliases** — the cross-spelling merges the matcher cannot see,
 *     listed in `identity-curation.json`.
 *
 * **Crew count as sailors.** Every Melges 15 is double-handed, so reading
 * the helm field alone would leave half the entrants out of the record — and
 * leave anyone who helms one event and crews the next with half a career. Each person on a boat
 * is a member row of its own, tagged with the slot they filled.
 *
 * Slugs are minted **once** and then never move — they are public URLs, and
 * the identity id is a UUIDv5 of the slug. A re-run keeps every slug, name
 * and club already in `identities.json` and only assigns rows that aren't
 * claimed yet, so this is safe to re-run as events are added.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  isLowSignalPersonName,
  isPlaceholderName,
  splitCrewCell,
} from '../../sailscoring/lib/competitor-identity-match';

const GENERATED_DIR = 'as-published/series';
const CURATION = 'identity-curation.json';
const OUT = 'identities.json';

/** The app's slug-suffix alphabet (`lib/competitor-slug.ts`) — no 0/o/1/l/i,
 *  the characters people misread copying a slug off a results sheet. */
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SUFFIX_LENGTH = 4;

type Role = 'primary' | 'crew';
type Member = [string, string] | [string, string, Role];

interface ManifestIdentity {
  slug: string;
  name: string;
  club?: string;
  members: Member[];
  note?: string;
}

interface Curation {
  unify?: Array<{ name: string; aliases?: string[]; note?: string }>;
  separate?: string[];
}

interface Row {
  seriesKey: string;
  season: string;
  /** The boat this person sailed on. Two people sharing it are two sailors. */
  boatId: string;
  sail: string;
  name: string;
  role: Role;
  club: string | null;
}

/** `(series, sail, slot)` — the manifest's member key, as one string. */
function memberKey(m: Member): string {
  return `${m[0]}|${m[1]}|${m[2] ?? 'primary'}`;
}

/** Mirrors the app's `slugifyName`. */
function slugifyName(label: string): string {
  return (
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'competitor'
  );
}

/** Name → comparison key: diacritics folded, punctuation and case dropped, so
 *  "Ryan O Driscoll" and "Ryan O'Driscoll" agree without curation. */
function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A deterministic suffix, so a re-run that has to mint the same identity
 *  mints the same slug. */
function suffix(stableKey: string): string {
  const digest = createHash('sha1').update(stableKey, 'utf8').digest();
  let n = digest.readBigUInt64BE(0);
  const size = BigInt(SUFFIX_ALPHABET.length);
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += SUFFIX_ALPHABET[Number(n % size)];
    n /= size;
  }
  return out;
}

function mintSlug(name: string, stableKey: string, taken: Set<string>): string {
  const base = slugifyName(name);
  let key = stableKey;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${suffix(key)}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    key += '+';
  }
  throw new Error(`could not mint a free slug for ${name}`);
}

/** Every person in every generated document, one row each. */
function readRows(): { rows: Row[]; series: Record<string, string>; skipped: string[] } {
  const series: Record<string, string> = {};
  const rows: Row[] = [];
  const skipped: string[] = [];

  for (const file of readdirSync(GENERATED_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(readFileSync(join(GENERATED_DIR, file), 'utf8')) as {
      series: { id: string; publishedSlug: string };
      competitors: Array<{
        sailNumber?: string;
        name?: string;
        crewName?: string;
        club?: string;
      }>;
    };
    const seriesKey = basename(file, '.json');
    series[seriesKey] = doc.series.id;

    doc.competitors.forEach((competitor, index) => {
      const sail = (competitor.sailNumber ?? '').trim();
      const club = competitor.club?.trim() || null;
      const boatId = `${seriesKey}#${index}`;
      const people: Array<{ name: string; role: Role }> = [
        ...(competitor.name?.trim() ? [{ name: competitor.name.trim(), role: 'primary' as const }] : []),
        // A crew cell can name more than one person; the app splits it the
        // same way when it reconciles, so reuse that rather than guess.
        ...splitCrewCell(competitor.crewName).map((name) => ({ name, role: 'crew' as const })),
      ];
      for (const person of people) {
        // A cell that names nobody ("TBC", "crew") or nobody recognisable (a
        // bare "John") is not a sailor — the app's reconcile pass skips the
        // same cells. Reported rather than published, so a corpus quietly
        // filling up with them is visible.
        if (isPlaceholderName(person.name) || isLowSignalPersonName(person.name)) {
          skipped.push(`${seriesKey}|${sail}|${person.role}: "${person.name}"`);
          continue;
        }
        rows.push({ seriesKey, season: doc.series.publishedSlug, boatId, sail, name: person.name, role: person.role, club });
      }
    });
  }
  return { rows, series, skipped };
}

function main(): void {
  if (!existsSync(GENERATED_DIR)) {
    throw new Error(
      `no ${GENERATED_DIR} — run archive-generate over as-published.config.json first`,
    );
  }
  const { rows, series, skipped } = readRows();

  const curation = existsSync(CURATION)
    ? (JSON.parse(readFileSync(CURATION, 'utf8')) as Curation)
    : {};
  const separate = new Set((curation.separate ?? []).map(nameKey));
  const aliasTo = new Map<string, string>();
  const displayFor = new Map<string, string>();
  const noteFor = new Map<string, string>();
  for (const group of curation.unify ?? []) {
    const canonical = nameKey(group.name);
    displayFor.set(canonical, group.name);
    if (group.note) noteFor.set(canonical, group.note);
    for (const alias of [group.name, ...(group.aliases ?? [])]) {
      aliasTo.set(nameKey(alias), canonical);
    }
  }

  // Group the rows into people.
  const groups = new Map<string, Row[]>();
  rows.forEach((row, index) => {
    const key = nameKey(row.name);
    // A name the curation says is two sailors gets one group per row, so the
    // default never fuses them.
    const groupKey = separate.has(key) ? `separate:${index}` : (aliasTo.get(key) ?? key);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  });

  // The previous run supplies slugs only: an identity keeps the slug it was
  // minted under, because that slug is a public URL and seeds the identity's
  // UUIDv5. Nothing else is inherited — see the note at the push below.
  const existing: { identities?: ManifestIdentity[] } = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  const takenSlugs = new Set((existing.identities ?? []).map((i) => i.slug));
  const priorBySlug = new Map((existing.identities ?? []).map((i) => [i.slug, i]));
  const slugByMember = new Map<string, string>();
  for (const identity of existing.identities ?? []) {
    for (const member of identity.members) slugByMember.set(memberKey(member), identity.slug);
  }
  const inherited = new Set<string>();

  const identities: ManifestIdentity[] = [];
  for (const [groupKey, groupRows] of groups) {
    const members: Member[] = groupRows.map((row) =>
      row.role === 'primary' ? [row.seriesKey, row.sail] : [row.seriesKey, row.sail, 'crew'],
    );
    // Latest season decides the display name and club: it is the scorer's
    // most recent word on both. The curation overrides the name where a
    // spelling has been settled.
    const latest = [...groupRows].sort((a, b) => a.season.localeCompare(b.season)).at(-1)!;
    const name = displayFor.get(groupKey) ?? latest.name;

    // A slug this group's rows already carried is reused, so a re-run never
    // moves a sailor's URL. One slug is one sailor, so a slug already claimed
    // this run is not inherited again.
    const priorSlug = members
      .map((m) => slugByMember.get(memberKey(m)))
      .find((s): s is string => !!s && !inherited.has(s));
    if (priorSlug) inherited.add(priorSlug);

    // The previous run's file contributes the **slug and nothing else**. Name,
    // club and note are derived from the curation and the rows every time, so
    // a curated rename actually lands — `identities.json` is generated, and an
    // earlier run's display name is not evidence about anything.
    const slug = priorSlug ?? mintSlug(name, members.map(memberKey).join('|'), takenSlugs);
    const note = noteFor.get(groupKey);
    identities.push({
      slug,
      name,
      ...(latest.club ? { club: latest.club } : {}),
      members,
      ...(note ? { note } : {}),
    });
  }
  identities.sort((a, b) => a.slug.localeCompare(b.slug));

  // Validate before writing: the apply resolves each member by
  // `(series-slug, sail, slot)`, so a row claimed twice or not at all is a
  // corrupted manifest, and one identity holding two people off the same boat
  // is the merge error that matters.
  const problems: string[] = [];
  const claimed = new Map<string, number>();
  const boatsBySlug = new Map<string, Set<string>>();
  const rowByMember = new Map(
    rows.map((row) => [
      memberKey(row.role === 'primary' ? [row.seriesKey, row.sail] : [row.seriesKey, row.sail, 'crew']),
      row,
    ]),
  );
  for (const identity of identities) {
    const boats = new Set<string>();
    for (const member of identity.members) {
      const key = memberKey(member);
      claimed.set(key, (claimed.get(key) ?? 0) + 1);
      const row = rowByMember.get(key);
      if (!row) {
        problems.push(`${identity.slug}: no row for ${key}`);
        continue;
      }
      if (boats.has(row.boatId)) {
        problems.push(`${identity.slug}: claims two people off the same boat (${row.boatId})`);
      }
      boats.add(row.boatId);
    }
    boatsBySlug.set(identity.slug, boats);
  }
  for (const [key, count] of claimed) {
    if (count > 1) problems.push(`${key} is claimed by ${count} identities`);
  }
  for (const key of rowByMember.keys()) {
    if (!claimed.has(key)) problems.push(`${key} is claimed by no identity`);
  }
  const slugs = identities.map((i) => i.slug);
  for (const slug of new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))) {
    problems.push(`duplicate slug: ${slug}`);
  }
  if (problems.length > 0) {
    console.error(`${problems.length} problems — not writing ${OUT}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  writeFileSync(
    OUT,
    `${JSON.stringify({ version: 1, series, identities }, null, 2)}\n`,
  );

  const minted = identities.filter((i) => !priorBySlug.has(i.slug)).length;
  const multi = identities.filter((i) => new Set(i.members.map((m) => m[0])).size > 1).length;
  console.log(
    `${rows.length} rows -> ${identities.length} sailors -> ${OUT}\n` +
      `  ${minted} slugs minted, ${identities.length - minted} preserved\n` +
      `  ${multi} appear in more than one event`,
  );
  if (skipped.length > 0) {
    console.log(`  ${skipped.length} cells named nobody and were skipped:`);
    for (const line of skipped) console.log(`    ${line}`);
  }
}

main();
