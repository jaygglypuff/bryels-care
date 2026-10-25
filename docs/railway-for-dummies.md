# Putting the Bryel's Care demo on Railway (step by step, no programming)

Who this is for: the owner, using only a web browser. You never need a terminal.
What you get: a web address (like `https://web-production-1234.up.railway.app`) where anyone you
share it with can open the Bryel's Care system, switch on **Try the demo**, and click
**Sign in as …** to see the system as an owner, a site manager, an operator, QA, warehouse,
sales and so on. Everything in it is fictional.
Every time the engineers push a change to GitHub, Railway rebuilds the app and the new version
appears by itself a few minutes later.

The technical version of this guide is `docs/deployment-railway.md` (section 2.4). Why it works
this way is ADR-055 in `docs/decision-log.md`.

## Words used in this guide

| Word | Plain meaning |
|---|---|
| Project | One "folder" on Railway that holds everything for the demo |
| Service | One running program inside the project. You will have up to four boxes: **web** (the website), **worker** (does background jobs), **Postgres** (the database), **Bucket** (file storage) |
| Canvas | The big board on the project page where the service boxes are drawn |
| Variable | A setting written as `NAME=value`, given to a service |
| Deploy / deployment | Railway building the newest code and starting it |
| Branch | A named line of work in GitHub. The demo uses `claude/vigilant-babbage-6zu1jo` |
| Domain | The web address of the app |
| Logs | The running commentary a service prints. Railway shows it under **Deploy Logs** |

## Before you start

1. A Railway account at https://railway.com, signed in with the GitHub account that can see
   the repository `jaygglypuff/bryels-care`.
2. A plan. The free trial works for a first try; for a demo that stays up, choose **Hobby**
   ($5 a month, which includes $5 of usage). See "What it costs" at the end.

---

## Step 1. Create the project from GitHub

1. On https://railway.com/dashboard click **New** (or **+ New Project**).
2. Choose **Deploy from GitHub repo**. If Railway asks for access to GitHub, allow it for the
   repository `jaygglypuff/bryels-care`.
3. Pick **jaygglypuff/bryels-care**.

What you should see: a project page with one box named **bryels-care**. It starts building
straight away. That first build may use the wrong branch and may fail; that is fine, step 2
fixes it.

## Step 2. Name the service "web" and choose the branch

1. Click the **bryels-care** box. A panel opens on the right. Open the **Settings** tab.
2. At the top, change the service name to exactly `web` (lower case) and press Enter.
   The name matters: the worker finds the web address through it.
3. Scroll to **Source**. Next to **Branch**, choose `claude/vigilant-babbage-6zu1jo`.
4. Leave **Root Directory** empty. Under **Build**, Railway should say it uses the
   **Dockerfile**. You do not need to type a start command.
5. Scroll to **Deploy**. If **Healthcheck Path** is empty, type `/api/health`. If there is a
   **Healthcheck Timeout**, type `300`.

What you should see: the settings saved without errors. Railway may start a new build; let it.

## Step 3. Add the database

1. On the canvas click **+ Create** (or **+ New**), then **Database**, then **PostgreSQL**
   (or press Ctrl+K / Cmd+K and type "Postgres").
2. Leave the name as **Postgres**.

What you should see: a second box named **Postgres** with an elephant icon, turning green
("Active") after a minute.

## Step 4. Give the web service its settings

1. Click the **web** box, open the **Variables** tab.
2. Click **Raw Editor** (top right of the variables list).
3. Paste exactly this and click **Update Variables**:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DEMO_MODE=true
   PORT=3000
   ```

4. Railway shows a banner about staged changes. Click **Deploy** (or **Apply changes**).

What the lines mean: `DATABASE_URL` connects the website to the database (Railway fills in the
real address itself; you never see the password). `DEMO_MODE=true` turns on the demo: fictional
data is loaded automatically into the empty database, the sign-in page gets the **Try the demo**
switch, and every page shows a green "Demo environment" strip. `PORT=3000` tells Railway which
door the website listens on.

You do **not** need to set `APP_ORIGIN`, secrets or keys for the demo: the app works them out
itself and says so in its log (see step 6).

## Step 5. Give the website a public address

1. Still on **web**, open **Settings**, scroll to **Networking** → **Public Networking**.
2. Click **Generate Domain**. If Railway asks which port, type `3000`.

What you should see: an address like `web-production-1234.up.railway.app`. Write it down; this is
the address you share.

## Step 6. Watch the first start and check it is healthy

1. Open the **Deployments** tab of **web** and click the newest deployment, then **Deploy Logs**.
2. A good first start prints, in this order (about 1 to 3 minutes after the build finishes):

   ```
   [start] Starting the web app (service web).
   [setup] ok      APP_ORIGIN: APP_ORIGIN is not set, so the app uses Railway's public address https://web-production-1234.up.railway.app.
   [setup] CHECK   FILE_URL_SECRET: Demo only: ... derived from the database address ...
   [setup] ok      DEMO_MODE: Demo mode is on ...
   Migrations applied
   [demo] Empty database: loading the fictional demo data (about a minute)…
   [demo] Demo data loaded in 20 s. Sign in with any demo account (password demo1234).
   ✓ Ready
   ```

   Lines that start with `[setup] CHECK` are reminders, not errors. A line starting with
   `[setup] PROBLEM` tells you exactly which setting to fix.
   One harmless line you can ignore: `"next start" does not work with "output: standalone"`.
3. The deployment turns green and says **Active** (Railway called `/api/health` and got an answer).
4. Optional check: open `https://<your address>/api/ready` in the browser. Healthy looks like
   `{"ok":true,"database":"up",...}`.

## Step 7. Add file storage (recommended, so uploads work)

Uploads (supplier certificates, delivery photos, import files) need somewhere to live.

1. On the canvas click **+ Create** → **Bucket**. Name it exactly `Bucket`, pick the region
   closest to you (Singapore if offered), click **Create**. The region cannot be changed later.
2. Click **web** → **Variables** → **Raw Editor**, add these lines below the existing ones,
   **Update Variables**, then **Deploy**:

   ```
   S3_ENDPOINT=${{Bucket.ENDPOINT}}
   S3_BUCKET=${{Bucket.BUCKET}}
   S3_REGION=${{Bucket.REGION}}
   S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}
   S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}
   ```

What you should see in the next web deploy log:
`[setup] ok      FILE_STORAGE: Bucket settings found (S3_*), so uploaded files are stored in the bucket.`
If you skip this step, everything else works and upload buttons say "File storage isn't set up".

(If the bucket's **Credentials** tab says to use "path-style" URLs, also add `S3_FORCE_PATH_STYLE=true`.)

## Step 8. Add the worker (background jobs)

The worker runs scheduled jobs: expiry checks, reservations lapsing, nightly reconciliation,
scheduled reports, import processing. Without it the website still works, but those jobs never run
and Admin → Diagnostics says "The worker is not running".

1. On the canvas click **+ Create** → **GitHub Repo** → **jaygglypuff/bryels-care** again.
2. Click the new box → **Settings**: name it exactly `worker`; under **Source** choose the branch
   `claude/vigilant-babbage-6zu1jo`; under **Deploy** set **Healthcheck Path** to `/api/health`
   if it is empty. Do **not** generate a domain for the worker.
3. **Variables** → **Raw Editor**, paste, **Update Variables**, **Deploy**:

   ```
   APP_ROLE=worker
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   DEMO_MODE=true
   APP_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
   ```

   If you did step 7, add the same five `S3_...` lines as well.

What you should see in the worker's Deploy Logs: `[start] Starting the background worker`,
then `"worker started"`. The worker never changes the database structure; it waits for the web
service to do that.

## Step 9. Open the app and try the demo

1. Open your address from step 5 on a computer or phone.
2. Under the sign-in box, switch on **Try the demo**.
3. The demo accounts appear grouped by role (Owner/Director, System Administrator, Site Manager, Production Planner,
   Production Operator, QA/QC, Warehouse Operator, Procurement, Sales/Customer Service, Finance, Auditor and more). Every one
   uses the password `demo1234`.
4. Click **Sign in as Ana Villanueva** (the owner). You land on the owner overview with a thin
   green strip at the top: **Demo environment — fictional data**.
5. To switch person: click your initials (top right) → **Sign out**, then pick another account.

## Step 10. How updates reach the app (automatic)

1. Every time a change is pushed to the branch `claude/vigilant-babbage-6zu1jo` on GitHub, Railway
   starts a new deployment of **web** and **worker** by itself.
2. Watch it on the project page: the service box shows **Building**, then **Deploying**, then
   **Active**. The **Deployments** tab lists every version with its GitHub message.
3. Typical time from push to live: 3 to 8 minutes.
4. **If a new version fails** (red **Failed** or **Crashed** in the Deployments tab), nothing
   breaks for your visitors: the previous version keeps running until a good version is ready.
   Tell the engineers and send them a screenshot of the Deploy Logs.
5. Your demo data is kept across updates. Updates never wipe it; only **Reset demo data** does.
6. Optional: **Settings → Wait for CI**. When switched on, Railway only deploys a version after
   the GitHub checks (tests) have passed. Safer, but each update arrives about 10 minutes later.

## Step 11. Reset the demo to a fresh copy

Do this after a demo session in which people changed lots of things.

1. Sign in as **Ana Villanueva** (owner). In the green strip at the top click **Reset demo data**
   (or click your initials → **Reset demo data**).
2. If the page asks **Confirm it's you**, type `demo1234` and click **Confirm**.
3. Type `RESET` in the box and click **Reset demo data**. Keep the page open; it takes about a
   minute and shows "Resetting…".
4. You are signed out and see "The demo data was reset to a fresh copy". Everyone else is signed
   out too. Sign in again with **Try the demo**.

The reset refuses if the database contains any account whose email does not end in
`@bryels-care.test` (for example a real person's address). That is on purpose: demo data is never
mixed with, or written over, real data. In the demo you can only invite made-up addresses such as
`new.person@bryels-care.test`.

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| Build **Failed** | The code could not be built | Nothing breaks (the old version keeps running). Send the engineers the **Build Logs**. Check the branch in Settings → Source is `claude/vigilant-babbage-6zu1jo` |
| Deploy failed with "Healthcheck failed" | The app did not answer `/api/health` in time | Open Deploy Logs and look for `[setup] PROBLEM`. Check **Healthcheck Path** is `/api/health` and **Healthcheck Timeout** is `300`. Check web has `PORT=3000` and the domain uses port 3000 |
| `[setup] PROBLEM DATABASE_URL ...` in the logs | The database setting is missing or misspelt | Variables → make sure `DATABASE_URL=${{Postgres.DATABASE_URL}}` and the database box is called exactly `Postgres`. Or delete the variable, click **New Variable**, name `DATABASE_URL`, and choose **Add Reference → Postgres → DATABASE_URL** |
| "Request origin not allowed." when signing in | The app thinks its address is different from the one in your browser | Remove any `APP_ORIGIN` variable from **web** (the app then uses the Railway address automatically), Deploy, and reload the page. If you use your own domain, set `APP_ORIGIN=https://your.domain` exactly, no slash at the end |
| Blank page or "Application failed to respond" | The app is still starting, or crashed | Wait 2 minutes and reload. If it stays, open web → Deploy Logs and send the last 30 lines to the engineers |
| No **Try the demo** switch on the sign-in page | Demo mode is off on **web** | web → Variables: `DEMO_MODE=true` (exactly), Deploy |
| Switch is there but says the demo data is still loading | The first load is running, or a reset failed | Wait one minute and reload. If it persists, check the web Deploy Logs for `[demo]` lines |
| "Someone changed this demo account's password" | A visitor changed that demo account's password | Use another account, or **Reset demo data** |
| Can't sign in at all, "account is locked" | Five wrong passwords were typed | Sign in as `admin@bryels-care.test` (Paolo Reyes) → Admin → Users → unlock, or **Reset demo data** |
| Logs show `refusing ... not a demo address` | This database holds a real account | Use a separate project for real data (below). Ask the engineers before deleting anything |
| Database errors (`ECONNREFUSED`, `password authentication failed`) | The database is restarting or the reference is wrong | Check the **Postgres** box is green. Then redeploy **web** (Deployments → ⋮ → **Redeploy**) |
| Uploads say "File storage isn't set up" | No bucket yet | Do step 7 |
| Upload fails with "Bucket upload failed with HTTP 403" | Bucket settings do not match | Check the five `S3_...` lines and that the bucket is called `Bucket`; see the bucket's Credentials tab |
| Admin → Diagnostics says the worker is not running | The worker service is missing or failing | Do step 8; check the worker's Deploy Logs |

## What it costs (check Railway's pricing page; prices read on 2026-10-24)

| Item | Approximate monthly cost for a small demo |
|---|---|
| Hobby plan | $5, includes $5 of usage |
| web (about 0.5 GB memory, mostly idle) | $3 to $6 |
| worker (about 0.3 GB memory) | $2 to $4 |
| Postgres (small) | $2 to $4 |
| Bucket (a few GB) | under $0.10 |
| **Total** | **roughly $5 to $15 a month**, of which $5 is included in the plan |

Railway charges by the second for memory ($10 per GB per month) and CPU ($20 per vCPU per month),
so an idle demo costs little. The free trial gives a one-time $5 credit and smaller limits (1 GB
memory per service), which is enough to try this guide once. You can see the running cost under
your workspace's **Usage** page.

## Going live later with real company data

Never switch an existing demo to real data. Real data gets its own, separate Railway project.

1. Create a **new project** (repeat steps 1, 2, 3, 5, 7 and 8 in the new project), with these
   differences:
   - Do **not** add `DEMO_MODE`. Add `APP_ENV=production` to both **web** and **worker**: this
     switches every demo feature off for good, even if someone adds `DEMO_MODE` by mistake.
   - Ask the engineers for two secret values and add them to **web** and **worker**:
     `FILE_URL_SECRET` (signs download links) and `DATA_ENCRYPTION_KEY` (protects two-step sign-in
     codes). The demo works them out itself; real data must not.
   - Usually the branch will be `production` or `main`; the engineers will tell you which.
2. Create the first administrator (you), without any terminal:
   - On **web** → Variables, add (with your details):
     ```
     BOOTSTRAP_ADMIN_EMAIL=you@yourcompany.com
     BOOTSTRAP_ADMIN_NAME=Your Full Name
     BOOTSTRAP_ORG_NAME=Bryel's Care Corporation
     BOOTSTRAP_SITE_CODE=NFD
     BOOTSTRAP_SITE_NAME=North Fields Plant
     ```
   - Deploy, open **Deploy Logs**, and find "Open this one-time link to set the password". Open
     that link (it works once, for 72 hours), choose your password, sign in.
   - Then **delete the five `BOOTSTRAP_...` variables** and Deploy once more.
   - Engineers who prefer a terminal can run `pnpm admin:bootstrap` with the same values through
     `railway ssh` instead.
3. Invite everyone else from **Admin → Users → Invite someone**. Set up two-step sign-in on
   **My account**.
4. Before relying on it: backups, a custom domain and email are in `docs/deployment-railway.md`
   (sections 9, 12 and 14a). The engineers handle those with you.
