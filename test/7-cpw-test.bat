@echo off
cd /d "%~dp0"
echo === CPW Standard Positions (up to depth 5) ===
echo In order d1 d2 d3 d4 d5 for each position.
echo Pos3 is fast, Kiwipete is slowest. Press Ctrl+C to stop.
echo.
node test.js cpw 5
echo.
echo Done. Press any key to exit...
pause >nul
