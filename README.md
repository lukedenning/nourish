# Nourish
A responsive calorie, protein and weight journal with private, account-based cloud storage in Supabase. GitHub Pages serves the app; entries are stored privately in the database and an account-specific offline copy on each device, never in the public repository.

## Use the app
1. Open the hosted app and use **Sign in with password** with your email and password. This does not send an email.
2. If you do not have a password, use a device where you are already signed in, open **Set a password for other devices**, and save a unique password of at least 12 characters. You can also use **Sign in using an email link** for initial access. The earlier copy-and-paste link fallback remains available.
3. Use the same email and password on your phone and computer. Both devices can stay signed in to the same journal. Signing out uses local scope and affects only that device.
4. Add foods, save regulars, and check in your weight. Wait for **Saved to cloud** before closing the app.

Open and sign in online once per device. The service worker caches only the static app, while account-specific localStorage holds the last cloud baseline and locally saved journal. Offline saves are durable before success is shown; reconnecting while the app is open (or reopening online) automatically merges and syncs pending changes with compare-and-swap retries. Edits to the same food, regular, weigh-in date or note on both devices require conflict review; the local draft remains intact until resolved. Storage errors never report a successful local save. Signing out clears the active-account marker, while retaining its offline journal for the next sign-in. Browser storage can be cleared or evicted; export backups for an additional copy. Authentication tokens remain managed by the Supabase SDK.

## Features
- **Daily notes** with a 5,000-character text area and Save notes button for each selected date. Notes sync privately with the account, are included in backups, and preserve unsaved drafts during refresh. Switching dates asks before discarding a note draft. Older journals without notes remain compatible.
- A dark purple night-mode theme with bright orange highlights and unchanged white text throughout the tracker, forms, graphs, and account panel.
- Food title, portion, calories and optional grams of protein (blank saves as 0 g); edit and delete entries.
- Regular foods with one-tap addition of their usual portion. Both sidebar food panels keep a fixed height and scroll internally as their lists grow. Edit the added entry for different portions and nutrition.
- Daily totals, Monday–Sunday weekly totals, calendar-month totals, and averages over days containing food entries.
- A daily weigh-in form below the calorie tracker, defaulting to lbs, with live kg conversion and editable weigh-ins for the selected date.
- A weight line graph with pounds on the left axis and kilograms on the right. Daily view shows the last 30 days; Weekly and Monthly follow the selected week or month. Only recorded weigh-ins are plotted, with a table of exact values and a single-point state until a second weigh-in is recorded. Weight change uses the first and last weigh-ins in the graph period.
- Calorie chart and exact daily nutrition/weight table. Daily view includes a trailing seven-day history.
- A compact header **Synced / Sync now** button, with account settings near the bottom. All saved entries are stored privately in Supabase and automatically loaded on other signed-in devices; GitHub hosts only the app code. No import is needed for cloud entries.
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

`node test-offline.cjs` verifies offline durability across restarts, reconnection merges, deletions, conflicting edits, CAS races, multiple tabs, storage quota errors and account isolation. The main suite also tests local midnight rollover, manual date selection and an unavailable clock.

Tests simulate multiple devices and accounts, nutrition calculations, favourites, edits, weight conversion, date boundaries, cloud loading, offline save failure, conflict handling, migration, and signed-out writes. `supabase/test-isolation.sql` verifies live database ownership policies and compare-and-swap behavior using temporary fixture accounts in a rolled-back transaction. It does not create persistent test users.

Deployment and the signed-out page have been verified. The October 2026 login update adds password sign-in, signed-in password setup, an email resend cooldown, and a clear email-quota error. Supabase logs confirmed `over_email_send_rate_limit`; no device-session restriction was involved. Account passwords are never stored by the app or sent to GitHub. Live testing with the owner’s password remains for the owner.

The security advisor currently reports that leaked-password protection is disabled; review that Supabase feature in the project’s auth settings. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

The journal follows the device clock and local time zone while viewing today, checks every 30 seconds and on focus/visibility, and leaves unfinished drafts on their original date. Selecting a historical/future date pauses automatic following; Return to today resumes it. If the clock cannot be read, date selection remains manual. Offline auto-sync runs while the app is open or when reopened online, not while the browser is closed.

Weight over time supports an independent From/To range, optional calories and all nutrition series, and PNG download. One nutrition series uses its physical units on the right axis; multiple series each use their own observed 0–100% range (constant series sit at 50%) so low values remain visible. Weight stays on the left lbs axis. Legends include observed ranges; the exact-value table preserves original units. Exports include the applied dates, legend, colours and scale explanation.
