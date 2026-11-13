@echo off
:: Opens the LIVE Training Card twice: left and right half of the SECOND screen.
:: Each half is its own trainee (screen 1 and screen 2) and gets its own login.
:: Falls back to the main screen if there is only one.
:: When the site moves (e.g. to a QH address), change the address on the next line only.
set TC_URL=https://bhay95-collab.github.io/Training_Cards/

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Assets\Open-TrainingCard.ps1" -Layout Dual -Url "%TC_URL%"
