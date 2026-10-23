<#
.SYNOPSIS
  Re-test of the Securepoint penetration-test report v1.0 (17.10.2026): replays the report's proof-of-concept requests against a DMS environment and prints PASS / FAIL for each.
  RUN AGAINST UAT FIRST (the requests change nothing when the fixes work, but if a fix is missing they WILL create or modify data).
.DESCRIPTION
  Tokens are not stored. Before running, put the bearer token of each test login in the session (copy it from the browser, or sign in via the API):
      $env:VAPT_DEALERADMIN_TOKEN  = '<DealerAdmin test login>'
      $env:VAPT_CAPTAIN_TOKEN      = '<Captain / ServiceAdvisor test login>'
      $env:VAPT_SUPERVISOR_TOKEN   = '<Supervisor / ViceCaptain test login>'
  Optional ids (tests that need them are skipped without them):  -OwnJobCardId (a job card of the Captain's dealer)  -OtherDealerJobCardId  -OtherDealerId
  Needs curl.exe (included with Windows 10 / 11) for the upload test.
.EXAMPLE
  .\Run-VaptRetest.ps1 -BaseUrl https://uat-dms.bgauss.com -OwnJobCardId <guid> -OtherDealerJobCardId <guid> -OtherDealerId <guid>
#>
param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [string]$OwnJobCardId,
    [string]$OtherDealerJobCardId,
    [string]$OtherDealerId
)

$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')
$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Invoke-Api {
    param([string]$Method, [string]$Path, [string]$Token, [string]$Body)
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $params = @{ Uri = "$BaseUrl$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true }
    if ($Body) { $params['Body'] = $Body; $params['ContentType'] = 'application/json' }
    try {
        $r = Invoke-WebRequest @params
        return @{ Status = [int]$r.StatusCode; Content = [string]$r.Content; Headers = $r.Headers }
    }
    catch {
        $status = 0
        $content = ''
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $content = $reader.ReadToEnd()
            } catch { }
        }
        return @{ Status = $status; Content = $content; Headers = @{} }
    }
}

function Get-Header {
    param($Headers, [string]$Name)
    try { return $Headers[$Name] } catch { return $null }
}

function Write-Result {
    param([string]$Id, [string]$Text, [bool]$Ok, [string]$Detail)
    if ($Ok) { $script:Pass++; Write-Host ("PASS  {0,-7} {1}" -f $Id, $Text) -ForegroundColor Green }
    else { $script:Fail++; Write-Host ("FAIL  {0,-7} {1}  -> {2}" -f $Id, $Text, $Detail) -ForegroundColor Red }
}

function Write-Skip {
    param([string]$Id, [string]$Text, [string]$Why)
    $script:Skip++
    Write-Host ("SKIP  {0,-7} {1}  ({2})" -f $Id, $Text, $Why) -ForegroundColor Yellow
}

function Test-Denied {
    param([string]$Id, [string]$Text, [string]$Method, [string]$Path, [string]$Token, [string]$Body)
    if (-not $Token) { Write-Skip $Id $Text 'token not set'; return }
    $r = Invoke-Api -Method $Method -Path $Path -Token $Token -Body $Body
    Write-Result $Id $Text (($r.Status -eq 403) -or ($r.Status -eq 401)) "expected 403, got $($r.Status)"
}

$dealerAdmin = $env:VAPT_DEALERADMIN_TOKEN
$captain = $env:VAPT_CAPTAIN_TOKEN
$supervisor = $env:VAPT_SUPERVISOR_TOKEN
$someGuid = [guid]::NewGuid().ToString()

Write-Host "Target: $BaseUrl" -ForegroundColor Cyan
Write-Host ''

# ---- High ---------------------------------------------------------------------------------------------------------------------------------------------------------------
Test-Denied 'DMS-01' 'DealerAdmin changes a role to SystemAdmin (PUT /api/users/{id})' 'PUT' "/api/users/$someGuid" $dealerAdmin '{"role":"SystemAdmin"}'
Test-Denied 'DMS-05' 'DealerAdmin creates a SystemAdmin (POST /api/users)' 'POST' '/api/users' $dealerAdmin '{"name":"vapt test","email":"vapt.test@example.invalid","role":"SystemAdmin"}'
Test-Denied 'DMS-05' 'role sent as a number is refused for a dealer login' 'POST' '/api/users' $dealerAdmin '{"name":"vapt test","email":"vapt.test@example.invalid","role":9}'
Test-Denied 'DMS-02' 'DealerAdmin reads the Azure directory (GET /api/admin/azure-directory/users)' 'GET' '/api/admin/azure-directory/users' $dealerAdmin ''
Test-Denied 'DMS-04' 'Captain writes a vehicle registration override' 'POST' '/api/vehicle-sale-overrides' $captain '{}'
Test-Denied 'DMS-04' 'Captain writes the menu / role matrix' 'PUT' '/api/menu-access' $captain '{}'
Test-Denied 'DMS-04' 'Captain writes the role modes' 'PUT' '/api/menu-access/role-modes' $captain '{}'

if ($captain -and $OtherDealerJobCardId) {
    $r = Invoke-Api -Method 'PUT' -Path "/api/jobcards/$OtherDealerJobCardId" -Token $captain -Body '{"assignedTechnicianName":"vapt"}'
    Write-Result 'DMS-07' "Captain edits ANOTHER dealer's job card (PUT)" ($r.Status -eq 403) "expected 403, got $($r.Status)"
    $r = Invoke-Api -Method 'POST' -Path "/api/jobcards/$OtherDealerJobCardId/inspections" -Token $captain -Body '{"component":"General","condition":"NeedsAttention","notes":"vapt"}'
    Write-Result 'DMS-07' "Captain adds an inspection to ANOTHER dealer's job card" ($r.Status -eq 403) "expected 403, got $($r.Status)"
} else { Write-Skip 'DMS-07' "cross-dealer job card write" 'needs -OtherDealerJobCardId and the Captain token' }

if ($captain -and $OtherDealerId) {
    $r = Invoke-Api -Method 'POST' -Path '/api/customers' -Token $captain -Body ("{`"dealerId`":`"$OtherDealerId`",`"name`":`"vapt test`",`"mobile`":`"9000000000`"}")
    Write-Result 'DMS-03' 'Captain creates a customer under another dealerId' ($r.Status -eq 403) "expected 403, got $($r.Status)"
} else { Write-Skip 'DMS-03' 'customer under another dealerId' 'needs -OtherDealerId and the Captain token' }

# ---- DMS-06 upload: an HTML file declared as image/png must be refused; if it is stored it must not be served as a page
if ($captain -and $OwnJobCardId) {
    $poc = Join-Path $env:TEMP 'poc.png.html'
    Set-Content -Path $poc -Value '<html><body>vapt-marker</body></html>'
    $out = & curl.exe -s -w "`n%{http_code}" -H "Authorization: Bearer $captain" -F "File=@$poc;type=image/png" -F 'Stage=CheckIn' "$BaseUrl/api/jobcards/$OwnJobCardId/photos/upload"
    $code = [int]($out | Select-Object -Last 1)
    Remove-Item $poc -ErrorAction SilentlyContinue
    Write-Result 'DMS-06' 'HTML file declared as image/png is refused at upload (needs SafeUpload wired into UploadPhoto)' (($code -ge 400) -and ($code -lt 500)) "got $code (the upload controller still accepts it - see tracker)"
} else { Write-Skip 'DMS-06' 'upload of an HTML file' 'needs -OwnJobCardId and the Captain token' }

# ---- Medium -------------------------------------------------------------------------------------------------------------------------------------------------------------
Test-Denied 'DMS-09' 'Supervisor writes the service catalogue' 'POST' '/api/service-menu-master' $supervisor '{}'
Test-Denied 'DMS-09' 'Supervisor writes the battery-warranty schemes' 'POST' '/api/extended-battery-warranty-schemes' $supervisor '{}'
Test-Denied 'DMS-10' 'Captain creates a workflow stage' 'POST' '/api/workflow-stages' $captain '{}'

$codes = @()
for ($i = 0; $i -lt 25; $i++) {
    $r = Invoke-Api -Method 'POST' -Path '/api/dealer-auth/login' -Token '' -Body ('{"email":"vapt.nobody@example.invalid","password":"wrong-' + $i + '"}')
    $codes += $r.Status
}
Write-Result 'DMS-11' '25 failed logins in a row get HTTP 429 at some point' ($codes -contains 429) ("statuses seen: " + (($codes | Select-Object -Unique) -join ','))

$r = Invoke-Api -Method 'GET' -Path '/' -Token '' -Body ''
$h = $r.Headers
foreach ($name in @('Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy')) {
    $present = ((Get-Header $h $name) -ne $null) -or (($name -eq 'Content-Security-Policy') -and ((Get-Header $h 'Content-Security-Policy-Report-Only') -ne $null))
    Write-Result 'DMS-13' "response header $name is present" $present 'missing'
}
if ($BaseUrl.StartsWith('https')) { Write-Result 'DMS-13' 'Strict-Transport-Security is present' ((Get-Header $h 'Strict-Transport-Security') -ne $null) 'missing (check the proxy passes X-Forwarded-Proto)' }
Write-Result 'DMS-13' 'X-Powered-By is absent' ((Get-Header $h 'X-Powered-By') -eq $null) 'still sent (merge deploy/web.config.security-snippet.xml)'

# ---- Low ----------------------------------------------------------------------------------------------------------------------------------------------------------------
if ($captain) {
    $r = Invoke-Api -Method 'GET' -Path '/api/dealers' -Token $captain -Body ''
    $leaks = 0
    try {
        $rows = $r.Content | ConvertFrom-Json
        foreach ($row in @($rows)) {
            foreach ($p in $row.PSObject.Properties) {
                if (($p.Name -match 'mail|phone|mobile|contact') -and $p.Value) { $leaks++; break }
            }
        }
    } catch { $leaks = -1 }
    Write-Result 'DMS-15' "GET /api/dealers shows contact details for at most the caller's own dealer" (($leaks -ge 0) -and ($leaks -le 1)) "rows with contact fields: $leaks"
} else { Write-Skip 'DMS-15' '/api/dealers contact fields' 'Captain token not set' }

Write-Host ''
Write-Host ("Result: {0} passed, {1} failed, {2} skipped." -f $script:Pass, $script:Fail, $script:Skip) -ForegroundColor Cyan
Write-Host 'Manual checks still needed: DMS-08 (negative price on a repair bill / suggestion), DMS-12 (OTP answers identical for registered and unregistered numbers; no devOtpCode), DMS-14 (photo URL without login), DMS-16 (token after sign-out).'
