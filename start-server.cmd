@echo off
setlocal
echo ===================================================
echo Starting TrueForge Local Agent Server on Port 3000...
echo ===================================================

set PATH=%APPDATA%\npm;C:\Program Files\nodejs;%PATH%

if not exist "%LOCALAPPDATA%\trueforge" (
    mkdir "%LOCALAPPDATA%\trueforge"
)

if exist "%APPDATA%\npm\node_modules\@truefoundry\trueforge\dist\cli.js" (
    node "%APPDATA%\npm\node_modules\@truefoundry\trueforge\dist\cli.js" --port 3000
) else (
    npx @truefoundry/trueforge --port 3000
)
