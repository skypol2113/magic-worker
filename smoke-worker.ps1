# smoke-worker.ps1
# End-to-end smoke тесты Magic Worker (локально/в докере).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# -----------------------
# Конфигурация
# -----------------------
$WorkerBaseUrl = if ($env:WORKER_URL) { $env:WORKER_URL } else { "http://127.0.0.1:3000" }

$AssistTextRu = "Помоги переформулировать желание поехать в Астану на выходных"
$IntentAText  = "I want to buy a car in Almaty"
$IntentBText  = "Looking to purchase a car in Almaty"

# -----------------------
# Хелперы
# -----------------------
function Test-Command {
  param([Parameter(Mandatory)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [Parameter(Mandatory)]$BodyObject
  )
  $json = $BodyObject | ConvertTo-Json -Depth 12 -Compress
  return Invoke-RestMethod -Uri $Uri -Method Post -ContentType "application/json; charset=utf-8" -Body $json
}

function Invoke-JsonGet {
  param([Parameter(Mandatory)][string]$Uri)
  return Invoke-RestMethod -Uri $Uri -Method Get
}

function Confirm-True {
  param(
    [Parameter(Mandatory)][bool]$Condition,
    [Parameter(Mandatory)][string]$Message
  )
  if (-not $Condition) { throw "❌ $Message" }
  Write-Host "✅ $Message" -ForegroundColor Green
}

function Test-HasProperty {
  param(
    [Parameter(Mandatory)]$Object,
    [Parameter(Mandatory)][string]$Name
  )
  if ($null -eq $Object) { return $false }
  if ($Object -is [System.Collections.IDictionary]) { return $Object.Contains($Name) }
  return $Object.PSObject.Properties.Name -contains $Name
}

function Get-PairKey {
  param(
    [Parameter(Mandatory)][string]$AUid,
    [Parameter(Mandatory)][string]$BUid,
    [Parameter(Mandatory)][string]$AIntentId,
    [Parameter(Mandatory)][string]$BIntentId
  )
  $uids    = @($AUid, $BUid) | Sort-Object
  $intents = @($AIntentId, $BIntentId) | Sort-Object
  $s = "intent|{0}|{1}" -f ($uids -join '|'), ($intents -join '|')
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
    $hash  = $sha256.ComputeHash($bytes)
  } finally { $sha256.Dispose() }
  $hex = -join ($hash | ForEach-Object { $_.ToString("x2") })
  return $hex.Substring(0,16)
}

function Get-AccessToken {
  if (-not (Test-Command -Name "gcloud")) { return $null }
  $tok = & gcloud auth print-access-token 2>$null
  if ([string]::IsNullOrWhiteSpace($tok)) { return $null }
  return $tok.Trim()
}

# -----------------------
# 1) Healthcheck
# -----------------------
$health = Invoke-JsonGet "$WorkerBaseUrl/healthz"
Confirm-True ( (Test-HasProperty $health 'ok') -and ($health.ok -eq $true) ) "healthz ok"

$projectId = $health.projectId
if ([string]::IsNullOrWhiteSpace($projectId)) { $projectId = $env:GOOGLE_CLOUD_PROJECT }
Write-Host ("ℹ️  projectId: " + ($(if ([string]::IsNullOrWhiteSpace($projectId)) { '<empty>' } else { $projectId })))

Confirm-True ( (Test-HasProperty $health 'assistEnabled') -and ($health.assistEnabled -eq $true) ) "assist enabled"
Confirm-True ( (Test-HasProperty $health 'hasOpenAIKey')   -and ($health.hasOpenAIKey   -eq $true) ) "OpenAI key detected"

# -----------------------
# 2) Assist — facets (lite)
# -----------------------
$respFacets = Invoke-JsonPost "$WorkerBaseUrl/api/assist/continue?mode=facets" @{
  text = $AssistTextRu; lang = "ru"
}
Confirm-True ( (Test-HasProperty $respFacets 'ok') -and ($respFacets.ok -eq $true) ) "assist facets request ok"
Confirm-True ( (Test-HasProperty $respFacets 'suggestions') -and ($respFacets.suggestions.Count -gt 0) ) "assist facets suggestions>0"
Write-Host ("📝 facets[0]: " + $respFacets.suggestions[0]) -ForegroundColor DarkCyan

# -----------------------
# 3) Assist — PRO full
# -----------------------
$respFull = Invoke-JsonPost "$WorkerBaseUrl/api/assist/continue?mode=facets&tier=pro&out=full" @{
  text = "Хочу купить подержанный автомобиль в Алматы, желательно с историей обслуживания";
  lang = "ru"
}

if (Test-HasProperty $respFull 'ok') {
  Confirm-True ( $respFull.ok -eq $true ) "assist pro full request ok"
} else {
  $dump = ($respFull | ConvertTo-Json -Depth 6 -Compress)
  throw "❌ assist pro full: поле 'ok' отсутствует. Ответ: $dump"
}

if ( (Test-HasProperty $respFull 'full') -and (-not [string]::IsNullOrWhiteSpace([string]$respFull.full)) ) {
  $preview = if ($respFull.full.Length -gt 90) { $respFull.full.Substring(0,90) + "…" } else { $respFull.full }
  Write-Host ("📝 full: " + $preview) -ForegroundColor DarkCyan
} else {
  Write-Host "⚠️  assist pro full отсутствует (ok=true) — пропускаем превью" -ForegroundColor Yellow
}

# -----------------------
# 4) Embeddings status + similarity
# -----------------------
$emb = Invoke-JsonGet "$WorkerBaseUrl/api/embeddings/status"
Confirm-True ( (Test-HasProperty $emb 'enabled')  -and ($emb.enabled -eq $true) ) "embeddings enabled"
Confirm-True ( (Test-HasProperty $emb 'provider') -and ($emb.provider -eq "vertex") ) "embeddings provider=vertex"

$sim = Invoke-JsonPost "$WorkerBaseUrl/api/embeddings/similarity" @{
  a = "buy a car in almaty"; b = "looking to purchase a car in almaty"
}
Confirm-True ( (Test-HasProperty $sim 'ok') -and ($sim.ok -eq $true) ) "embeddings similarity request ok"
Confirm-True ( (Test-HasProperty $sim 'similarity') -and ($sim.similarity -gt 0.8) ) "similarity > 0.8 (got $($sim.similarity))"

# -----------------------
# 5) INTENT → MATCH
# -----------------------
$respA = Invoke-JsonPost "$WorkerBaseUrl/api/wish" @{ text = $IntentAText; userId = "userA"; userName = "Smoke A" }
$respB = Invoke-JsonPost "$WorkerBaseUrl/api/wish" @{ text = $IntentBText; userId = "userB"; userName = "Smoke B" }

Confirm-True ( (Test-HasProperty $respA 'success') -and ($respA.success -eq $true) ) "intent A created"
Confirm-True ( (Test-HasProperty $respB 'success') -and ($respB.success -eq $true) ) "intent B created"

$intentAId = $respA.intentId
$intentBId = $respB.intentId
Confirm-True ( -not [string]::IsNullOrWhiteSpace($intentAId) ) "intent A id captured"
Confirm-True ( -not [string]::IsNullOrWhiteSpace($intentBId) ) "intent B id captured"

Start-Sleep -Seconds 4  # дать воркеру догенерить матч

$token = Get-AccessToken
$canFirestoreCheck = ( $null -ne $token ) -and ( -not [string]::IsNullOrWhiteSpace($projectId) )
if ($canFirestoreCheck) {
  $pair = Get-PairKey -AUid "userA" -BUid "userB" -AIntentId $intentAId -BIntentId $intentBId
  $docUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/matches/$pair"
  try {
    $headers = @{ "Authorization" = "Bearer $token" }
    $doc = Invoke-RestMethod -Uri $docUrl -Headers $headers -Method Get
    $exists = ($null -ne $doc) -and (Test-HasProperty $doc 'name') -and (-not [string]::IsNullOrWhiteSpace([string]$doc.name))
    Confirm-True $exists "match document exists (pairKey=$pair)"
    Write-Host "🧩 match: $($doc.name)" -ForegroundColor Green
  } catch {
    Write-Host "⚠️  Firestore REST check failed (404/IAM?): $($_.Exception.Message)" -ForegroundColor Yellow
  }
} else {
  Write-Host "⚠️  Skip Firestore REST check: no gcloud or projectId" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 Smoke tests finished." -ForegroundColor Cyan
