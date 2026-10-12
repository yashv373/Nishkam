@echo off
rem Starts the Nishkam local runner and prints the link to open. Close this window to stop it.
cd /d "%~dp0"
python runner\nishkam_runner.py
pause
