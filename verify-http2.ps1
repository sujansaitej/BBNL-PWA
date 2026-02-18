# ═══════════════════════════════════════════════════════════════════════════════
# BBNL CRM PWA - HTTP/2 Verification Script (PowerShell)
# ═══════════════════════════════════════════════════════════════════════════════
# Purpose: Verify HTTP/2 is enabled and working correctly (Windows)
# Usage: .\verify-http2.ps1 [domain]
# Example: .\verify-http2.ps1 bbnlnetmon.bbnl.in
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [string]$Domain = "bbnlnetmon.bbnl.in"
)

$URL = "https://$Domain/pwa/crm"

Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  BBNL CRM PWA - HTTP/2 Verification (Windows)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Domain: $Domain" -ForegroundColor White
Write-Host "  URL: $URL" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 1: PowerShell Version
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "✓ Check 1: PowerShell Version" -ForegroundColor Green
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Gray

$PSVersion = $PSVersionTable.PSVersion
Write-Host "  PowerShell Version: $PSVersion" -ForegroundColor White

if ($PSVersion.Major -ge 5) {
    Write-Host "  [OK] PowerShell version is sufficient" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] PowerShell 5.0+ recommended" -ForegroundColor Yellow
}

Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 2: Test HTTP/2 Connection
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "✓ Check 2: HTTP/2 Protocol Test" -ForegroundColor Green
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    # Test with Invoke-WebRequest (limited HTTP/2 support in Windows PowerShell)
    $response = Invoke-WebRequest -Uri $URL -UseBasicParsing -ErrorAction Stop
    
    Write-Host "  [OK] Server is responding" -ForegroundColor Green
    Write-Host "  Status Code: $($response.StatusCode)" -ForegroundColor White
    
    # Check if headers indicate HTTP/2
    if ($response.Headers -and $response.Headers.ContainsKey("Alt-Svc")) {
        Write-Host "  [INFO] Server advertises HTTP/2 support (Alt-Svc header present)" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "  ⚠️  Note: PowerShell Invoke-WebRequest doesn't show protocol version" -ForegroundColor Yellow
    Write-Host "  Use curl for accurate HTTP/2 testing (see below)" -ForegroundColor Yellow
    
} catch {
    Write-Host "  [ERROR] Failed to connect: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 3: Test with curl (if available)
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "✓ Check 3: curl HTTP/2 Test (Recommended)" -ForegroundColor Green
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Gray

$curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue

if ($curlPath) {
    Write-Host "  [OK] curl is available" -ForegroundColor Green
    
    # Check curl version
    $curlVersion = & curl.exe --version 2>&1 | Select-Object -First 1
    Write-Host "  $curlVersion" -ForegroundColor White
    
    # Test HTTP/2
    Write-Host ""
    Write-Host "  Testing HTTP/2 connection..." -ForegroundColor Cyan
    $curlOutput = & curl.exe -sI --http2 $URL 2>&1 | Select-Object -First 1
    
    Write-Host "  Response: $curlOutput" -ForegroundColor White
    Write-Host ""
    
    if ($curlOutput -match "HTTP/2") {
        Write-Host "  ✅ SUCCESS: Server is responding with HTTP/2" -ForegroundColor Green -BackgroundColor Black
    } elseif ($curlOutput -match "HTTP/1.1") {
        Write-Host "  ❌ FAILURE: Server is responding with HTTP/1.1" -ForegroundColor Red -BackgroundColor Black
        Write-Host "  This means HTTP/2 is NOT working!" -ForegroundColor Red
    } else {
        Write-Host "  ⚠️  WARNING: Could not determine protocol" -ForegroundColor Yellow
    }
    
} else {
    Write-Host "  [INFO] curl not found - Install curl for accurate HTTP/2 testing" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Install curl:" -ForegroundColor Cyan
    Write-Host "  - Download from: https://curl.se/windows/" -ForegroundColor White
    Write-Host "  - Or use: winget install curl" -ForegroundColor White
}

Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 4: SSL Certificate
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "✓ Check 4: SSL Certificate Check" -ForegroundColor Green
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $request = [System.Net.WebRequest]::Create("https://$Domain")
    $request.Method = "HEAD"
    $response = $request.GetResponse()
    
    if ($response -and $response.ResponseUri.Scheme -eq "https") {
        Write-Host "  [OK] SSL/TLS connection established" -ForegroundColor Green
        
        # Try to get certificate info
        $servicePoint = [System.Net.ServicePointManager]::FindServicePoint("https://$Domain")
        if ($servicePoint.Certificate) {
            $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]$servicePoint.Certificate
            Write-Host "  Subject: $($cert.Subject)" -ForegroundColor White
            Write-Host "  Issuer: $($cert.Issuer)" -ForegroundColor White
            Write-Host "  Valid From: $($cert.NotBefore)" -ForegroundColor White
            Write-Host "  Valid To: $($cert.NotAfter)" -ForegroundColor White
            
            if ($cert.NotAfter -lt (Get-Date)) {
                Write-Host "  [ERROR] Certificate has expired!" -ForegroundColor Red
            } elseif ($cert.NotAfter -lt (Get-Date).AddDays(30)) {
                Write-Host "  [WARNING] Certificate expires soon!" -ForegroundColor Yellow
            }
        }
    }
    
    $response.Close()
    
} catch {
    Write-Host "  [ERROR] SSL certificate check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 5: DNS Resolution
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "✓ Check 5: DNS Resolution" -ForegroundColor Green
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $dnsResult = Resolve-DnsName -Name $Domain -ErrorAction Stop
    Write-Host "  [OK] DNS resolution successful" -ForegroundColor Green
    
    foreach ($record in $dnsResult) {
        if ($record.Type -eq "A") {
            Write-Host "  IPv4: $($record.IPAddress)" -ForegroundColor White
        } elseif ($record.Type -eq "AAAA") {
            Write-Host "  IPv6: $($record.IPAddress)" -ForegroundColor White
        }
    }
    
} catch {
    Write-Host "  [ERROR] DNS resolution failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Verification Summary" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($curlPath) {
    $finalCheck = & curl.exe -sI --http2 $URL 2>&1 | Select-Object -First 1
    
    if ($finalCheck -match "HTTP/2") {
        Write-Host "  ✅ RESULT: HTTP/2 IS WORKING CORRECTLY" -ForegroundColor Green -BackgroundColor Black
        Write-Host ""
        Write-Host "  Your server is properly configured and serving content over HTTP/2." -ForegroundColor White
    } else {
        Write-Host "  ❌ RESULT: HTTP/2 IS NOT WORKING" -ForegroundColor Red -BackgroundColor Black
        Write-Host ""
        Write-Host "  Please check:" -ForegroundColor Yellow
        Write-Host "  1. nginx is configured with 'listen 443 ssl http2;'" -ForegroundColor White
        Write-Host "  2. SSL certificates are valid and properly installed" -ForegroundColor White
        Write-Host "  3. nginx has been reloaded after configuration changes" -ForegroundColor White
        Write-Host "  4. Stream servers also have HTTP/2 enabled" -ForegroundColor White
    }
} else {
    Write-Host "  ⚠️  Install curl to perform complete HTTP/2 verification" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Server appears to be responding, but protocol cannot be verified" -ForegroundColor White
    Write-Host "  without curl. Install curl for accurate testing." -ForegroundColor White
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Online Testing Tools
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "📊 Online HTTP/2 Testing Tools:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. KeyCDN HTTP/2 Test:" -ForegroundColor White
Write-Host "     https://tools.keycdn.com/http2-test" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. HTTP/2 Test by Google:" -ForegroundColor White
Write-Host "     https://http2.pro/" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. WebPageTest:" -ForegroundColor White
Write-Host "     https://www.webpagetest.org/" -ForegroundColor Gray
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# Browser Testing Instructions
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "🌐 Browser Testing:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Open Chrome/Edge DevTools (F12)" -ForegroundColor White
Write-Host "  2. Go to Network tab" -ForegroundColor White
Write-Host "  3. Visit: $URL" -ForegroundColor White
Write-Host "  4. Look at Protocol column - should show 'h2' (= HTTP/2)" -ForegroundColor White
Write-Host ""
Write-Host "  If you see 'http/1.1' instead of 'h2', HTTP/2 is not enabled!" -ForegroundColor Yellow
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
