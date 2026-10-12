$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $repoRoot '.env'

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { return }
    $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

if (-not $env:INTAKE_KEY) {
  Write-Error 'INTAKE_KEY is not set. Add it to .env or this session. See .env.example.'
  exit 1
}

$baseUrl = if ($env:N8N_BASE_URL) { $env:N8N_BASE_URL.TrimEnd('/') } else { 'http://localhost:5678' }

$body = @{
  name = 'Paramjot Singh'
  email = 'paramjot@acme.io'
  company = 'RetroTerminal'
  website = 'https://iristerminal.vercel.app'
  service = 'MDR'
  message = 'Need 24x7 SOC for 300 endpoints'
} | ConvertTo-Json

$headers = @{ 'X_API_KEY' = $env:INTAKE_KEY }

Invoke-RestMethod -Uri "$baseUrl/webhook/lead" -Method Post -ContentType 'application/json' -Headers $headers -Body $body
