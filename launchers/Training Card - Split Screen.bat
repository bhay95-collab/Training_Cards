@echo off
:: Opens the Training Card TWICE: left half and right half of the same screen.
:: Finds TrainingCard.html next to this file, or on the Desktop.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Assets\Open-TrainingCard.ps1" -Layout Dual
