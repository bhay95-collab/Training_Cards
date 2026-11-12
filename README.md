# Training Card

One self-contained web page (`TrainingCard.html`) that replaces the Excel training card.
Opened from the desktop of training PCs in Edge. Works offline. See `SPEC.md` for what it does and why.

## Day-to-day data updates

No code needed. Open the Training Card, press **Ctrl + Alt + U**, and follow the 4 steps
(download spreadsheet -> edit -> load -> save new file). The spreadsheet's **Read me** tab explains every column.

## Opening the card on training PCs

`launchers/` holds two double-click launchers (keep the `Assets` folder next to them):

- **Training Card - Full Screen.bat**: one Edge app window filling the second screen.
- **Training Card - Split Screen.bat**: two Edge app windows, left half and right half of the second screen.

Both open on the second screen; on a PC with only one screen they use that screen.

They find `TrainingCard.html` next to the launcher first, then on the user's Desktop. Running one again
closes its old windows and opens fresh ones.

## For developers

Needs Node 18+ and Python 3 with openpyxl (only for the one-off conversion).

```bash
npm install
```

Data files live in `data/` and are **not** committed (they hold training logins).

```bash
npm run convert   # one-off: old v2.0 workbook (data/source-v2.0.xlsx) -> data/Training-Card-Data.xlsx
npm run build     # data/Training-Card-Data.xlsx -> dist/TrainingCard.html
```

| Path | What |
| --- | --- |
| `src/index.html` | Page layout and styles |
| `src/app.js` | Trainee flow, card, search, course complete, admin screen |
| `src/lib/xlsx.mjs` | Tiny .xlsx reader/writer (browser + Node) |
| `src/lib/template.mjs` | Template columns, checks with plain-English messages, data <-> spreadsheet |
| `src/lib/browser.mjs` | Bundles barcode + Excel code for the page |
| `build/build.mjs` | Checks the spreadsheet and inlines everything into one HTML file |
| `build/convert_v2.py` | Migrates the old v2.0 workbook (fixes known data errors) |
| `assets/blood-bag.png` | Blood bag barcode image from the old card |

The page saves copies of itself from the admin screen, so `src/app.js` must stay the last script on the page.
