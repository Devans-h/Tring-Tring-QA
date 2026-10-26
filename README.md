# Tring-Tring QA – Problems in Agent Calling

A shared issue board for the Tring-Tring calling agent. Every problem has a title,
description, expectation, **proof that plays on the page** (call recording,
screenshot or transcript), a developer remark box and a "complete" tick.
Remarks, ticks and page-added problems are shared live between everyone who has
the page open.

Live copy: https://tring-tring-problems.vercel.app

```
index.html   page markup
style.css    styles (light + dark, responsive)
app.js       all behaviour: rendering, filters, players, Supabase sync, add-problem dialog
data.js      the problem list, grouped in sections  <- edit this to add/change problems
config.js    Supabase URL + anon key
audio/       proof recordings and screenshots referenced from data.js
supabase/    SQL to create the tables and storage bucket (run once per Supabase project)
serve.py     optional local server (fallback when Supabase is not configured)
```

Plain HTML, CSS and JavaScript. **No framework, no build step, no environment
variables.** The only runtime dependency is `@supabase/supabase-js` loaded from a
CDN in `index.html`.

---

## Quick start (run it locally)

```bash
git clone https://github.com/Devans-h/Tring-Tring-QA.git
cd Tring-Tring-QA
python3 -m http.server 8080      # or: python3 serve.py
# open http://localhost:8080
```

Opening `index.html` straight from the file system also works.

---

## Integrating into another app (e.g. the super admin panel)

The page is self-contained and every path in it is relative, so it can live under
any route. Pick one of these.

### Option A – iframe (zero code)

```html
<iframe src="https://tring-tring-problems.vercel.app" style="width:100%;height:100vh;border:0"></iframe>
```

Every push to this repo that is deployed to Vercel shows up in the panel
automatically. Downside: the public URL stays reachable outside the panel's login.

### Option B – mount the files under a route (recommended)

1. Copy `index.html`, `style.css`, `app.js`, `data.js`, `config.js` and `audio/`
   into the panel's static/public folder, for example `public/problems/`.
2. Link to `/problems/` from the panel's menu. Done.

Things to adjust if needed:

| Want | Change |
|---|---|
| Match the panel theme | set `data-theme="dark"` or `"light"` on `<html>`; otherwise it follows the OS setting |
| Panel has a fixed header | in `style.css` change `.toolbar { top: 0 }` to the header height |
| Hide the page's own title bar | add `.top { display: none }` |
| Reuse the panel's Supabase client | drop the CDN `<script>` tag and expose it as `window.supabase` before `app.js` loads |

### Option C – native rebuild

Use the Supabase tables below as the data source and build the UI in the panel's
own framework. `app.js` is the reference implementation of every behaviour.

---

## Data model

### Problems defined in code – `data.js`

```js
window.SECTIONS = [
  {
    key: "pramukh",                      // unique, used in storage keys – never rename after use
    title: "Pramukh Problems",
    subtitle: "Issues seen on the Pramukh calls.",
    problems: [
      {
        id: 1,                           // number shown on the row; unique within the section
        title: "Agent Went Silent Mid-Call",
        problem: "What happened and why it is a problem.",
        expectation: "What should happen instead.",
        proof: [
          { file: "audio/p01-ai-went-silent.wav", name: "AI went silent" },   // audio -> in-page player
          { file: "audio/shot.png", name: "Screenshot" },                     // image -> thumbnail + lightbox
          { text: "transcript excerpt...", name: "Transcript" },              // text  -> quoted block
          { link: "https://...", name: "Open folder" },                       // link
          { note: "Same recording as problem 1." }                            // small italic note
        ]
      }
    ]
  }
];
```

To add a problem: drop the recording into `audio/`, add an object to the right
section, commit, deploy. To add a section: append another `{ key, title, subtitle,
problems }` object.

### Shared state – Supabase

Two tables and one storage bucket, created by the SQL in `supabase/`:

| Object | Created by | Holds |
|---|---|---|
| `public.problem_state` | `schema.sql` | one row per problem key: `remark`, `remark_updated`, `done`, `done_updated` |
| `public.problems` | `problems.sql` | problems added from the page: `section_key`, `section_title`, `num`, `title`, `problem`, `expectation`, `proof` (jsonb, same shape as in `data.js`) |
| bucket `proofs` (public) | `problems.sql` | recordings / screenshots uploaded from the page |

The problem key is `"<section.key>-<id>"` for problems from `data.js` and
`"<section.key>-x<first 8 chars of row id>"` for page-added ones. Both tables are
in the `supabase_realtime` publication, which is how open pages update live.

### Setting up a new Supabase project

1. Create a project at https://supabase.com.
2. SQL Editor -> New query -> paste `supabase/schema.sql` -> Run.
3. Same again with `supabase/problems.sql`.
4. Project Settings -> API: copy *Project URL* and *anon public* key into `config.js`.

The anon key is meant to be shipped in the page. **Access note:** the policies
let anyone with the key read and write, so the page should sit behind the panel's
login, or the policies should be tightened to authenticated users.

---

## Deploying

Any static host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3, nginx).
The live copy is on Vercel: from this folder run `vercel deploy --prod --yes`.
`.vercelignore` already excludes the local-only files.

---

## Page features (for reference)

- Sections with per-section progress; header shows done / pending / with proof / remarked.
- Filters: status, section, proof type, recording duration, remark state; free-text
  search; several sort orders. Filter choices are remembered per browser.
- Custom audio player: play / pause, seek, speed 1–2x, download. One recording plays at a time.
- Recordings shared by several problems are labelled automatically.
- **+ Add problem** dialog: section (or new section), title, description,
  expectation, file uploads, transcript, link. Page-added rows have a *Remove* button.
- Export is not built in; `problem_state` and `problems` can be read straight from Supabase.
