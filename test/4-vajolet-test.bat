@echo off
cd /d "%~dp0"
echo === Vajolet Real-Game Suite (50 positions, up to depth 4) ===
echo A long run. Press Ctrl+C to stop.
echo NOTE: d5 takes very long. If you want it: node test.js vajolet 50 5
echo.
node test.js vajolet 50 4
echo.
echo Done. Press any key to exit...
pause >nul
