@echo off
setlocal
if "%PROJECT_ID%"=="" (
  set /p PROJECT_ID=Input GCP PROJECT_ID:
)
set "CLOUDSDK_PYTHON="
set "CLOUDSDK_PYTHON_SITEPACKAGES="
set "VIRTUAL_ENV="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\deploy_cloud_run.ps1" -ProjectId "%PROJECT_ID%"
endlocal
