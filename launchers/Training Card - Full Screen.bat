@echo off
:: Opens the Training Card in ONE window that fills the screen.
:: Finds TrainingCard.html next to this file, or on the Desktop.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Assets\Open-TrainingCard.ps1" -Layout Single
