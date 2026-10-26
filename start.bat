@echo off
cd /d "%~dp0"
echo Starting Problems in Agent Calling on http://localhost:8080
start "" http://localhost:8080
py serve.py || python serve.py
pause
