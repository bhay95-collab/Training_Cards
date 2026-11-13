# Training Card — Build Spec

Replaces the Excel "Digital Training Card – Trainee Copy v2.0" with one web page.

## Delivery
- **One self-contained HTML file** (`TrainingCard.html`), opened from the desktop of training PCs.
- Runs offline. All data, fonts (Inter), barcode library (bwip-js) and icons embedded.
- Target browser: **Microsoft Edge**. Desktop-first; scales to laptop.

## Data
- New **clean Excel template**, pre-filled with all current data, known errors fixed:
  - `#VALUE!` cells removed
  - RN Periop + RN Medical Imaging Pt 2 MRN/DOB swap fixed
  - Pt 2 barcode bug (checked Pt 1 cell) removed
- Every course tab uses the **same column headings**; importer reads by heading name.
- **Courses** tab sets per course: name, profession group, doctor, witness login, show barcode Y/N, show proficiency patients Y/N, facility list.
- **Update data**: hidden admin screen (keyboard shortcut, told at handover). Load new Excel → validation report → download new `TrainingCard.html` to replace old one.

## Trainee flow
1. Heading "Training Card" (neutral, no logos) + **search box** ("Know your login? Type it").
   - Unique login → straight to card. Login used by several courses → show matching courses to choose.
2. **Profession tiles** row: Nursing · Medical · Midwifery · Admin · Pharmacy · Allied Health.
3. Course cards (pastel, profession colour).
4. **Login grid** of tiles. Trainer assigns logins; trainee finds theirs.
   - Admin courses with multiple facilities: **facility chips** above grid (All · CAB · TPCH · REDH · COH).
5. **Card**: login panel, then all patient cards visible at once.

## Card rules
- Click-to-copy on login, password, MRN, names.
- Barcode: **Aztec, "AC" + FIN**, large black-on-white, tap to enlarge full-screen for **on-screen scanning**. No barcode where no FIN or course has barcodes off.
- Midwifery Day 1: **training patients only** (proficiency on paper). Per-course switch.
- Admin courses: **ieMR** and **HBCIS** sections side by side.
- Blank field → "—". Whole patient blank → patient card hidden.
- Empty courses **hidden** until data loaded (incl. RN Clinical Support, MO Mental Health, MO Renal OPD, Neonate, AO PowerChart, AO Transcription, MO Obst Postnatal Day 2).
- No printing (mail merge process unchanged).

## Look
- Apple Store inspired: light grey/white page, black text, large bold headings.
- Navy heading colour, teal buttons/links.
- Profession pastels: Nursing pink, Medical blue, Midwifery lilac, Admin green, Pharmacy yellow, Allied Health peach.
- **Light mode only.**
- **Subtle motion** (<0.3s): tile hover lift, card fade/slide in. Respects Windows reduce-motion.

## Decisions after preview review
- **Half-screen first**: two PCs share one monitor (~950 x 900 each). Card must show login, patients and other logins without scrolling.
- **Blood bag barcode**: fixed image A530-024-0384 (copied from the old card). On every course except Admin. Per-course Yes/No.
- **Course complete**: nav button + banner. "Has your trainer signed you off?" Yes -> opens ServiceNow access form (same link for all courses, overridable per course). No -> "Chat with your trainer".
- **Pharmacy**: one card, Part A (pharmacist) and Part B (doctor login + patients) as sections. Searching the Part B login finds the card.
- **MO ObGyn**: tabs "Instructor led" / "Proficiency", 3 patients each.
- **MO Anaesthetist**: tabs "Training & Proficiency" / "Blank Record" (blank record case practice; role "Blank record practice").
- **Patient cards**: role (Instructor led / Proficiency) as a solid badge in the profession ink; MRN, DOB and Ward in a white box (user's choice, kept over Hallmark's no-box-in-card rule).
- **Course cards**: name and "Choose login" only (no login counts).
- **Patient names**: small "Surname" / "First name" labels, because training names look like logins (e.g. MNMOFN02).
- **AO FirstNet ED HBCIS DOB**: fixed 01-Jan-2000 (confirmed).
- **PEMR**: IOMS shown.
- **AO HBCIS**: logins repeat per facility (TR20 at RBWH and TPCH); unique key = login + facility.
- **Admin users**: a few non-technical people -> guided 4-step screen, plain-English problems, changes table, "Try it" before saving.
- **Admin shortcut**: Ctrl + Alt + U (Edge uses Ctrl + Shift + U for Read Aloud), or click the footer line 5 times. The "Data updated" footer was removed at the user's request (the date still shows on the admin screen).

## Open
- How often data is updated (designed for occasional use).
- Do training PCs reset on reboot? (affects any "remember this PC" feature — not in scope)

---

# Live classes (branch `claude/live-class-mode`)

An online version for testing on GitHub Pages: an instructor runs a class, trainee PCs join with a code, logins are handed out automatically, and the instructor switches what every trainee sees.

## Flow
- **Instructor**: signs in with the shared instructor password, starts a class (course, facility if the course has several, site or room, trainees booked). Gets a 6-character **class code**. Takes the **first free login**; trainees get the next ones.
- **Trainee PC**: opens the site, types the code, and is given the next free login for that class. Refreshing keeps the same login. A full class tells the trainee to ask for a place.
- **Walk-ins**: the instructor adds a place; it takes the next free login.
- **Logins are shared across sites**: a login can be in only one live class anywhere, so two sites running the same course never clash.
- **Toggle**: the instructor picks a **Part** (only for courses with parts, e.g. Pharmacy Part A / Part B, AO VECS Triage / Departure, Anaesthetist Training / Blank Record) and flips **Instructor led / Proficiency**. Every trainee screen switches within a couple of seconds and shows only those patients.
- **End class**: every trainee card closes and the logins return to the pool. Classes are for one day: at midnight Brisbane time every class still running ends and its logins return to the pool (a nightly pg_cron job, plus a date check on every request as a safety net).
- **Admin**: download the data as Excel, load a changed spreadsheet (same plain-English checks), upload it (only when no class is live), change passwords.

## Trainer chat
- One shared chat log for every signed-in trainer, all sites, at the top of the instructor pages (Classes, Start a class, each class console). Trainees never see it.
- No personal accounts: each trainer types a display name for the day (remembered on that computer until midnight). Messages sent from a class console are tagged with that class (course, site, code).
- Live within about 2 seconds; a 20-second check catches up if the connection drops.
- Up to 500 characters a message, 20 messages a minute per trainer. The panel reminds trainers: no patient or personal information.
- Wiped every Friday at 10 pm Brisbane time (pg_cron); the live channel id rotates at the same time.
- Security: messages live in `tc.messages` (no grants); read and sent only through `tc_chat` / `tc_chat_send` with an instructor token. The live signal carries only the new message id.

## Toggle mapping (agreed)
| Course | Parts | Instructor led | Proficiency |
| --- | --- | --- | --- |
| 2-patient courses | none | Patient 1 | Patient 2 |
| MO ObGyn | none | the instructor-led three | the proficiency three |
| Pharmacy | Part A, Part B | the part's Patient 1 | the part's Patient 2 |
| AO FirstNet VECS | Triage, Departure | the part's instructor-led patient | the part's proficiency patient |
| MO Anaesthetist | Training, Blank Record | the part's Patient 1 | the part's Patient 2 |
| AO FirstNet ED | none | ILT, STTA, Ward | Proficiency |
| AO ESM | none | A, B, C | D |
| Midwifery Day 1 | none | Antenatal + Postnatal (training) | Antenatal + Postnatal (proficiency) |
| HBCIS patients | – | always shown | always shown |

## Security
- Database: Supabase project (reused "Unstuck"), private schema `tc`. RLS on every table with no policies; no table grants to the public roles; the schema is not exposed by the API.
- The site can only call `public.tc_*` functions (SECURITY DEFINER, empty search_path). Each checks a staff token or a trainee device id and returns only what that caller may see. A trainee PC sees only its own login and the current patients.
- Staff passwords are bcrypt hashes; session tokens are random, stored as SHA-256 hashes and expire after 14 hours. Failed sign-ins (8 per 15 min) and wrong class codes (30 per 15 min) are rate-limited per address.
- Live updates are broadcast on a secret per-class channel and carry only "the toggle changed", never patient data.
- The page published on GitHub Pages holds no course data (the build refuses if it finds any). The publishable key in it can only reach the tc_* functions.
- The repo is public, so shared defaults (standard password, witness login) live only in the database and in `data/defaults.json`, which git ignores.
- Data region: Singapore (the reused project). A live QH version should move to Sydney or QH infrastructure.
