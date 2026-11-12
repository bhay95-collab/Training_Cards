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
- **MO Anaesthetist**: tabs "Training & Proficiency" / "Blank Record".
- **PEMR**: IOMS shown.
- **AO HBCIS**: logins repeat per facility (TR20 at RBWH and TPCH); unique key = login + facility.
- **Admin users**: a few non-technical people -> guided 4-step screen, plain-English problems, changes table, "Try it" before saving.
- **Admin shortcut**: Ctrl + Alt + U (Edge uses Ctrl + Shift + U for Read Aloud), or click "Data updated" in the footer 5 times.

## Open
- How often data is updated (designed for occasional use).
- Do training PCs reset on reboot? (affects any "remember this PC" feature — not in scope)
- What the Anaesthetist "Blank Record" set is for (tab has no hint yet).
- AO FirstNet ED HBCIS DOB is a fixed 01-Jan-2000, copied from the old card.
