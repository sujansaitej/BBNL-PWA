#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════════
# BBNL CRM PWA - HTTP/2 Verification Script
# ═══════════════════════════════════════════════════════════════════════════════
# Purpose: Verify HTTP/2 is enabled and working correctly
# Usage: bash verify-http2.sh [domain]
# Example: bash verify-http2.sh bbnlnetmon.bbnl.in
# ═══════════════════════════════════════════════════════════════════════════════

set -e

DOMAIN="${1:-bbnlnetmon.bbnl.in}"
URL="https://${DOMAIN}/pwa/crm"

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  BBNL CRM PWA - HTTP/2 Verification"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Domain: ${DOMAIN}"
echo "  URL: ${URL}"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 1: nginx Configuration
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 1: nginx Configuration"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v nginx &> /dev/null; then
    echo "  [OK] nginx is installed"
    nginx -v 2>&1 | head -n 1
    
    # Check if http2 is in config
    if sudo nginx -T 2>/dev/null | grep -q "listen.*443.*ssl.*http2"; then
        echo "  [OK] HTTP/2 is enabled in nginx configuration"
    else
        echo "  [WARNING] HTTP/2 might not be enabled in nginx configuration"
        echo "  Expected: listen 443 ssl http2;"
    fi
    
    # Test nginx config
    if sudo nginx -t 2>&1 | grep -q "successful"; then
        echo "  [OK] nginx configuration is valid"
    else
        echo "  [ERROR] nginx configuration has errors"
        sudo nginx -t
    fi
else
    echo "  [WARNING] nginx not found or not accessible"
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 2: SSL Certificate
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 2: SSL Certificate"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v openssl &> /dev/null; then
    CERT_INFO=$(echo | openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo "Failed")
    
    if [[ "$CERT_INFO" != "Failed" ]]; then
        echo "  [OK] SSL certificate is valid"
        echo "$CERT_INFO" | sed 's/^/       /'
    else
        echo "  [ERROR] Could not retrieve SSL certificate"
    fi
else
    echo "  [WARNING] openssl not found"
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 3: HTTP/2 Protocol Test (using curl)
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 3: HTTP/2 Protocol Test (curl)"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v curl &> /dev/null; then
    # Check curl version supports HTTP/2
    CURL_VERSION=$(curl --version | head -n 1)
    echo "  curl version: ${CURL_VERSION}"
    
    if curl --version | grep -q "HTTP2"; then
        echo "  [OK] curl supports HTTP/2"
        
        # Test actual HTTP/2 connection
        PROTOCOL=$(curl -sI --http2 "${URL}" | grep -i "^HTTP" | head -n 1)
        echo ""
        echo "  Response protocol: ${PROTOCOL}"
        
        if echo "${PROTOCOL}" | grep -q "HTTP/2"; then
            echo ""
            echo "  ✅ SUCCESS: Server is responding with HTTP/2"
        elif echo "${PROTOCOL}" | grep -q "HTTP/1.1"; then
            echo ""
            echo "  ❌ FAILURE: Server is responding with HTTP/1.1"
            echo "  This means HTTP/2 is NOT working!"
        else
            echo ""
            echo "  ⚠️  WARNING: Could not determine protocol"
        fi
    else
        echo "  [WARNING] curl does not support HTTP/2"
        echo "  Install a newer version of curl with HTTP/2 support"
    fi
else
    echo "  [ERROR] curl not found"
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 4: Node.js Backend
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 4: Node.js Backend"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v node &> /dev/null; then
    echo "  [OK] Node.js is installed"
    node --version
    
    # Check if server is running
    if curl -s http://localhost:3000/pwa/crm 2>&1 | grep -q "html"; then
        echo "  [OK] Node.js server is responding on localhost:3000"
    else
        echo "  [WARNING] Node.js server may not be running on localhost:3000"
    fi
else
    echo "  [ERROR] Node.js not found"
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 5: PM2 Process Manager (if installed)
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 5: PM2 Process Manager"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v pm2 &> /dev/null; then
    echo "  [OK] PM2 is installed"
    pm2 list | grep -E "(id|bbnl-crm)" || echo "  [WARNING] No PM2 processes found for bbnl-crm-pwa"
else
    echo "  [INFO] PM2 not installed (optional)"
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Check 6: Detailed Protocol Headers
# ───────────────────────────────────────────────────────────────────────────────
echo "✓ Check 6: Detailed Response Headers"
echo "───────────────────────────────────────────────────────────────────────────────"

if command -v curl &> /dev/null; then
    echo ""
    curl -sI --http2 "${URL}" | head -n 15
fi

echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  Verification Summary"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# Final test
if command -v curl &> /dev/null && curl --version | grep -q "HTTP2"; then
    FINAL_CHECK=$(curl -sI --http2 "${URL}" | grep -i "^HTTP" | head -n 1)
    
    if echo "${FINAL_CHECK}" | grep -q "HTTP/2"; then
        echo "  ✅ RESULT: HTTP/2 IS WORKING CORRECTLY"
        echo ""
        echo "  Your server is properly configured and serving content over HTTP/2."
    else
        echo "  ❌ RESULT: HTTP/2 IS NOT WORKING"
        echo ""
        echo "  Please check the following:"
        echo "  1. nginx is configured with 'listen 443 ssl http2;'"
        echo "  2. SSL certificates are valid and properly installed"
        echo "  3. nginx has been reloaded/restarted after configuration changes"
        echo "  4. Node.js server is running on localhost:3000"
        echo ""
        echo "  Deployment commands:"
        echo "  sudo cp nginx-http2.conf /etc/nginx/sites-available/bbnl-crm-pwa"
        echo "  sudo ln -sf /etc/nginx/sites-available/bbnl-crm-pwa /etc/nginx/sites-enabled/"
        echo "  sudo nginx -t && sudo systemctl reload nginx"
    fi
else
    echo "  ⚠️  Cannot perform final verification (curl with HTTP/2 support required)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# Online Testing Tools
# ───────────────────────────────────────────────────────────────────────────────
echo "📊 Online HTTP/2 Testing Tools:"
echo ""
echo "  1. KeyCDN HTTP/2 Test:"
echo "     https://tools.keycdn.com/http2-test"
echo ""
echo "  2. HTTP/2 Test by Google:"
echo "     https://http2.pro/"
echo ""
echo "  3. WebPageTest:"
echo "     https://www.webpagetest.org/"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
