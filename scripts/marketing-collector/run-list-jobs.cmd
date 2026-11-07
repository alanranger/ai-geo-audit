@echo off
rem Every 5 minutes (scheduled task "ARP Squarespace List Jobs"): runs any "Load into Squarespace list" queued on the
rem dashboard. Exits straight away when nothing is queued; opens the collector's own browser profile only for a job.
cd /d "%~dp0..\.."
if not exist "%LOCALAPPDATA%\AlanRanger" mkdir "%LOCALAPPDATA%\AlanRanger"
call node scripts/marketing-collector/collector.mjs --jobs >> "%LOCALAPPDATA%\AlanRanger\sqs-list-jobs.log" 2>&1
