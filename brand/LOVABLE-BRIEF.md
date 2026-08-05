# Lovable brief for the ALYX landing page

Paste the block below into Lovable. Upload the four files from this folder when it asks for assets.

**Do not paste any real job data into Lovable.** Everything in this brief is either public, synthetic, or your own product copy. Your tracker contains real people's names and a recruiter's work email; none of that goes to a third party.

---

## Paste this

I need a single-page product landing site for a developer tool called ALYX. Static only. No login, no database, no Supabase, no backend, no analytics. One page.

**Brand**

The wordmark is the word ALYX in Helvetica Neue Bold, all caps, with very wide letter spacing (0.34em). Think Saint Laurent: heavy grotesque, generous tracking, no decoration. Never add a tagline under the wordmark in the logo lockup itself. I am uploading wordmark.svg (black) and wordmark-white.svg.

Dark page. Background near-black (#0b0d11), cards slightly lighter (#141821), hairline borders (#232833), primary text #e6e9ef, secondary text #8891a0. One accent blue (#4c8dff) used sparingly. Flat, no gradients, no glow, no rounded-pill buttons.

**What the product is**

ALYX is a local job search command center. It scans public applicant tracking system job boards, scores every role against your own profile using Claude, and keeps all of your data on your own machine. No API keys. No accounts. Nothing about your search leaves your laptop except the requests to the job boards.

**Page structure, in order**

1. Hero: the ALYX wordmark, then the headline "Your job search, on your machine." Then one line of subcopy: "Scans public ATS boards. Scores roles with Claude. No API keys, no accounts, no cloud." One button: "See how it works" linking to https://github.com/jawnzzz/alyx. Do not use the words Download or Install anywhere on the page.

2. A terminal block showing real output. Use a monospace font, dark card, and colour only the two lines starting with "+" in green (#3fb950). Use exactly this text, do not invent numbers:

```
$ npm run scan

Scanning 6 boards…
  greenhouse/doordashusa: 468
  greenhouse/instacart: 117
  ashby/ramp: 120
  lever/palantir: 301
  workday/Stryker: 100
  workday/R1 RCM: 54

1156 scanned, 808 passed filters, 32 matched

$ npm run evaluate

  + [4] ramp      Senior Recruiter | Business / GTM
  + [4] R1 RCM    Talent Acquisition Specialist (Contract)
    [3] palantir  Talent Sourcer (Contractor)
    [1] doordash  Customer Success Manager, SMB
```

3. The app screenshot (I am uploading screenshot-app.png) in a simple dark browser or window frame, full width, with a short caption: "The desktop app. What needs your attention, your pipeline, and Claude, in one window."

4. A four-item feature grid, each a small card with a title and one sentence:
   - "Four job boards, no auth": Greenhouse, Ashby, Lever and Workday, straight from their public endpoints.
   - "Filters before it spends": deterministic rules throw out what obviously does not fit before any model is involved.
   - "Claude scores what survives": every role gets PASS, MARGINAL or FAIL with a one-sentence reason.
   - "Your data never leaves": no accounts, no server, no telemetry. Your profile and pipeline stay in local files.

5. A short "How it works" section as a simple four-step horizontal flow: Configure boards → Scan → Filter → Evaluate. Plain text, hairline connectors, no illustrations.

6. Footer: the wordmark small, "MIT licensed", and a GitHub link. Nothing else.

**Rules**

- No stock photography, no illustrations of people, no 3D shapes, no abstract blobs.
- No pricing section, no testimonials, no logos of companies as "customers". None exist and I will not fake them.
- No newsletter signup, no contact form, no cookie banner.
- Load no third-party scripts. If you need a font beyond system Helvetica, do not add one.
- Mobile responsive, single column on small screens.

---

## After Lovable is done

1. Use Lovable's GitHub sync to push it to a repo.
2. Tell me the repo name. I will clone it, review the diff, strip anything that phones home, and deploy it to a new Netlify site.

I will check for: Supabase client imports, analytics scripts, third-party font fetches, and any claim on the page that is not true.
