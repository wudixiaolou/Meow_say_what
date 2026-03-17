param(
  [string]$ProjectId = $env:PROJECT_ID,
  [string]$Region = "us-central1",
  [string]$ServiceName = "meowlingo-backend",
  [string]$AllowUnauthenticated = "true",
  [string]$MinInstances = "0",
  [string]$MaxInstances = "2",
  [string]$Memory = "2Gi",
  [string]$Cpu = "1"
)

$ErrorActionPreference = "Stop"

Remove-Item Env:CLOUDSDK_PYTHON -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDSDK_PYTHON_SITEPACKAGES -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  Write-Host "PROJECT_ID is required. Example: `$env:PROJECT_ID='your-project-id'" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "gcloud CLI is required." -ForegroundColor Red
  exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-GcloudIgnoreFailure {
  param([string[]]$Args)
  try {
    & gcloud @Args 2>$null | Out-Null
  } catch {
  } finally {
    $global:LASTEXITCODE = 0
  }
}

gcloud config set project $ProjectId | Out-Null
Invoke-GcloudIgnoreFailure -Args @("config", "unset", "core/python", "--quiet")
Invoke-GcloudIgnoreFailure -Args @("config", "unset", "core/python_sitepackages", "--quiet")
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com | Out-Null

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--source", $scriptDir,
  "--region", $Region,
  "--platform", "managed",
  "--memory", $Memory,
  "--cpu", $Cpu,
  "--min-instances", $MinInstances,
  "--max-instances", $MaxInstances,
  "--quiet"
)

if ($AllowUnauthenticated -eq "true") {
  $deployArgs += "--allow-unauthenticated"
} else {
  $deployArgs += "--no-allow-unauthenticated"
}

gcloud @deployArgs

$serviceUrl = gcloud run services describe $ServiceName --region $Region --format "value(status.url)"
Write-Host "SERVICE_NAME=$ServiceName"
Write-Host "SERVICE_URL=$serviceUrl"
