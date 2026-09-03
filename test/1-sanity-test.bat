@echo off
REM Double-click this file to run the sanity test immediately
cd /d "%~dp0"
echo === newengine Sanity Test ===
echo The quickest run in this folder.
echo.
node test.js sanity
echo.
echo Done. Press any key to continue...
pause >nul
