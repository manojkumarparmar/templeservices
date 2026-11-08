# Temple Laundry Schedule

Documentation: [docs/workflows.md](docs/workflows.md) describes every workflow, role and rule; [docs/backup-workflow.md](docs/backup-workflow.md) specifies the backup workflow. AI tools should also read `AGENTS.md`.

A one-page, mobile-friendly website for the Sri Radha Kalachandji Temple laundry volunteers.
Everyone can see who is on each morning and evening shift for yesterday, today, and the next six days, with
today highlighted, the permanent backups, and any planned absences. The page also has a
service instructions section and load checklists, notes, and photos within each scheduled shift.

A sticky tab bar keeps Schedule and Instructions available while scrolling. Schedule opens by
default and shows the eight-day schedule and backups. Each shift contains load updates, notes, and photos. Service instructions have
their own tab.

The page is `index.html`. A small build copies it into `dist`; Pages Functions handle the
shared API. Server files, tests, and database migrations are excluded from static hosting.

## Updating the schedule

The Schedule tab includes a compact recurring Monday–Sunday table below Permanent
backups. Admins, super-admins and coordinators have one **Edit recurring schedule**
button for the full week. Each shift offers existing active volunteers, including
multiple selections or no assignment. **Save recurring schedule** saves the entire
week to D1 and returns to the read-only table, updating the rolling schedule and
volunteer directory. **Cancel** discards edits. Concurrent changes are rejected
without partially saving the week. Coordinators gain assignment editing only.
Contact information is visible to all signed-in active volunteers and hidden from signed-out visitors. Volunteer role management remains admin-only.

Open `index.html` and edit the block marked `EDIT THIS SECTION TO UPDATE THE SCHEDULE`:

- `BACKUPS`: names of the permanent backups (currently placeholders).
- `WEEKLY_PLAN`: the recurring plan, Monday first. An empty list means the shift needs a volunteer
  (Friday evening is open at the moment).
- `ABSENCES`: planned absences. Add one line per absence with `person`, `from`, `to`
  (dates as `YYYY-MM-DD`), and optionally `shifts` (`am`, `pm` or `both`), `cover` and `note`.
  The page shows the person as away and who is covering, or "Needs cover" if nobody is.

- `INSTRUCTIONS`: the service instructions, one entry per topic. `body` is a list of short
  paragraphs; leave it empty to show "Instructions coming soon."

The page shows a rolling eight-day schedule starting yesterday, based on the current date.
Each date uses the recurring weekly plan, so the schedule updates on its own.

## Load updates and notes

Each volunteer has one notes entry per service date and shift. After saving, their
**Add Notes** action becomes **Edit Notes**, prefilled with their checklist, notes,
and attached photos. Only the author can save edits or use **Delete Notes** in that
editor; admins cannot edit someone else's entry. Other volunteers can add their own
separate entry to the same shift. Deleting hides the entry and its photos from the
website and allows the author to add a new entry. Deleted records are retained in
D1; no permanent retention cleanup is enabled. Concurrent edits are checked by
version and rejected without replacing newer notes. Adding and editing remain
available for yesterday and today.

Migration `0005_editable_notes.sql` was applied to production on November 1, 2026.
Do not reapply it. It adds note versions, edit/deletion timestamps and a unique
index for one non-deleted entry per volunteer/date/shift. Existing notes are kept.

Yesterday and today have an **Add Notes** button beside each shift. Future shifts do not. The form tracks Kitchen, Pujari,
and Deity loads with independent Washed, Dried, and Folded checkboxes, optional notes, and
multiple photos. Check only the tasks completed in this update; unchecked means not reported.
A checklist-only, notes-only, or photos-only update can be submitted. Saved updates appear
inside the shift with the volunteer name, time, load checklist summary, notes, and photos.

Updates are saved in Cloudflare D1 and shared with every visitor. Photos are resized to
800 pixels and saved in a private R2 bucket, served through the website API. Each update
accepts up to four photos, at most 1 MB each. If saving fails, the form keeps the draft and
attachments. The schedule refreshes every 30 seconds and when returning to the page; open
forms keep their drafts. Service dates use America/Chicago. Experimental device-only data
is ignored. Only the remembered volunteer name remains in browser storage.

## Backup requests

Full workflow design (states, permissions, storage, display): [docs/backup-workflow.md](docs/backup-workflow.md).

Shift action buttons are hidden until sign-in. Add/Edit Notes is available only
for yesterday and today. Backup actions are available for today and the next six days.
The server enforces every permission below.

A shift's **primaries** are its recurring assignees; they always stay on the card.
Each shift also has one **Backup** slot that is either empty, needed, or assigned.
Only the current state is kept (no backup history).

- **Need backup** (a primary on the shift, coordinator, admin, super-admin): all primaries are
  marked unavailable and the Backup slot shows Needed. An optional note can be added.
- **Offer to cover** (any signed-in volunteer who is not a primary on that shift) or **Assign**
  (coordinator or admin picks a volunteer): the Backup slot shows that name (the card turns green).
- **Need backup** again (the current backup, coordinator or admin): the slot returns to Needed.
- **Cancel need for backup** (primaries, coordinators, admins): needed becomes no request.
- **Release backup** (primaries, coordinators, admins): assigned becomes no request and the
  primaries are active again.

Past shifts show a backup only when one was assigned (primaries struck through); otherwise
only the primaries. Requests and offers are shared with everyone. Conditional version
checks prevent two people from claiming the same slot. Older stored records are read as
the current state, so no database migration is needed.

## Shared storage and publishing

Cloudflare Pages project: `templeservices` (production branch `main`).

- Build command: `node scripts/build.mjs`
- Build output: `dist`
- D1 binding `DB`: `templeservices-db`
- R2 binding `PHOTOS`: `templeservices-photos` (Standard, public bucket access disabled)
- Database schema: `migrations/0001_shared_storage.sql`
- Bindings are defined in `wrangler.toml` and applied on deployment.

The database and its tables were created in the Cloudflare dashboard. For a fresh database,
apply the schema using the D1 console or `npx wrangler d1 migrations apply DB --remote`.
Every push to `main` redeploys the website and Pages Functions.

Run checks with Node.js 24 or later:

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
npx wrangler pages functions build functions --outdir .wrangler/verify
```

For local shared-storage development, build first, then run `npx wrangler pages dev dist`.
Apply the schema locally using `npx wrangler d1 migrations apply DB --local`.
Opening `index.html` directly previews the layout but cannot use the shared API.

## Volunteers and access

Use **Sign in** to sign in with an administrator account, then open the Volunteers tab.
**Add volunteer** opens a new-person form; **Edit volunteer**
on each row updates that person's name, sign-in email, roles, availability, and shifts.
Use **Save volunteer** to persist changes to D1, or **Cancel** to discard the form.

The directory uses full-width volunteer rows with search, role and service-day filters,
and name or recurring-shift sorting. Apply `migrations/0003_volunteer_names.sql` to the
existing production D1 database to add Vaidehi Mtj and update the requested display names.
This migration preserves IDs, emails, roles, and assignments. Do not reapply migration 0002.

The Volunteers tab lists active volunteers, recurring assignments, availability notes, and
multiple roles. Administrators also see sign-in emails and inactive records. Changes to
recurring assignments update the schedule; volunteers with the backup role populate the
Permanent backups section.

- Allowed roles: super-admin, admin, headpujari, coordinator, volunteer, backup, other.
- Only admin and super-admin can edit the directory.
- Admins can manage other admins and lower roles, but cannot edit the super-admin.
- Admins cannot remove their own admin role, deactivate themselves, or remove themselves.
- Super-admin can edit all records including their own details, but cannot remove their
  account, deactivate themselves, or drop the super-admin role.
- The super-admin role cannot be assigned to another record through the website. Database
  triggers also protect the super-admin status and prevent deletion.
- Removing a volunteer deactivates their record, preserving history. Admins can reactivate it.
- Public visitors can read the schedule and directory. Submissions require an approved,
  active volunteer account. Submitted notes record the authenticated user's name and ID.

The directory is seeded from the original recurring schedule, plus Nanda Kumar Das as the
protected super-admin. The production super-admin email is set directly in D1, not published
in source. Other volunteers need their email added by an administrator before signing in.

## Sign-in setup

### Firebase phone sign-in (US only)

Phone authentication uses Firebase only for SMS verification. D1 remains the source of
volunteer identity, roles and application sessions; R2 remains photo storage. Numbers
are visible to signed-in active volunteers. Enter a number on the person's volunteer form before
they sign in. Unlisted and inactive volunteers cannot obtain an application session.

Setup:

1. Add Firebase to the existing Google Cloud project `temple-services-513414`, if it
   is not already enabled, and register a web app. No Firebase Hosting is needed.
2. Enable billing (Blaze), then Authentication > Sign-in method > Phone.
3. Add `templeservices.pages.dev` to Authentication's authorized domains.
4. Set Authentication's SMS region policy to **Allow only United States**. Do not
   rely on the +1 prefix alone, which is shared by other countries.
5. Copy the web app's public configuration into Cloudflare Pages production variable
   `FIREBASE_WEB_CONFIG` as a JSON string containing `apiKey`, `authDomain`,
   `projectId`, and `appId`. Never put a service-account private key in this value.
6. For a fresh database, apply migrations in order. Migration `0004_phone_sign_in.sql`
   was applied to production D1 on November 1, 2026; do not reapply it there.
7. Redeploy Pages and add each approved person's US phone number through the admin
   volunteer form. Check first with a Firebase fictional test number, then a consenting
   volunteer's real mobile number. Monitor SMS usage and configure billing alerts.

Until valid configuration exists, SMS sign-in is hidden and Google/email continue.
Firebase uses reCAPTCHA, a resend cooldown and provider quotas; the server also limits
token exchange attempts, validates signed tokens and recent phone authentication,
and refuses inactive or unlisted numbers. Firebase tokens stay in memory; application
access uses the existing HttpOnly cookie. Changing a phone number revokes old local
sessions. Do not enable Firebase's testing bypass in production.

The sign-in code supports Google Identity Services directly and email codes using Resend's
free plan. D1 and R2 remain the data stores; no paid identity service or SMS is required.

Google client configuration is stored as a public value in `wrangler.toml`. The Google
Cloud project is `temple-services-513414`, app name Temple Services. Only the production
website origin is authorized. The client secret generated by Google is not used or stored
in this repository.

Configuration:

- `GOOGLE_CLIENT_ID` (public text in `wrangler.toml`): Google OAuth web client ID. Authorize the JavaScript origin
  `https://templeservices.pages.dev`. No Google client secret is needed for this flow.
- `RESEND_API_KEY` (secret in Pages settings): email-sending API key from a free Resend account.
- `EMAIL_FROM` (text in `wrangler.toml`): pending a separate Temple Services sender on a verified domain. Do not use Apex-branded addresses.

Only configured sign-in methods appear. When neither method is configured, the website
remains read-only and the sign-in dialog asks users to contact the coordinator. Setting up
a Google Cloud OAuth client and verifying an email-sending domain requires the owner's
accounts. Keep the Resend account on its free plan; it has sending limits shared across
applications. Use a dedicated sending-only key restricted to the approved sender domain,
saved as a Cloudflare secret rather than in source. The owner requires volunteer-facing
communications to have no Apex branding. The existing Google consent support email must
also be changed from the Apex account before this requirement is fully satisfied.

Sessions use random server-stored tokens, hashed in D1, in Secure/HttpOnly/SameSite cookies.
Google tokens are checked for signature, audience, issuer, expiration, verified email, and
nonce. Email codes are hashed, expire in ten minutes, allow five attempts, and can be used
once. Sending codes is limited per address and IP. A verified Google account and an email
code for the same directory email resolve to the same volunteer record.

Apply `0002_volunteers_auth.sql` once on an existing database after `0001`. This migration
was applied in production through the D1 console. Do not reapply it to an initialized DB.

Retention cleanup remains deferred. No automatic deletion has been enabled.


## Historical shifts (November 1, 2026)

- Signed-in active volunteers have View past shifts on Schedule, with Monday–Sunday browsing, a date picker, and a read-only view of notes/checklists/photos and backup history. Signing out clears history. Older schedule/photo API reads require sign-in; normal yesterday/today/upcoming schedule remains public.
- Recurring changes apply to today/future only. D1 schedule_versions captures names, IDs and recurring assignments on volunteer insertion, assignment/name/active changes or deletion. Triggers save each complete plan in the same transaction as the change. This works across days without visits or scheduled jobs. Date lookups use the latest version before the end of the service date in America/Chicago, including DST. Today/future use the current plan.
- Existing dates before the first version have unknown original assignments, explicitly labeled; do not backfill guessed historical names from today's roster. Existing notes and backup records are preserved.
- History is read only. Yesterday remains editable through the normal schedule; older note save/delete requests are rejected. No historical corrections endpoint was added. Retention/automatic deletion remains disabled.
- Migration 0006_schedule_history.sql was applied directly to production D1 on November 1, 2026. Do not reapply it or prior seed migrations. It seeds only the first plan version from the live roster; it never reseeds volunteers.
- Verification: 40 tests pass, including week navigation/sign-out clearing, recurring changes and deactivation preserving previous dates, unknown assignments, access restrictions, and Chicago DST boundaries. Static build and Cloudflare function compilation passed. Local browser preview was unreachable from the embedded browser; signed-in History visual verification remains unconfirmed.
- Migration 0007_planned_shifts.sql (dated primary plans, table planned_shifts) was applied directly to production D1 on November 8, 2026. Do not reapply it. It only adds an empty table; no existing data was changed.
