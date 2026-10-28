# Nourish
A responsive calorie, protein and weight journal with private, account-based cloud storage in Supabase. GitHub Pages serves the app; entries are stored in the database, not the repository or browser localStorage.

## Use the app
1. Open the hosted app and request a sign-in link with your email.
2. Open the email link to sign in. Alternatively, copy the original sign-in link from the email into the app's "Already have a sign-in email?" box. This fallback also works when a redirect is not yet configured.
3. Use the same email on another device to access the same journal.
4. Add foods, save regulars, and check in your weight. Wait for **Saved to cloud** before closing the app.

Internet access is required to load and save your journal. Authentication tokens are retained by the Supabase SDK to keep you signed in; journal contents are not cached in browser storage. Sign out on shared devices.

## Features
- Food title, portion, calories and grams of protein; edit and delete entries.
- Regular foods with one-tap addition of their usual portion. Edit the added entry for different portions and nutrition.
- Daily totals, Monday–Sunday weekly totals, calendar-month totals, and averages over days containing food entries.
- Weight input in kg or lbs and display in both units. Period change uses the first and last recorded weights in the selected period.
- Calorie chart and exact daily nutrition/weight table. Daily view includes a trailing seven-day history.
- Cloud refresh every 15 seconds while visible, and on focus. Automatic refresh pauses when a form contains a draft. Manual refresh preserves form fields.
- Revision checks prevent a stale device from silently overwriting newer changes. On conflict, reload the latest cloud journal, retain form fields, and ask the user to review and retry. The attempted version can be exported.
- JSON backup export and validated import. Import explicitly replaces the journal for that account across all devices.
- Optional migration of the earlier local-only journal. Matching cloud weights take priority; cloud and local foods with different values are retained separately. Migration keeps the original local data untouched.

## Current backend
Project: `yojgvyecehzsvndvtzvv` (Nourish), region `eu-west-2` (London).
`supabase/schema.sql` has been applied to this project. Do not reapply it to the same database. It creates an ownership-protected journal table and an atomic compare-and-swap save function. The client uses only the public publishable key in `config.js`. Never add a secret or service-role key to frontend code or GitHub.

For a different backend, apply the schema to a fresh Supabase project, then replace the public URL and publishable key in `config.js`.

## Finish GitHub Pages hosting
1. In this repository's **Settings → Pages**, choose **GitHub Actions** as the build source.
2. Run **Deploy Nourish to GitHub Pages** from **Actions**, or push a commit after enabling Pages.
3. Open the deployment URL reported by the workflow. With the current repository name, the expected address is `https://lukedenning.github.io/nourish/`, but it is only live after a successful deployment.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to that exact deployed address and add the same address to Redirect URLs. This makes emailed sign-in links return directly to the app.

GitHub Pages on a private repository requires a GitHub plan that supports private-repository Pages. On GitHub Free, Pages requires a public repository. Changing repository visibility is a separate owner choice. Public app hosting does not make your journal public: database access still requires sign-in and ownership checks.

Supabase's default email service has delivery restrictions and rate limits. It is intended for development and permits email to organisation members; for other users, configure a custom SMTP provider in the project's authentication settings. The app displays email delivery errors rather than pretending a link was sent.

## Develop and verify
No npm install or build dependencies are required. The Supabase browser SDK is vendored at the exact version **2.118.0**.

```
node --check app.js
node --check cloud.js
node test.cjs
node scripts/build.cjs
python3 -m http.server 8000 --directory dist
```

Tests simulate multiple devices and accounts, nutrition calculations, favourites, edits, weight conversion, date boundaries, cloud loading, offline save failure, conflict handling, migration, and signed-out writes. `supabase/test-isolation.sql` verifies live database ownership policies and compare-and-swap behavior using temporary fixture accounts in a rolled-back transaction. It does not create persistent test users.

The database security advisor returned no findings after setup. Visual browser QA and a real email sign-in on the deployed app remain to be completed.
