$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $projectRoot '.env'
$deployDir = Join-Path $projectRoot 'vercel-upload-ready'
$env:npm_config_cache = Join-Path $projectRoot '.npm-cache'

if (-not (Test-Path -LiteralPath $envFile)) {
    throw '.env file was not found in the project directory.'
}

if (-not (Test-Path -LiteralPath $deployDir)) {
    throw 'vercel-upload-ready directory was not found.'
}

$values = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
        $values[$matches[1]] = $matches[2]
    }
}

$values['NODE_ENV'] = 'production'
$values['AUTO_INIT_DB'] = 'false'
$values['ALLOWED_ORIGINS'] = 'https://cleans-six.vercel.app'

$required = @(
    'DATABASE_URL',
    'ADMIN_USERNAME',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'ADMIN_TOKEN_SECRET',
    'NODE_ENV',
    'AUTO_INIT_DB',
    'ALLOWED_ORIGINS'
)

foreach ($name in $required) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
        throw "Required value is missing: $name"
    }
}

Push-Location $deployDir
try {
    Write-Host 'Checking Vercel CLI...'
    & npm exec --yes --package=vercel -- vercel --version
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not download or run Vercel CLI.'
    }

    Write-Host 'Vercel login or project linking may open now.'
    & npm exec --yes --package=vercel -- vercel link
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not link the Vercel project.'
    }

    foreach ($name in $required) {
        Write-Host "Uploading environment variable: $name"
        $values[$name] | & npm exec --yes --package=vercel -- vercel env add $name production --force --sensitive
        if ($LASTEXITCODE -ne 0) {
            throw "Could not upload environment variable: $name"
        }
    }

    Write-Host 'Starting the production deployment...'
    & npm exec --yes --package=vercel -- vercel --prod
    if ($LASTEXITCODE -ne 0) {
        throw 'Vercel production deployment failed.'
    }
} finally {
    Pop-Location
}
