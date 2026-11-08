# Temple Services project guidance

Read `PROJECT_MEMORY.md` for the complete November 1, 2026 session record, deployed behavior, migration history, verification limits, and follow-ups. Read live D1 records for current people and assignments; do not reseed them from a historical roster.

## Start here (read before changing anything)

This site runs a temple laundry seva: volunteers, recurring shifts, notes, backup cover. The
rules and logic are written down; do not infer them from the UI alone.

1. `docs/workflows.md` is the map of every workflow: roles and permissions, sign-in, schedule view,
   notes and photos, recurring schedule, volunteer directory, past shifts, contacts, data model,
   hosting and testing, plus a checklist for changing a workflow.
2. `docs/backup-workflow.md` is the full specification of the backup (Need backup) workflow: states,
   actions, who may do each, storage, API and card display.
3. `PROJECT_MEMORY.md` is the dated session history (what was done, why, live-data facts, and
   verification limits). `README.md` covers setup and deployment.

Working rules for any AI tool or developer:

- The server is the source of truth for permissions (`server/api.mjs`, `server/volunteers.mjs`).
  Never rely on hidden buttons. Change the server first, then the page, then tests.
- When behavior changes, update `docs/workflows.md` (and `docs/backup-workflow.md` for backup), the
  tests, and this file in the same change. If code and docs disagree, tell the owner rather than
  silently picking one.
- Live D1 data is authoritative and is edited through the website. Never reseed volunteers, never
  reapply migrations 0001 to 0007, and add a new forward migration for any schema change.
- Service dates use America/Chicago. Shifts are `am`/`pm`; weekdays are Monday 0 to Sunday 6.
- Run `node --test tests/*.test.mjs` and `node scripts/build.mjs` before pushing. Pushing to `main`
  deploys to production, so state accurately whether work is local, pushed, or deployed, and do not
  push to `main` without the owner's go-ahead unless they have asked you to.
- Keep interface copy short. Do not reintroduce explanatory filler the owner removed.
- Never store credentials, tokens, OTPs or private keys in files, logs or chat output.

## Project facts

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
- Dated primaries (`planned_shifts`, migration 0007) override the weekly plan for one shift and date (replace the whole list; managers only; today to 90 days ahead; blocked while a backup request is open). Use `isPrimaryOn` for any "is this person a primary" check, never `isPrimary` alone. See section 8 of `docs/workflows.md`. Migration 0007 was applied to production D1 on November 8, 2026; never reapply it.
- The backup workflow is documented in full in `docs/backup-workflow.md`; keep it in step with code and tests when behavior changes.
- Hide all shift actions when signed out. Notes actions are for yesterday/today only. Backup actions are for today and the next six days only and are enforced on the server. Primary = the shift's recurring assignees, always shown on the card. A backup request (Need backup) marks all primaries unavailable; the Backup slot is none, needed or assigned, and only the current state is stored in `shift_backups.state_json` (`status` none/needed/assigned, `requestedBy`, `notes`, `backup`; no history; older person/cover/history rows are mapped on read). Actions: `request` (a primary, coordinator, admin), `offer` (any signed-in volunteer, not a primary of that shift), `assign` (coordinator/admin picks a volunteer), `reopen` (labelled Need backup: the current backup, coordinator, admin; slot returns to needed), `cancel` (Cancel need for backup: needed to none; primaries, coordinators, admins), `release` (Release backup: assigned to none, primaries are active again; primaries, coordinators, admins). Past shifts show a backup only when one was assigned, with the primaries marked unavailable; otherwise primaries only.
- Per the user, only Nanda Kumar Das and Ajinkya are male among the original volunteers. Women's names end in `Mtj`; Ajinkya's display name is `Ajinkya Pr`; Nanda Kumar Das remains unchanged. `Vaidehi Mtj` was added and later made an admin through the website. Preserve subsequent live user edits.


- Historical assignments are versioned in schedule_versions via migration 0006 (already applied in production). Recurring/profile changes affect today/future only; resolve past assignments from dated versions, never current volunteer records. History requires sign-in and is read only. See PROJECT_MEMORY.md for pre-version unknown dates and retention behavior.

- Volunteer contacts (November 3, 2026): the existing Volunteers tab displays phone/email and call, SMS and email links to every signed-in active volunteer. Anonymous, expired and inactive sessions receive no contact fields. Profile editing remains administrator-only. This supersedes historical admin-only contact visibility in PROJECT_MEMORY.md. No opt-in or privacy toggles.

- Contact links also appear beside names in current/upcoming shifts, backup coverage, Permanent backups, recurring assignments (including editor choices), and current shift note authors. Never show contacts for dated schedules/notes before today or anywhere in History. Match IDs where available; omit ambiguous name matches.

- Phone contacts use one accessible contact icon on the same row as the volunteer name. It opens a floating Call, SMS and WhatsApp menu without adding row height. WhatsApp uses wa.me with international digits and does not verify account availability. Menus dismiss on outside click, Escape, focus leaving, scrolling and sign-out. Directory profiles retain their full phone number; email links retain their address text. Phone numbers remain editable in administrator forms. Keep current sign-in and historical-date restrictions.

- Sign-in offers Continue with Google alongside registered US mobile phone login. Google uses the existing OAuth client, nonce verification and server-side active volunteer email/linked-identity checks; it never creates an unapproved volunteer.
