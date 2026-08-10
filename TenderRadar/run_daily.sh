#!/bin/bash
# Lanzador del flujo DIARIO de pliegos para macOS launchd.
# Equivalente a run_daily.bat (Windows Task Scheduler).
cd "$(dirname "$0")"
source .venv/bin/activate
python3 run_daily.py >> sicep_pliegos.log 2>&1
