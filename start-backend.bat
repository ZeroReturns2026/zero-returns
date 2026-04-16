@echo off
REM Zero Returns - starts only the backend server.
REM Use this if you already have "shopify app dev" running and just need the backend.
cd /d "%~dp0"
echo Starting Zero Returns backend on http://localhost:3000 ...
echo Leave this window open. Press Ctrl+C to stop.
echo.
npm run backend
pause
