@echo off
REM Lanzador del flujo DIARIO de pliegos para Windows Task Scheduler.
cd /d "%~dp0"
set PYTHONUTF8=1
call .venv\Scripts\activate.bat
python run_daily.py >> sicep_pliegos.log 2>&1
