# Cloud Build deploy-on-push — one-time setup

Context (2026-08-04): the Workspace gcloud session policy re-expires local
credentials ~daily, so David chose deploy-on-push (fleet memory: "deploying =
git push"). The GitHub App is installed on `XavaDigital/bm-order-confirmation`.
`cloudbuild.yaml` at the repo root runs **migrate → build → push → deploy**,
preserving the migrate-before-deploy rule.

Everything below is one-time, needs a live `gcloud auth login`, and is safe to
re-run. Project `beastmode-pm`, region `asia-southeast1`.

## 1. The migration secret

The migrate step reads Secret Manager secret `bm-orders-database-direct-url`
(the DIRECT port-5432 URL — the pooler rejects DDL). Create it from the value
in `.env.local` (the same one local `npm run db:migrate` uses):

```powershell
# from the repo root, PowerShell
$direct = (Get-Content .env.local | Where-Object { $_ -match '^DATABASE_DIRECT_URL=' }) -replace '^DATABASE_DIRECT_URL=', ''
if (-not $direct) { $direct = (Get-Content .env.local | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', '' }
$direct | gcloud secrets create bm-orders-database-direct-url --data-file=- --project beastmode-pm
```

(If the secret already exists: `gcloud secrets versions add` instead.)

## 2. Service-account roles

Find the build service account (2nd-gen triggers default to the Compute
Engine default SA):

```powershell
$pn = gcloud projects describe beastmode-pm --format="value(projectNumber)"
$sa = "$pn-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding beastmode-pm --member="serviceAccount:$sa" --role=roles/run.admin
gcloud projects add-iam-policy-binding beastmode-pm --member="serviceAccount:$sa" --role=roles/artifactregistry.writer
gcloud secrets add-iam-policy-binding bm-orders-database-direct-url --member="serviceAccount:$sa" --role=roles/secretmanager.secretAccessor --project beastmode-pm
# let the build deploy AS the runtime service account
$runtime = gcloud run services describe bm-orders --region asia-southeast1 --project beastmode-pm --format="value(spec.template.spec.serviceAccountName)"
if (-not $runtime) { $runtime = "$pn-compute@developer.gserviceaccount.com" }
gcloud iam service-accounts add-iam-policy-binding $runtime --member="serviceAccount:$sa" --role=roles/iam.serviceAccountUser --project beastmode-pm
```

## 3. The trigger

```powershell
gcloud builds triggers create github `
  --name=deploy-bm-orders-on-push `
  --repo-owner=XavaDigital --repo-name=bm-order-confirmation `
  --branch-pattern='^main$' `
  --build-config=cloudbuild.yaml `
  --project=beastmode-pm
```

If this errors with "repository not connected", finish the connection in the
Console first: Cloud Build → Repositories → Connect (the GitHub App install is
the half already done), then re-run.

## 4. Verify, then retire the old path

- Push any commit to main; watch `gcloud builds list --project beastmode-pm --limit 3`.
- Confirm the new revision serves AND the orders pages load (the 0027 lesson:
  `/login` 200 is not proof).
- Then treat `npm run deploy` as the break-glass fallback only, and update
  CLAUDE.md's deploy notes to say pushes to main deploy automatically.
