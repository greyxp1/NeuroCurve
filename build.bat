@echo off
title Python to EXE Compiler
echo Checking for Python installation...
where python >nul 2>nul || (
    echo Python is not installed. Please install Python and try again.
    pause
    exit /b
)

echo Installing PyInstaller if necessary...
python -m pip show pyinstaller >nul 2>nul || python -m pip install pyinstaller

echo Compiling NeuroAdaptiveCurve.py into a single executable...
python -m PyInstaller --onefile --noconsole --icon=icon.ico NeuroAdaptiveCurve.py

echo Cleaning up unnecessary files...
rmdir /s /q build
del NeuroAdaptiveCurve.spec

echo Done! Your executable is in the "dist" folder.
pause
