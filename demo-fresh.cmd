@echo off
rem Build the latest source and start the app + CMS in an empty state (see scripts/dev/demo-fresh.mjs)
cd /d "%~dp0"
node scripts\dev\demo-fresh.mjs %*
pause
