# Temple Services project guidance

Read `PROJECT_MEMORY.md` for the complete November 1, 2026 session record, deployed behavior, migration history, verification limits, and follow-ups. Read live D1 records for current people and assignments; do not reseed them from a historical roster.

- Repository: https://github.com/manojkumarparmar/templeservices
- Production website: https://templeservices.pages.dev/
- Hosting: Cloudflare Pages project `templeservices`, production branch `main`. Pushes to main trigger deployment. Preserve this hosting arrangement; do not create a replacement Sites project.
- D1 database: `templeservices-db`, binding `DB`, ID `b7b70a10-5530-44f4-a02b-a7176d940102`. Stores volunteer records, authentication, laundry updates, and backup requests.
- R2 object storage: `templeservices-photos`, binding `PHOTOS`. Stores photos; preserve private bucket access.
- Phone sign-in uses Firebase Authentication, US numbers only. Preserve Cloudflare hosting and storage. Firebase requires billing, Phone enabled, the production authorized domain, a US-only SMS region policy and `FIREBASE_WEB_CONFIG` in Pages settings. See README setup steps. Never infer US eligibility from +1 alone. Do not enable test bypasses in production.
- Migrations 0003 (volunteer names) and 0004 (private phone field) were applied directly to production D1 on November 1, 2026. Krithika was also renamed Krithika Mtj directly in production. Do not reapply schema migration 0004.
- Firebase project `temple-services-513414` (number `197416540652`) is managed using `apexsteeldesigns@gmail.com`. Web app ID: `1:197416540652:web:b4ca3b782934a84d10c8c9`. Authentication Phone provider, US-only SMS policy, production authorized domain, and Blaze plan were confirmed on November 1, 2026. Blaze was activated via a Google Cloud free trial shown as expiring January 31, 2027; billing may require owner attention then. Phone numbers were subsequently added through the website; real SMS delivery/sign-in has not been confirmed in this chat. Public web configuration is in `wrangler.toml`.
- Configuration lives in `wrangler.toml`; read `README.md` for deployment and authentication details. Never store credentials in project guidance or source.
- Build: `node scripts/build.mjs`. Tests require Node.js 24+: `node --test tests/*.test.mjs`.
- Existing migrations 0001 and 0002 were applied in production. Use new forward migrations for database changes; do not reapply the seed migration to the live database.
- Volunteer directory should use wide row cards with filters and sort options above the list.
- Notes: one non-deleted entry per volunteer/date/shift, with author-only edit and delete. Other volunteers may add separate entries. Enforce ownership and optimistic versions on the server, preserve retained photos, and reject foreign photo references. Migration 0005 was applied to production D1 on November 1, 2026; do not reapply. Deletion hides records/photos without permanent removal and permits a replacement entry.
- The Schedule tab shows a compact Monday–Sunday recurring schedule below Permanent backups. Admins, super-admins and coordinators can edit the whole week with one shared edit/save flow, using only existing active volunteers. The recurring endpoint may update assignments only, never contact details or roles, and must save atomically with conflict checks.
- Hide all shift actions when signed out. Notes actions are for yesterday/today only. Backup requests are for today/future only and require current shift assignment (including the confirmed replacement), coordinator, admin, or super-admin; enforce this on the server. Pending backup offers remain available to signed-in active volunteers.
- Per the user, only Nanda Kumar Das and Ajinkya are male among the original volunteers. Women's names end in `Mtj`; Ajinkya's display name is `Ajinkya Pr`; Nanda Kumar Das remains unchanged. `Vaidehi Mtj` was added and later made an admin through the website. Preserve subsequent live user edits.


- Historical assignments are versioned in schedule_versions via migration 0006 (already applied in production). Recurring/profile changes affect today/future only; resolve past assignments from dated versions, never current volunteer records. History requires sign-in and is read only. See PROJECT_MEMORY.md for pre-version unknown dates and retention behavior.

- Volunteer contacts (November 3, 2026): the existing Volunteers tab displays phone/email and call, SMS and email links to every signed-in active volunteer. Anonymous, expired and inactive sessions receive no contact fields. Profile editing remains administrator-only. This supersedes historical admin-only contact visibility in PROJECT_MEMORY.md. No opt-in or privacy toggles.

- Contact links also appear beside names in current/upcoming shifts, backup coverage, Permanent backups, recurring assignments (including editor choices), and current shift note authors. Never show contacts for dated schedules/notes before today or anywhere in History. Match IDs where available; omit ambiguous name matches.

- All contact actions use icon-only call and SMS links with accessible names and tooltips, rather than displaying phone numbers or an SMS text label. Email links retain their address text. Phone numbers remain editable in administrator forms.
