@echo off
REM Double-click or run from cmd to push a Firestore sync (uses backend\.env for secret).
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloud-sync.ps1" %*
