<# 
  firestore-rest.ps1

  Проверка чтения Firestore:
  - REST через официальный API (нужен gcloud для токена)
  - Фолбэк: воркеровые отладочные эндпоинты (если включены)

  Примеры:
    .\firestore-rest.ps1                           # последние 10 матчей
    .\firestore-rest.ps1 -PairKey bb39...9875     # конкретный match по pairKey
    .\firestore-rest.ps1 -ProjectId my-cool-magicbox -WorkerUrl http://127.0.0.1:3000
#>

[CmdletBinding()]
param(
  [string]$WorkerUrl = "http://127.0.0.1:3000",
  [string]$ProjectId = "",
  [string]$PairKey   = "",
  [int]$Limit        = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-AccessToken {
  [CmdletBinding()]
  param()
  if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    return $null
  }
  $token = & gcloud auth print-access-token 2>$null
  if ([string]::IsNullOrWhiteSpace($token)) { return $null }
  return $token.Trim()
}

function Get-WorkerHealth {
  [CmdletBinding()]
  param([string]$BaseUrl)
  try {
    return Invoke-RestMethod -Uri "$BaseUrl/healthz" -Method GET -TimeoutSec 10
  } catch {
    return $null
  }
}

function Get-RestDocByPairKey {
    [CmdletBinding()]
    param(
      [string]$ProjectId,
      [string]$PairKey,
      [string]$AccessToken
    )
    $uri = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents/matches/$PairKey"
    $headers = @{ Authorization = "Bearer $AccessToken" }
    try {
      return Invoke-RestMethod -Uri $uri -Headers $headers -Method GET -TimeoutSec 20
    } catch {
      return $null
    }
  }
  
  function Get-RestLastMatches {
    [CmdletBinding()]
    param(
      [string]$ProjectId,
      [int]$Limit,
      [string]$AccessToken
    )
    $uri = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents:runQuery"
    $headers = @{ Authorization = "Bearer $AccessToken" }
    $body = @{
      structuredQuery = @{
        from = @(@{ collectionId = "matches" })
        orderBy = @(@{
          field     = @{ fieldPath = "createdAt" }
          direction = "DESCENDING"
        })
        limit = $Limit
      }
    } | ConvertTo-Json -Depth 6 -Compress
  
    try {
      $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method POST -ContentType "application/json" -Body $body -TimeoutSec 25
      if ($null -eq $resp) { return @() }
      $docs = @()
      foreach ($row in $resp) {
        if ($null -ne $row.document) { $docs += $row.document }
      }
      return $docs
    } catch {
      return @()
    }
  }
  

function Get-WorkerDocByPairKeyFallback {
  [CmdletBinding()]
  param(
    [string]$BaseUrl,
    [string]$PairKey
  )
  # Требуется отладочный эндпоинт в воркере:
  # app.get('/api/_debug/get-doc', async (req,res)=>{ const p=req.query.path; const snap=await db.doc(p).get(); ... })
  $uri = "$BaseUrl/api/_debug/get-doc?path=matches/$PairKey"
  try {
    return Invoke-RestMethod -Uri $uri -Method GET -TimeoutSec 15
  } catch {
    return $null
  }
}

function Get-WorkerLastMatchesFallback {
  [CmdletBinding()]
  param(
    [string]$BaseUrl,
    [int]$Limit
  )
  # Требуется отладочный эндпоинт в воркере:
  # app.get('/api/_debug/list-docs', async(req,res)=>{ coll,orderBy,dir,limit ... })
  $uri = "$BaseUrl/api/_debug/list-docs?coll=matches&orderBy=createdAt&dir=desc&limit=$Limit"
  try {
    $resp = Invoke-RestMethod -Uri $uri -Method GET -TimeoutSec 15
    if ($null -eq $resp) { return @() }
    return $resp
  } catch {
    return @()
  }
}

Write-Host "—— Firestore REST check ——" -ForegroundColor Cyan

# 1) healthz → projectId (если не задан)
$health = Get-WorkerHealth -BaseUrl $WorkerUrl
if ($null -eq $health) {
  Write-Warning "Не удалось прочитать $WorkerUrl/healthz. Продолжаю без него."
}
if ([string]::IsNullOrWhiteSpace($ProjectId) -and $null -ne $health -and $health.projectId) {
  $ProjectId = [string]$health.projectId
}
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  $ProjectId = $env:GOOGLE_CLOUD_PROJECT
}
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  Write-Warning "ProjectId не определён (ни параметр, ни healthz, ни env). Попробую только фолбэк через воркер."
}

# 2) если есть проект — пробуем REST с OAuth токеном
$restOk = $false
if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
  $token = Get-AccessToken
  if ($null -eq $token) {
    Write-Warning "gcloud не найден или не даёт токен — пропускаю REST и перехожу к фолбэку."
  } else {
    if (-not [string]::IsNullOrWhiteSpace($PairKey)) {
      $doc = Get-RestDocByPairKey -ProjectId $ProjectId -PairKey $PairKey -AccessToken $token
      if ($null -ne $doc) {
        Write-Host "✅ REST: найден документ matches/$PairKey" -ForegroundColor Green
        $doc | ConvertTo-Json -Depth 20
        $restOk = $true
      } else {
        Write-Warning "REST: документ matches/$PairKey не найден или нет доступа."
      }
    } else {
      $docs = Get-RestLastMatches -ProjectId $ProjectId -Limit $Limit -AccessToken $token
      if ($docs.Count -gt 0) {
        Write-Host "✅ REST: получено $($docs.Count) последних матчей" -ForegroundColor Green
        foreach ($d in $docs) {
          $id = $d.name -replace ".*/documents/matches/",""
          Write-Host (" - " + $id)
        }
        $restOk = $true
      } else {
        Write-Warning "REST: не удалось получить последние матчи (0 шт.)."
      }
    }
  }
}

# 3) фолбэк на воркеровые отладочные ручки (если REST не сработал)
if (-not $restOk) {
  Write-Host "⤵ Фолбэк через воркеровые отладочные ручки" -ForegroundColor Yellow
  if (-not [string]::IsNullOrWhiteSpace($PairKey)) {
    $dbg = Get-WorkerDocByPairKeyFallback -BaseUrl $WorkerUrl -PairKey $PairKey
    if ($null -ne $dbg -and $dbg.exists -eq $true) {
      Write-Host "✅ Fallback: найден документ matches/$PairKey" -ForegroundColor Green
      $dbg | ConvertTo-Json -Depth 20
      exit 0
    } else {
      Write-Warning "Fallback: документ matches/$PairKey не найден (или нет отладочного эндпоинта)."
      exit 2
    }
  } else {
    $list = Get-WorkerLastMatchesFallback -BaseUrl $WorkerUrl -Limit $Limit
    if ($list.Count -gt 0) {
      Write-Host "✅ Fallback: получено $($list.Count) последних матчей" -ForegroundColor Green
      foreach ($row in $list) {
        $id = $row.id
        Write-Host (" - " + $id)
      }
      exit 0
    } else {
      Write-Warning "Fallback: не удалось получить список матчей (возможно, эндпоинт не реализован)."
      exit 3
    }
  }
}

exit 0
