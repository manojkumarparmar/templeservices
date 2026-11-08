# Temple Services — persistent project memory

Session date: November 1, 2026, America/Chicago. This records work actually performed and user preferences. Historical roster information is not a seed or an instruction to overwrite live records.

## Repository and production

- GitHub: https://github.com/manojkumarparmar/templeservices
- Website: https://templeservices.pages.dev/
- Checkout for this chat: `C:/Users/mparm/Documents/Codex/2026-11-01/on-the-website-for-the-volunteer/work`.
- Cloudflare Pages project `templeservices`; pushing `main` automatically deploys. Continue using Cloudflare, not a replacement Sites/Firebase Hosting project.
- `wrangler.toml` declares Pages output `dist`, D1 binding `DB` (`templeservices-db`, ID `b7b70a10-5530-44f4-a02b-a7176d940102`), and private R2 binding `PHOTOS` (`templeservices-photos`). D1 stores people, assignments, authentication, notes, and backups. R2 stores photos, served through application endpoints.
- Cloudflare account used by the owner: `apexsteeldesigns@gmail.com`; GitHub is associated with `mparmar.ufl@gmail.com`. These are separate from volunteer permissions.
- Build `node scripts/build.mjs`; tests `node --test tests/*.test.mjs` require Node 24+. Cloudflare server check: `npx --offline wrangler pages functions build functions --outdir .wrangler/verify` when Wrangler is cached.

## Volunteer directory and presentation

- Wide, full-width row cards replace the prior card grid; name/roles, recurring service, and availability are arranged across the row on larger screens.
- Controls above the list: search by name/availability; role filter; service-day filter; sorting by name A–Z/Z–A or most recurring shifts; matching count and no-results state.
- Existing admin/super-admin permissions remain for adding/editing volunteer profiles, private emails/phone numbers, roles, availability, active status and assignments. Super-admin protection and self-demotion restrictions remain.
- Add volunteer and Edit volunteer are visible to authorized signed-in administrators. One normal Sign in button is retained; the extra “Sign in to manage volunteers” button was removed at the user's request.
- Removed introductory/help text: “View the schedule without signing in.”, “Sign in with an administrator account to add people or edit volunteer details.”, “Recurring service assignments, availability, and roles.”, and the long “Use Add volunteer…” instruction.
- Do not display empty-state filler “No availability notes added.” or “No recurring shifts assigned.” Empty availability/service headings are omitted; meaningful notes and assignments still display.
- Instructions tab has a prominent warning-colored “Work in progress” banner: the page is still being prepared and users should check with the coordinator for current service guidance.

## Names and last observed roster

- User specified only Nanda Kumar Das and Ajinkya were male in the original roster. Women use the `Mtj` suffix. Ajinkya was renamed `Ajinkya Pr`; Nanda Kumar Das was unchanged.
- Added Vaidehi Mtj with no invented contact information or assignments. User subsequently added her phone and assigned admin, coordinator, volunteer and backup roles through the website. Do not promote her again or require an email if configured phone sign-in supplies her login method.
- Krithika existed in live D1 beyond the original seed and was renamed Krithika Mtj directly.
- Last live directory read in this chat showed 18 active people: Ajinkya Pr, Divya Rupini Mtj, Hema Mtj, Hema Sirasha Mtj, Kalyani Mtj, Krithika Mtj, Manjuali Mtj, Nanda Kumar Das, Padma Sakhi Mtj, Renuka Mtj, Roopal Mtj, Sangeeta Patel Mtj, Shiromani Radha Mtj, Sreeja Mtj, Sulakshna Mtj, Swetha Mtj, Vaidehi Mtj and Vishaka Mtj.
- At that read, Manjuali had admin/headpujari/coordinator roles, Nanda had super-admin/coordinator roles, and Vaidehi had admin/coordinator/volunteer/backup roles; the others had volunteer roles. Eleven people had phone numbers, seven had none. No availability notes were entered. Contacts are deliberately not copied into memory; read D1 when explicitly needed.
- The user edits people and assignments through the live website. D1 is authoritative. In particular, Shiromani Radha is the current Tuesday evening name and Krithika is Friday evening; do not replace them from the older static fallback.

## Recurring weekly schedule

- Schedule tab ends with a compact recurring week below Permanent backups. Monday–Sunday, Morning and Evening columns, just names or Unassigned; no per-day/per-shift action buttons in view mode.
- One Edit recurring schedule button for signed-in admin/super-admin/coordinator roles. Each shift has a multi-person checkbox picker populated only from existing active volunteers. Empty assignments and multiple volunteers are allowed.
- One Save recurring schedule button commits the whole week and returns to view mode; Cancel discards the draft. Saving updates D1 assignments, the rolling schedule and directory.
- `/api/recurring/save` only updates assignments, not contacts or roles. The whole week is saved atomically in one guarded statement; version/roster conflicts reject all changes rather than partially saving. Coordinators do not gain profile editing or private contact visibility.
- Implementation: `recurring.js`, `server/volunteers.mjs`, Schedule markup/styles in `index.html`.

## Notes: one entry, author-only editing and deletion

- Each person may have one non-deleted entry per service date/shift; other people can add independent entries for the same day/shift.
- Add Notes becomes Edit Notes after that user saves. The editor preloads checklist, text and photos. It offers Save Notes, Cancel and Delete Notes. Users, including administrators, cannot edit/delete someone else's entry; server checks use volunteer IDs rather than display names.
- While editing, hide the saved preview of that same entry; show it again after save/cancel. Keep other people's entries visible. Background refresh must preserve the editing draft and keep the duplicate preview hidden.
- Optimistic versions prevent lost edits; an operation ID makes save retries idempotent. Retained photos must belong to the entry. New photos use unique R2 keys; failed saves clean up uploads; removed attachments are cleaned up.
- Delete is a soft delete in D1. Deleted entries disappear from schedules and their photos are no longer served by the application; author can add a new entry afterward. No permanent retention cleanup is enabled.
- On the user's explicit request, the experimental Sunday November 1, 2026 morning entry `01ff5bc9-3fda-49d9-9f50-d18530b6439c` was soft-deleted directly in D1. Verified zero remaining visible notes on that specific shift. Sunday evening was not cleared.
- Implementation: `server/api.mjs` and `index.html`; APIs `/api/updates` and `/api/updates/delete`.

## Shift action permissions

- Signed-out visitors can view the schedule but see no shift action buttons. The normal Sign in button remains.
- Signed-in active volunteers can Add/Edit Notes only on yesterday/today shifts; no notes action on future shifts.
- Superseded Nov 8, 2026 (branch `backup-primary-backup-slots`): backup is now a primary/backup slot model. Primaries (recurring assignees) always stay on the card; Need backup (a primary, coordinator or admin) marks all primaries unavailable and opens a Backup slot ("Needed"). Any signed-in volunteer can Offer to cover (not a primary of that shift); coordinators/admins can Assign a chosen volunteer. The current backup (or a coordinator/admin) can tap Need backup to reopen the slot. Cancel need for backup (needed to none) and Release backup (assigned to none; primaries active again) are for primaries, coordinators and admins. No backup history is kept; only current status, requester, note and backup. Version checks stay. Old person/cover/history rows are mapped on read, no migration. Past shifts show a backup only if one was assigned (primaries struck through), otherwise primaries only.
- Card copy (user request, Nov 8): no "Unavailable" chip and no "Backup confirmed" or "Backup needed" banner (the card colour and the Backup line say it); shift cards show contact icons but not the email address.
- The UI test fake DOM gained a classList stub and the button lookup matches icon buttons by title/aria-label; 17 UI tests had been failing since the Nov 3 icon change.
- Recurring editor and volunteer profile actions keep their separate role restrictions.

## Authentication and Firebase

- Google sign-in remains. Email codes remain conditional on Resend configuration. Phone login was added using Firebase Authentication, while website/D1/R2 remain Cloudflare services.
- Firebase/GCP project `temple-services-513414`, project number `197416540652`; verified account `apexsteeldesigns@gmail.com`. Web app `Temple Services`, ID `1:197416540652:web:b4ca3b782934a84d10c8c9`.
- Initial CLI permission failures were followed by the user accepting Firebase terms in the console and enabling Firebase on the existing GCP project. Do not create another project because the earlier project list was empty.
- User enabled Phone provider and activated Blaze. Verified console showed Blaze via Google Cloud Free Trial, $300 remaining at that moment, expiring January 31, 2027. This was not a confirmed permanent paid-billing upgrade; owner may need to address billing when the trial ends. Do not change billing without the owner.
- Saved SMS region policy: Allow United States only. Authorized domain: `templeservices.pages.dev`. Do not treat +1 alone as US verification because the prefix is shared.
- Public Firebase web configuration is stored as `FIREBASE_WEB_CONFIG` in tracked `wrangler.toml`; this is a browser API configuration, not a service-account key. Do not store tokens, refresh tokens, OTPs or private keys in files, logs, guidance or chat output.
- `phone-auth.js` lazy-loads Firebase Auth, uses reCAPTCHA, memory-only Firebase persistence and a resend cooldown. Server verifies signature/project/issuer/expiry/recent phone authentication and matches an active D1 volunteer's registered number, then creates the existing HttpOnly application session. Numbers are administrator-only in the directory. Changing a phone number revokes application sessions.
- Privacy information and SMS consent text were updated. Keep Temple Services branding; avoid volunteer-facing Apex branding.
- Live `/api/auth/config` was verified with Firebase enabled; live sign-in dialog was verified showing US mobile number and Send text code. User added phone numbers through volunteer forms. Actual real-phone SMS delivery and completed phone authentication were not confirmed in this chat. This is the outstanding verification item, not a missing-code/configuration task.
- CLI workaround for a missing `rc` dependency: `npx --yes --package=rc --package=firebase-tools@latest firebase ... --account apexsteeldesigns@gmail.com`. Never print raw `firebase login:list --json` output: it can include tokens; filter results to the exact safe fields before emitting output.

## Production database migrations

All migrations below were already applied to production. Use new forward migrations, never reapply these to initialized D1:

| Migration | Purpose |
| --- | --- |
| 0001_shared_storage.sql | Laundry notes, photos and backup records |
| 0002_volunteers_auth.sql | Volunteers, assignments, roles and authentication; original seed |
| 0003_volunteer_names.sql | Mtj suffixes, Ajinkya Pr and Vaidehi Mtj |
| 0004_phone_sign_in.sql | Private, unique volunteer phone field |
| 0005_editable_notes.sql | Note version/edit operation/deletion fields and one-live-entry index |

0003–0005 were applied directly with targeted `wrangler d1 execute --remote --file` commands. Their presence in source does not imply they are pending in production or recorded in a Wrangler migrations tracking table. Inspect actual schema before running anything.

## Verification and deployment history

- Latest implementation commit before this memory update: `d81334c` (sign-in/date/assignment restrictions), pushed to main. All 36 tests passed; static build and Cloudflare Worker compilation passed.
- Prior changes: `2cc77ea` directory/filters/names; `205d226` clearer management forms; `699eaf2`, `a3285e5`, `c7b3601` removed duplicate sign-in/help text; `78d95d5` Firebase code/schema; `f2331a4` production Firebase configuration; `7ac92d8` recurring editor; `bf63494` removed filler text; `e10c60b` editable/deletable notes; `70092c3` hide duplicate note preview; `578a3f3` Instructions work-in-progress banner.
- Recurring schedule deployment and placement below backups were visually verified live. Author edit/delete permissions and recurrence conflicts were verified through tests, without modifying real service data for testing.
- Test fixture's simulated database-outage console message is expected in a passing cleanup test.
- Local previews/screenshots are in the chat's sibling `outputs/` directory. They are historical previews, not the source of current data.

## Working preferences

- Carry website changes through checks, commit and push to main within the user's authorized scope. State accurately whether work is pushed, deployed, or only locally prepared.
- Preserve concise interface copy; the user repeatedly removed explanatory filler. Do not reintroduce those messages.
- Use read-only live queries for current roster/schedule requests. Make targeted changes only to the requested records; never reset live user edits.
- Use the existing guidance plus this file in future chats attached to the repository. Update them when behavior, setup or verification status changes.


## Historical shifts (November 1, 2026)

- Signed-in active volunteers have View past shifts on Schedule, with Monday–Sunday browsing, a date picker, and a read-only view of notes/checklists/photos and backup history. Signing out clears history. Older schedule/photo API reads require sign-in; normal yesterday/today/upcoming schedule remains public.
- Recurring changes apply to today/future only. D1 schedule_versions captures names, IDs and recurring assignments on volunteer insertion, assignment/name/active changes or deletion. Triggers save each complete plan in the same transaction as the change. This works across days without visits or scheduled jobs. Date lookups use the latest version before the end of the service date in America/Chicago, including DST. Today/future use the current plan.
- Existing dates before the first version have unknown original assignments, explicitly labeled; do not backfill guessed historical names from today's roster. Existing notes and backup records are preserved.
- History is read only. Yesterday remains editable through the normal schedule; older note save/delete requests are rejected. No historical corrections endpoint was added. Retention/automatic deletion remains disabled.
- Migration 0006_schedule_history.sql was applied directly to production D1 on November 1, 2026. Do not reapply it or prior seed migrations. It seeds only the first plan version from the live roster; it never reseeds volunteers.
- Verification: 40 tests pass, including week navigation/sign-out clearing, recurring changes and deactivation preserving previous dates, unknown assignments, access restrictions, and Chicago DST boundaries. Static build and Cloudflare function compilation passed. Signed-in History was also visually checked in an isolated local preview with fixture data; production public schedule and anonymous-history rejection were verified without writing test service data.


## Chat summary: Review latest website changes (November 1, 2026)

This section distinguishes work performed in this chat from earlier volunteer, notes, authentication and recurring-editor changes, which were reviewed here but implemented in previous chats.

### Implemented and deployed in this chat

- Added View past shifts for signed-in active volunteers within Schedule. History has a date picker, previous/next week navigation and a read-only display of dated assignments, notes, laundry checklists, photos and backup records/history. Signing out clears the history display. The normal rolling schedule remains yesterday, today and six upcoming days.
- Enforced the user's explicit rule: recurring schedule changes affect today and future dates only; yesterday and older assignments must not change. Volunteer renames, reassignment, deactivation and removal also preserve historical names/assignments. Complete recurring-plan versions are recorded transactionally by D1 triggers, so preservation does not depend on daily visitors or a scheduled job.
- Added forward migration 0006_schedule_history.sql and applied it to production D1. It creates schedule_versions, its index, an initial version from the current live roster and insert/update/delete triggers. Do not reapply it. No existing volunteers, notes, photos or backup records were reseeded or removed by this migration.
- Dates before tracking began explicitly show Original assignment not recorded where the original assignment cannot be established. Do not infer historical assignments from the current recurring roster. Existing dated notes and backup records still display.
- History reads earlier than yesterday require an active signed-in volunteer on the server; historical photo reads have the same restriction and private/no-store caching. Notes older than yesterday cannot be saved or deleted through the API. Yesterday's author-only note editing/deletion remains available in the normal Schedule view. No historical correction workflow was implemented.
- Retention remains unchanged: no automated permanent deletion of notes, photos or backup data. Existing note soft-deletion behavior is retained.
- Fixed history text encoding and wide-screen day-heading/shift alignment; aligned week controls.

### Publication and validation

- Implementation commits: bd05381 (history/preservation), 07c5ed0 (project record), f8d5811 (text rendering/preview record), 1f9cf09 (final history layout). All pushed to main through existing Cloudflare Pages hosting.
- Final website implementation commit at this summary: 1f9cf09. Production deployment e05d2827-7965-45a8-bfaf-74582b04c65d. Final layout was verified served at https://templeservices.pages.dev/ using a cache-busting read.
- All 40 tests passed. The final layout-only adjustment also passed all 11 UI tests. Static build and Cloudflare functions compilation passed.
- Visually checked signed-in History using isolated local fixture data, including a sample past laundry note; this was not a production sign-in. Verified production dated-assignment response and HTTP 401 for anonymous older-history requests. No production test notes or volunteer edits were created for verification.
- Preview image: ../outputs/history-preview.png relative to this checkout. Local preview server was stopped after verification.

### WhatsApp discussion: proposed, not implemented

- User asked about posting a group message when a critical website action occurs, specifically a successful Need backup request. Potential follow-up event: backup confirmation.
- Proposed free flow: save the request first, then offer Share on WhatsApp with date, morning/evening shift, unavailable volunteer and website link; user selects the group and sends. A sharing link prepares text and does not automatically send it.
- User has not selected the sharing flow versus fully automatic posting. No sharing buttons, notification jobs, WhatsApp account connections or group messages were created in this chat.
- Fully automatic posting to the existing group requires further research into currently supported official integration/eligibility. Meta's group API documentation returned a rate-limit error during research; do not treat eligibility or existing-group support as verified. Do not claim that the standard sharing link can silently target or post to a group.

### Chat project context

- App initially listed this chat without a project even though the user's screenshot showed it under Temple Services. The move_thread_to_project tool successfully explicitly associated this chat with the local Temple Services project, ID 5fd25556-ec9a-4d7e-827b-a26060d563ed. Do not ask the user to recreate this chat based solely on that earlier null result.


## Compact spacing (November 3, 2026)

- Applied the reviewed compact-spacing prototype to the real site while retaining the existing theme, fonts, navigation and content. Shared header, cards, panels, instructions and directory use tighter vertical spacing.
- Mobile directory keeps Search and Sort by full width, with Role and Service day sharing a row. Sort by stays above its dropdown like every other filter label. Touch targets remain at least 44px.
- Desktop rolling schedule places the date beside morning/evening shifts. Opening notes or backup forms restores a two-column layout with a full-width day heading. Historical day headings retain their original grid structure.
- Signed-in mobile headers keep the account label on a separate row; shift actions can wrap. Hidden camera file inputs have a constrained width to prevent horizontal page overflow.
- Scope is presentation only: no roster, assignment, instruction text, authentication, API or database changes. No migrations.
- Validation: all 48 existing tests pass; static build and diff whitespace check pass. Visually checked public and fixture-signed-in pages at mobile, tablet and desktop widths, including Sort by placement and expanded notes. Server compilation was not rerun because Wrangler was unavailable in the offline cache; server code is unchanged.

## Combined contact menu (November 3, 2026)

- User approved replacing separate Call/SMS icons with one contact icon beside each person's name. The floating menu offers Call, SMS and WhatsApp without adding a row. Applied through the shared identity helper to current/upcoming schedules, backup coverage, permanent backups, recurring assignments, current note authors and directory headings. Recurring editor choices keep their contact icon outside the checkbox label on the same row.
- Directory phone numbers and email address links remain visible under existing sign-in permissions. Past schedules/notes and History continue to omit contacts. Anonymous and signed-out users receive no contact controls.
- WhatsApp opens an official wa.me click-to-chat link with international digits; account availability is not checked. The menu uses native popovers where supported to avoid clipping, stays inside viewport edges, permits only one open menu, and closes on outside click, Escape, focus leaving, scrolling and account changes.
- All 50 tests pass, including two new interaction/positioning tests; static build and whitespace checks pass. Browser verification could not be completed: local preview navigation timed out, then browser control stopped because it could not determine the current URL. No production data writes or schema changes were made. Push to main triggers the existing Cloudflare Pages deployment; confirm served assets separately before claiming deployment complete.
- Migration 0007_planned_shifts.sql (dated primary plans, table planned_shifts) was applied directly to production D1 on November 8, 2026. Do not reapply it. It only adds an empty table; no existing data was changed.
