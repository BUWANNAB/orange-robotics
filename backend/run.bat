@echo off
setlocal
echo ==============================================
echo  Orange AGV/AMR Python Backend (Dev Runner)
echo ==============================================

:: 优先寻找用户 Python 3.11，避免被 Inkscape/第三方工具自带的精简 Python 拦截
set "PYTHON_EXE=C:\Users\28379\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=python"
)

echo Using Python: %PYTHON_EXE%
"%PYTHON_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
endlocal
