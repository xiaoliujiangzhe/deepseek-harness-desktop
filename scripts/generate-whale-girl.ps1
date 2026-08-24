[CmdletBinding()]
param(
  [ValidateSet('low', 'medium', 'high', 'auto')]
  [string]$Quality = 'medium',

  [string]$Size = '1024x1024',

  [string]$Output = 'assets/whale-girl-token-rice-source.png',

  [switch]$Force,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.env.image.local'
$examplePath = Join-Path $projectRoot '.env.image.example'
$promptPath = Join-Path $PSScriptRoot 'prompts/whale-girl-token-rice.txt'
$imageGenPath = Join-Path $env:USERPROFILE '.codex/skills/.system/imagegen/scripts/image_gen.py'

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Missing $configPath. Copy $examplePath to .env.image.local, then add a newly-created API key."
}

if (-not (Test-Path -LiteralPath $imageGenPath)) {
  throw "Codex image generation helper was not found at $imageGenPath."
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) {
    continue
  }

  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) {
    throw "Invalid setting in .env.image.local. Expected NAME=value."
  }

  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim()
  $settings[$name] = $value
}

$apiKey = $settings['DSH_IMAGE_API_KEY']
$apiBase = $settings['DSH_IMAGE_API_BASE']
$model = $settings['DSH_IMAGE_MODEL']

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($apiKey)) {
  throw 'DSH_IMAGE_API_KEY is empty. Paste a newly-created key into .env.image.local; do not send it in chat.'
}
if ([string]::IsNullOrWhiteSpace($apiBase)) {
  $apiBase = 'https://api.apiyi.com/v1'
}
if ([string]::IsNullOrWhiteSpace($model)) {
  $model = 'gpt-image-2'
}

$outputPath = if ([System.IO.Path]::IsPathRooted($Output)) {
  $Output
} else {
  Join-Path $projectRoot $Output
}

$previousApiKey = $env:OPENAI_API_KEY
$previousBaseUrl = $env:OPENAI_BASE_URL
$previousPythonIoEncoding = $env:PYTHONIOENCODING
$previousPythonUtf8 = $env:PYTHONUTF8

try {
  # The OpenAI SDK reads these process-scoped variables. They are never printed.
  if (-not $DryRun) {
    $env:OPENAI_API_KEY = $apiKey
  }
  $env:OPENAI_BASE_URL = $apiBase.TrimEnd('/')
  $env:PYTHONIOENCODING = 'utf-8'
  $env:PYTHONUTF8 = '1'

  $arguments = @(
    $imageGenPath,
    'generate',
    '--model', $model,
    '--prompt-file', $promptPath,
    '--size', $Size,
    '--quality', $Quality,
    '--output-format', 'png',
    '--no-augment',
    '--out', $outputPath
  )
  if ($Force) {
    $arguments += '--force'
  }
  if ($DryRun) {
    $arguments += '--dry-run'
  }

  & python @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:OPENAI_API_KEY = $previousApiKey
  $env:OPENAI_BASE_URL = $previousBaseUrl
  $env:PYTHONIOENCODING = $previousPythonIoEncoding
  $env:PYTHONUTF8 = $previousPythonUtf8
}

if ($DryRun) {
  Write-Host 'Dry run completed; no API request was sent.'
} else {
  Write-Host "Generated mascot source: $outputPath"
}
