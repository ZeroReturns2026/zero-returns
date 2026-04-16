@echo off
REM Hey Tailor — launches the backend and Shopify CLI in two separate windows.
REM Run setup.bat once before this.

cd /d "%~dp0"

echo Starting Hey Tailor backend (http://localhost:3000)...
start "Hey Tailor backend" cmd /k "cd /d %~dp0 && npm run backend"

REM Give the backend a moment to bind its port before Shopify CLI starts.
timeout /t 4 /nobreak >nul

echo Starting Shopify CLI (shopify app dev)...
start "Shopify app dev" cmd /k "cd /d %~dp0 && shopify app dev"

echo.
echo Two windows should now be open:
echo   1) Hey Tailor backend  — leave this running
echo   2) Shopify app dev      — follow its prompts (login, create app, create dev store)
echo.
pause
