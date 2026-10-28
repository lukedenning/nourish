# Nourish
A responsive calorie, protein and weight journal with private, account-based cloud storage in Supabase. GitHub Pages serves the app; entries are stored in the database, not the repository or browser localStorage.

## Use the app
1. Open the hosted app and use **Sign in with password** with your email and password. This does not send an email.
2. If you do not have a password, use a device where you are already signed in, open **Set a password for other devices**, and save a unique password of at least 12 characters. You can also use **Sign in using an email link** for initial access. The earlier copy-and-paste link fallback remains available.
3. Use the same email and password on your phone and computer. Both devices can stay signed in to the same journal. Signing out uses local scope and affects only that device.
4. Add foods, save regulars, and check in your weight. Wait for **Saved to cloud** before closing the app.

Internet access is required to load and save your journal. Authentication tokens are retained by the Supabase SDK to keep you signed in; journal contents are not cached in browser storage. Sign out on shared devices.

## Features
- Food title, portion, calories and grams of protein; edit and delete entries.
- Regular foods with one-tap addition of their usual portion. Edit the added entry for different portions and nutrition.
- Daily totals, Monday–Sunday weekly totals, calendar-month totals, and averages over days containing food entries.
- A daily weigh-in form below the calorie tracker, defaulting to lbs, with live kg conversion and editable weigh-ins for the selected date.
- A weight line graph with pounds on the left axis and kilograms on the right. Daily view shows the last 30 days; Weekly and Monthly follow the selected week or month. Only recorded weigh-ins are plotted, with a table of exact values and a single-point state until a second weigh-in is recorded. Weight change uses the first and last weigh-ins in the graph period.
- Calorie chart and exact daily nutrition/weight table. Daily view includes a trailing seven-day history.
- A compact top sync notification and **Sync now** button, with account settings near the bottom. All saved entries are stored privately in Supabase and automatically loaded on other signed-in devices; GitHub hosts only the app code. No import is needed for cloud entries.
- Cloud refresh every 15 seconds while visible, and on focus. Automatic refresh pauses when a form contains a draft. Manual refresh preserves form fields.
- Revision checks prevent a stale device from silently overwriting newer changes. On conflict, reload the latest cloud journal, retain form fields, and ask the user to review and retry. The attempted version can be exported.
- JSON backup export and validated import. Import explicitly replaces the journal for that account across all devices.
- Optional migration of the earlier local-only journal. Matching cloud weights take priority; cloud and local foods with different values are retained separately. Migration keeps the original local data untouched.

## Current backend
Project: `yojgvyecehzsvndvtzvv` (Nourish), region `eu-west-2` (London).
`supabase/schema.sql` has been applied to this project. Do not reapply it to the same database. It creates an ownership-protected journal table and an atomic compare-and-swap save function. The client uses only the public publishable key in `config.js`. Never add a secret or service-role key to frontend code or GitHub.

For a different backend, apply the schema to a fresh Supabase project, then replace the public URL and publishable key in `config.js`.

## Hosting and sign-in configuration
The repository is public and GitHub Pages is enabled with **GitHub Actions** as its build source. The deployment workflow runs on pushes to `main`.

App address: `https://lukedenning.github.io/nourish/` (available after a successful workflow deployment).

In Supabase **Authentication → URL Configuration**, set the Site URL to that exact deployed address and add the same address to Redirect URLs. This makes emailed sign-in links return directly to the app. The copy-and-paste sign-in link fallback is also available.

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

Deployment and the signed-out page have been verified. The October 2026 login update adds password sign-in, signed-in password setup, an email resend cooldown, and a clear email-quota error. Supabase logs confirmed `over_email_send_rate_limit`; no device-session restriction was involved. Account passwords are never stored by the app or sent to GitHub. Live testing with the owner’s password remains for the owner.

The security advisor currently reports that leaked-password protection is disabled; review that Supabase feature in the project’s auth settings. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
