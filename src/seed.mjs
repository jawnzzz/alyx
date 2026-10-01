#!/usr/bin/env node
/**
 * Seed a demo ALYX with fabricated data.
 *
 * A freshly cloned tracker shows zeros, which tells a newcomer nothing about
 * what the tool does. This fills it with a plausible search so the funnel, the
 * history and the stats all have something to show.
 *
 * Everything here is invented. The companies are the standard placeholder names
 * so nobody mistakes a seeded rejection for a real one, and the applicant is
 * fictional. It never touches an existing store: if data/applications.json
 * exists, this refuses rather than overwriting a real search.
 *
 * Usage:
 *   node src/seed.mjs              # write the demo store
 *   node src/seed.mjs --force      # overwrite an existing store
 *   node src/seed.mjs --clear      # remove the seeded store again
 */

import { writeFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { makeApplication, setStatus, save, STORE_PATH } from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLICANT = join(ROOT, 'config', 'applicant.json');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');

if (argv.includes('--clear')) {
  for (const p of [STORE_PATH, join(ROOT, 'data', 'pipeline.json')]) {
    if (existsSync(p)) { rmSync(p); console.log(`removed ${p.replace(ROOT, '.')}`); }
  }
  process.exit(0);
}

if (existsSync(STORE_PATH) && !FORCE) {
  console.error(`${STORE_PATH} already exists.`);
  console.error('Refusing to overwrite a real tracker. Use --force if you meant it.');
  process.exit(1);
}

/** Placeholder companies, deliberately the well-known fictional ones so a
 *  seeded rejection can never be mistaken for a real one. */
/** Placeholder companies, deliberately the well-known fictional ones so a
 *  seeded rejection can never be mistaken for a real one. */
const COMPANIES = [
  'Initech', 'Globex', 'Northwind Traders', 'Umbrella Industries', 'Hooli',
  'Vehement Capital', 'Soylent Corp', 'Massive Dynamic', 'Cyberdyne Systems',
  'Stark Industries', 'Wayne Enterprises', 'Gringotts', 'Wonka Industries',
  'Acme Corp', 'Tyrell Corp', 'Oceanic Airlines', 'Virtucon', 'Prestige Worldwide',
  'Duff Brewing', 'Bluth Company', 'Pied Piper', 'Dunder Mifflin', 'Vandelay Industries',
  'Sterling Cooper', 'Paper Street Soap', 'Nakatomi Trading', 'Weyland Industries',
  'Gekko & Co', 'Bishop & Associates', 'Monarch Solutions', 'Aperture Labs',
  'Black Mesa', 'Abstergo', 'Vault-Tec', 'Rekall', 'Omni Consumer Products',
  'Genco Olive Oil', 'Spacely Sprockets', 'Cogswell Cogs', 'Zorg Industries',
  'Wernham Hogg', 'Bluebook', 'Encom', 'Cheyenne Mining', 'Sirius Cybernetics',
];

const TITLES = [
  'Technical Recruiter', 'Talent Acquisition Partner', 'Recruiting Operations Manager',
  'Customer Success Manager', 'Senior Recruiter, GTM', 'Talent Sourcer',
  'People Operations Associate', 'Technical Sourcer', 'Recruiting Coordinator',
  'Customer Success Lead', 'Talent Partner, Engineering', 'Client Operations Analyst',
];

const SOURCES = ['greenhouse', 'ashby', 'lever', 'workday'];

/**
 * A realistic shape, not a flattering one.
 *
 * Published benchmarks put application-to-reply in the low single digits to low
 * teens. The first version of this seed produced a 53% reply rate and an offer
 * from 15 applications, which is not a job search anyone has ever had: it would
 * misrepresent the product and make the funnel view look pointless, since the
 * funnel exists precisely to show how brutal the real numbers are.
 *
 * This is 45 applications, 9 replies of any kind (20%), 3 that moved forward,
 * 2 interviews and no offer. Still on the optimistic side of the published
 * range, because a demo with nothing in the later stages shows nothing.
 */
const OUTCOMES = [
  ['rejected', ['responded']],
  ['interviewing', ['responded']],
  ['rejected', []],
  ['responded', []],
  ['rejected', []],
  ['interviewing', ['responded']],
  ['rejected', []],
  ['rejected', []],
  ['rejected', []],
];

const day = (n) => {
  const d = new Date('2026-09-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const VARIANTS = ['recruiting', 'high-volume-ops', 'cs-ops'];

const TOTAL = 45;

const applications = Array.from({ length: TOTAL }, (_, i) => {
  const company = COMPANIES[i % COMPANIES.length];
  const role = TITLES[i % TITLES.length];
  const appliedAt = day(TOTAL * 2 - i * 2);
  const app = makeApplication({
    company, role,
    source: SOURCES[i % SOURCES.length],
    score: Number((2.4 + ((i * 7) % 23) / 10).toFixed(1)),
    appliedAt,
    url: `https://example.com/${company.toLowerCase().replace(/\W+/g, '-')}/jobs/${1000 + i}`,
    note: 'seeded demo data',
  });
  app.resumeVariant = VARIANTS[i % VARIANTS.length];
  app.resumeUsed = `Demo Resume - ${app.resumeVariant}.docx`;

  // Only the first OUTCOMES.length applications go anywhere. Everything else
  // stays at "applied" and never hears back, which is what actually happens.
  const outcome = OUTCOMES[i];
  if (outcome) {
    const [final, intermediate] = outcome;
    let offset = 6;
    for (const step of intermediate) {
      setStatus(app, step, { at: day(TOTAL * 2 - i * 2 - offset), note: 'seeded demo data' });
      offset += 7;
    }
    setStatus(app, final, { at: day(TOTAL * 2 - i * 2 - offset), note: 'seeded demo data' });
  }
  return app;
});

mkdirSync(dirname(STORE_PATH), { recursive: true });
save({ version: 1, applications });

// A demo applicant too, so the extension and the server have something to serve.
if (!existsSync(APPLICANT) || FORCE) {
  writeFileSync(APPLICANT, JSON.stringify({
    identity: { firstName: 'Alex', lastName: 'Rivera', preferredName: 'Alex',
                email: 'alex.rivera@example.com', phone: '(555) 010-4477',
                city: 'Austin', state: 'TX', country: 'United States' },
    links: { linkedin: 'https://www.linkedin.com/in/example', portfolio: '', github: '' },
    eligibility: { authorizedToWorkUS: true, requiresSponsorshipNowOrFuture: false,
                   willingToRelocate: false, noticePeriodDays: 14 },
    compensation: { default: '$110,000', career: '$110,000', other: '' },
    voluntary: { gender: 'decline', race: 'decline', veteranStatus: 'decline',
                 disabilityStatus: 'decline', hispanicOrLatino: 'decline' },
    experience: [
      { company: 'Globex', title: 'Senior Recruiter', location: 'Austin, TX', start: 'Mar 2022', end: 'Present', current: true },
      { company: 'Initech', title: 'Recruiting Coordinator', location: 'Austin, TX', start: 'Jun 2019', end: 'Mar 2022', current: false },
    ],
    education: [
      { school: 'State University', degree: 'BA', field: 'Communications', location: 'Austin, TX' },
    ],
    documents: { baseResume: 'Demo Resume - recruiting.docx', defaultResume: 'Demo Resume - recruiting.docx' },
  }, null, 2) + '\n');
  console.log('wrote config/applicant.json (demo applicant: Alex Rivera)');
}

console.log(`seeded ${applications.length} applications into data/applications.json`);
console.log('run `node src/track.mjs stats` to see the funnel, or `node src/seed.mjs --clear` to remove it');
