@echo off
setlocal EnableExtensions

title Patch DustWeaver Electron Scripts - Fixed

pushd "%~dp0"

echo.
echo ==============================================
echo   Patch DustWeaver Electron Scripts - Fixed
echo ==============================================
echo.

if not exist "package.json" (
  echo ERROR: package.json was not found.
  echo Put this .bat file in the DustWeaver root folder, next to package.json.
  echo.
  pause
  popd
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on PATH.
  echo.
  pause
  popd
  exit /b 1
)

set "BACKUP=package.json.backup-before-electron-script-fix.%RANDOM%.json"
copy "package.json" "%BACKUP%" >nul
if errorlevel 1 (
  echo ERROR: Could not create package.json backup.
  echo.
  pause
  popd
  exit /b 1
)

echo Created backup: %BACKUP%
echo.

node -e "const fs=require('fs'); const p='package.json'; const pkg=JSON.parse(fs.readFileSync(p,'utf8')); pkg.scripts=pkg.scripts||{}; pkg.scripts.electron='npm exec -- electron --no-sandbox .'; pkg.scripts.desktop='npm run build && npm exec -- electron --no-sandbox .'; fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n'); console.log('Updated scripts:'); console.log('  electron = '+pkg.scripts.electron); console.log('  desktop  = '+pkg.scripts.desktop);"
if errorlevel 1 (
  echo.
  echo ERROR: Failed to patch package.json.
  echo Restoring backup...
  copy "%BACKUP%" "package.json" >nul
  echo.
  pause
  popd
  exit /b 1
)

echo.
echo package.json patched successfully.
echo.
echo Testing npm run desktop...
echo.

call npm run desktop
if errorlevel 1 (
  echo.
  echo npm run desktop still failed.
  echo package.json was patched, but another issue remains.
  echo Backup file is still here: %BACKUP%
  echo.
  pause
  popd
  exit /b 1
)

echo.
echo SUCCESS: npm run desktop completed.
echo Backup file is still here: %BACKUP%
echo.
pause
popd
exit /b 0
