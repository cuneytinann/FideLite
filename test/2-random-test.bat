@echo off
cd /d "%~dp0"
echo === Random Game Simulation (20 games from Kiwipete) ===
echo Stockfish required. One of the shorter runs here.
echo.
node test.js random kiwipete 20 80
echo.
echo Done. Press any key to exit...
pause >nul
