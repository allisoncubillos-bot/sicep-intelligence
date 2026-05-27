@echo off
REM Lanzador para Windows Task Scheduler.
REM Se posiciona en la carpeta del script, activa el entorno virtual y ejecuta.
cd /d "%~dp0"
set PYTHONUTF8=1
call .venv\Scripts\activate.bat
python run_weekly.py >> sicep_audiencias.log 2>&1
