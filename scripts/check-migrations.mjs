#!/usr/bin/env node
/**
 * Migration-folder integrity check. Pure and offline — no database needed, so
 * it is cheap enough to run on every push.
 *
 * This exists because of a real near-miss (2026-07-30): two branches each
 * generated a migration numbered 0025, and the collision was only caught by
 * hand during a merge. Two entries sharing an `idx` breaks the replay for
 * everyone downstream, and the failure surfaces far from its cause.
 *
 * Checks, in order of how badly they bite:
 *   1. duplicate idx        — the collision above
 *   2. duplicate tag        — two files claiming the same name
 *   3. journal entry with no .sql file  — replay dies at that step
 *   4. .sql file not in the journal     — a migration that silently never runs
 *   5. non-monotonic idx    — ordering is the only thing sequencing DDL
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRIZZLE_DIR = 'drizzle';
const JOURNAL = join(DRIZZLE_DIR, 'meta', '_journal.json');

const problems = [];

const journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
const entries = journal.entries ?? [];

const seenIdx = new Map();
const seenTag = new Map();
for (const entry of entries) {
  if (seenIdx.has(entry.idx)) {
    problems.push(
      `duplicate idx ${entry.idx}: "${seenIdx.get(entry.idx)}" and "${entry.tag}". ` +
        `Two branches generated a migration with the same number — regenerate the later ` +
        `one against the other's snapshot rather than renaming it.`,
    );
  }
  seenIdx.set(entry.idx, entry.tag);

  if (seenTag.has(entry.tag)) problems.push(`duplicate tag "${entry.tag}" in the journal`);
  seenTag.set(entry.tag, entry.idx);
}

for (let i = 1; i < entries.length; i += 1) {
  if (entries[i].idx <= entries[i - 1].idx) {
    problems.push(
      `journal is out of order: "${entries[i].tag}" (idx ${entries[i].idx}) follows ` +
        `"${entries[i - 1].tag}" (idx ${entries[i - 1].idx}). Order is the only thing ` +
        `sequencing DDL, so this must strictly increase.`,
    );
  }
}

const sqlFiles = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
const sqlByTag = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, '')));

for (const entry of entries) {
  if (!sqlByTag.has(entry.tag)) {
    problems.push(`journal names "${entry.tag}" but ${DRIZZLE_DIR}/${entry.tag}.sql is missing`);
  }
}
for (const tag of sqlByTag) {
  if (!seenTag.has(tag)) {
    problems.push(
      `${DRIZZLE_DIR}/${tag}.sql is not in the journal, so it will never run. ` +
        `A migration that exists but never applies is worse than one that is missing.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\nMigration check failed (${problems.length}):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`Migration check passed: ${entries.length} migrations, journal and files agree.`);
