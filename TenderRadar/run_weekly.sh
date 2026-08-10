#!/bin/bash
# Lanzador del flujo SEMANAL de audiencias para macOS launchd.
# Equivalente a run_weekly.bat (Windows Task Scheduler).
cd "$(dirname "$0")"
source .venv/bin/activate
python3 run_weekly.py >> sicep_audiencias.log 2>&1
