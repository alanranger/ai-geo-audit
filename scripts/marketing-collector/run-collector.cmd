@echo off
rem Nightly Squarespace email-report collector (scheduled task "ARP Squarespace Email Collector").
rem Uses its own browser profile; if the Squarespace login has expired the run is recorded as stale on the dashboard.
cd /d "%~dp0..\.."
if not exist "%LOCALAPPDATA%\AlanRanger" mkdir "%LOCALAPPDATA%\AlanRanger"
call npm run marketing:collector >> "%LOCALAPPDATA%\AlanRanger\sqs-collector.log" 2>&1
