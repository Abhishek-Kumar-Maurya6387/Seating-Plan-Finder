# Seating Plan Finder — Demo

A tiny full-stack app: enter a roll number, get back the exam room, seat,
building/floor, shift & timing, neighbours, and same-section room-mates —
all derived from the seating-plan PDFs.

## What's inside

```
site/
├── server.js         Express backend — student lookup + room-grid API
├── data.json         Parsed dataset: { students: {...}, rooms: {...} }
├── package.json
├── vercel.json        Vercel routing config
└── public/
    ├── index.html
    ├── style.css
    └── script.js
```

`data.json` has two parts:
- `students` — every roll number → its exam sessions (date, shift, room, seat position, branch/sem/section, room-level stats)
- `rooms` — every room-session (date+shift+room) → the **full seating grid** for that room plus the branch/sem/section breakdown read straight from that date's consolidated sheet

The frontend fetches a student's sessions first, then loads a room's full grid on demand (when you expand "Room seating table") — so the initial search stays fast even though the full dataset is large.

Branch/Section/Sem are read only from the consolidated PDF's actual table (via pdfplumber's structural table extraction, not from the roll-number prefix). When a roll number matches more than one printed range, the narrowest match wins — this defends against occasional malformed ranges in the source PDF.

Regenerate `data.json` any time by re-running the parser scripts (`build_dataset.py`) on updated PDFs — nothing else needs to change.

## Environment variables

Set these in Render/Vercel's dashboard (or a local `.env` file for testing) — never commit real values to the repo:

| Variable | Required? | Purpose |
|---|---|---|
| `MONGODB_URI` | Optional but recommended | Enables login/usage tracking. Get a free connection string from [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier is plenty for this). Without it, the app still works — students can look up seats — it just won't record who's logged in. |
| `ADMIN_KEY` | Optional | Lets you check usage at `/api/admin/usage?key=YOUR_KEY` — a JSON view of unique logins, total logins, and each user's email/roll/last-login. Pick any private string. |

## Login

Students sign in once per device with their `@kiet.edu` email **and** roll number — both required (no OTP, trust-based, no email verification step). Once signed in, the app shows their seat immediately on every future visit — no retyping. Stored in the browser (`localStorage`); a "Switch account" link is available if someone else uses the same device.

## Exam datesheet

Every session (published or not) now shows the actual exam subject name, pulled from the official datesheet PDF (`ESE_DATESHEET_...pdf`) and matched by date + branch + semester. If a student has an exam on a date that doesn't have a published seating plan yet, they still see the subject and date — just marked "seating plan not yet published" instead of room/seat details. To refresh this when a new datesheet is issued, re-run `build_dataset.py` after updating the `DATESHEET` path in that script.

## Admin panel

Visit `/admin.html` — only visible to the hardcoded admin email (`abhishek.2428cseai17@kiet.edu`, set via `ADMIN_EMAIL` env var if you need to change it) once that email is the one signed in on that browser. Shows: unique logins, total logins, error count (failed roll-number lookups) with the actual roll numbers searched, which branch/semester combinations have zero published seating anywhere in the dataset, and the full list of who's logged in.

**Security note:** this checks the email you're signed in as, not a password — anyone who knows the exact admin email could query `/api/admin/summary?email=...` directly. That's consistent with the no-OTP, trust-based design used for regular login too. If you want a harder gate later, add a real password/session check to that one route.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 and search any roll number from the dataset,
e.g. `202401100200001`.

## Deploy on Render

1. Push this folder to a GitHub repo.
2. On Render: **New → Web Service** → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Done — Render will build and give you a live URL.

This is the simplest path since the app is a plain always-on Express server.

## Deploy on Vercel

Vercel runs Node apps as serverless functions rather than a long-running
server, so a `vercel.json` is included to route `/api/*` to `server.js` and
everything else to the static `public/` folder.

1. Push the folder to GitHub.
2. On Vercel: **Import Project** → select the repo.
3. Framework preset: **Other**.
4. Deploy.

If the deploy can't find `data.json` inside the serverless function, add this
to `vercel.json` under a `functions` key so it's bundled with the function:

```json
"functions": {
  "server.js": { "includeFiles": "data.json" }
}
```

## Known limitations of this demo

- Dataset is whatever PDFs you uploaded — replace the source PDFs and re-run
  the parser scripts once you have the final/updated seating data.
- A handful of ranges in the source PDFs themselves contain odd/malformed
  entries (e.g. one row prints a roll-range that jumps between two
  unrelated branch series). The narrowest-match rule works around these,
  but if you spot a wrong branch/section anywhere, it's worth checking the
  actual PDF row for a similar anomaly.
- No login/auth — anyone who knows a roll number can look up that seat.
  Fine for an internal exam-cell tool; add auth before any public rollout.
