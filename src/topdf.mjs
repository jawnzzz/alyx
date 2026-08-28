#!/usr/bin/env node
/**
 * Word to PDF, locally.
 *
 * Most ATSs accept .docx and some want .pdf, so every resume should exist as
 * both. Conversion runs through the LibreOffice already installed on this
 * machine: nothing is uploaded to a converter, which matters because a resume
 * is a document full of personal data.
 *
 * Usage:
 *   node src/topdf.mjs "<path to .docx>"
 *   node src/topdf.mjs --all          # every selectable resume missing a PDF
 */

import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';

import { selectable } from './resumes.mjs';

const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

if (!existsSync(SOFFICE)) {
  console.error('LibreOffice not found. Install it, or convert by hand.');
  process.exit(1);
}

export function toPdf(docx) {
  const out = dirname(docx);
  const pdf = join(out, `${basename(docx, '.docx')}.pdf`);

  // Skip when the PDF is already newer than the source. Re-converting on every
  // run would churn timestamps and make it impossible to see what changed.
  if (existsSync(pdf) && statSync(pdf).mtime > statSync(docx).mtime) return { pdf, skipped: true };

  execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', out, docx], { stdio: 'pipe' });
  return { pdf, skipped: false };
}

const argv = process.argv.slice(2);

if (argv.includes('--all')) {
  const targets = selectable().filter(r => r.format === 'docx');
  let made = 0, kept = 0;
  for (const r of targets) {
    try {
      const { skipped } = toPdf(r.path);
      skipped ? kept++ : made++;
      console.log(`${skipped ? 'up to date' : 'converted '}  ${r.name}`);
    } catch (e) {
      console.log(`FAILED      ${r.name}: ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${made} converted, ${kept} already current`);
} else if (argv[0]) {
  console.log(toPdf(argv[0]).pdf);
} else {
  console.error('usage: node src/topdf.mjs "<file.docx>"   |   node src/topdf.mjs --all');
  process.exit(1);
}
