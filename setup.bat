@echo off
REM Hey Tailor Windows installer.
REM Just double-click this file. It wraps setup.ps1 so Windows lets it run
REM without touching the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
