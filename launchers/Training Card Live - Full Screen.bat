@echo off
:: Opens the LIVE Training Card in ONE window that fills the SECOND screen.
:: Falls back to the main screen if there is only one.
:: When the site moves (e.g. to a QH address), change the address on the next line only.
set TC_URL=https://bhay95-collab.github.io/Training_Cards/

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Assets\Open-TrainingCard.ps1" -Layout Single -Url "%TC_URL%"
