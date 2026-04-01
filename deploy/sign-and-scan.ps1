# 数据运维工作台 - 代码签名 + 杀毒扫描脚本
# 运行环境：Windows PowerShell 5.1+ 或 PowerShell 7+
# 用法：.\deploy\sign-and-scan.ps1 [-SkipSign] [-SkipScan]
#
# 步骤：
#   1. 生成自签名代码签名证书（如 deploy/certs/DataOpsWorkbench.pfx 不存在）
#   2. 用 signtool 签名所有 exe 文件
#   3. 用 signtool 签名安装包
#   4. Windows Defender 扫描产物目录

param(
    [switch]$SkipSign,
    [switch]$SkipScan
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$CertDir = Join-Path $ScriptDir "certs"
$PfxPath = Join-Path $CertDir "DataOpsWorkbench.pfx"
$PfxPassword = "DataOps2026"
$DistDir = Join-Path $ProjectRoot "dist"
$SetupPattern = Join-Path $DistDir "DataOpsWorkbench-*-Setup.exe"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  数据运维工作台 - 签名 & 扫描" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: 生成自签名证书 ──────────────────────────────────────
if (-not $SkipSign) {
    if (-not (Test-Path $CertDir)) {
        New-Item -ItemType Directory -Path $CertDir -Force | Out-Null
    }

    if (-not (Test-Path $PfxPath)) {
        Write-Host "[Step 1] 生成自签名代码签名证书..." -ForegroundColor Yellow

        $cert = New-SelfSignedCertificate `
            -Type CodeSigningCert `
            -Subject "CN=DataOps Workbench (Self-Signed), O=DataOps Team" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddYears(3) `
            -KeyUsage DigitalSignature `
            -FriendlyName "DataOps Workbench Code Signing"

        $pfxSecure = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
        Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $pfxSecure | Out-Null

        # 清理证书存储中的临时证书
        Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue

        Write-Host "[OK] 证书已生成: $PfxPath" -ForegroundColor Green
        Write-Host "     有效期: 3 年" -ForegroundColor Gray
        Write-Host "     注意: 自签名证书在用户机器上会提示'未知发布者'" -ForegroundColor Gray
    } else {
        Write-Host "[Step 1] 证书已存在: $PfxPath" -ForegroundColor Green
    }

    # ── Step 2: 签名 exe 文件 ──────────────────────────────────────
    Write-Host ""
    Write-Host "[Step 2] 签名 exe 文件..." -ForegroundColor Yellow

    # 查找 signtool
    $signtool = $null
    $sdkPaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($pattern in $sdkPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object -Descending | Select-Object -First 1
        if ($found) {
            $signtool = $found.FullName
            break
        }
    }

    if (-not $signtool) {
        Write-Host "[WARN] signtool.exe 未找到。请安装 Windows SDK。" -ForegroundColor Red
        Write-Host "       跳过签名步骤。" -ForegroundColor Red
    } else {
        Write-Host "       使用 signtool: $signtool" -ForegroundColor Gray

        # 签名 dist/ 下所有 exe
        $exeFiles = Get-ChildItem -Path $DistDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue
        $signedCount = 0
        $failedCount = 0

        foreach ($exe in $exeFiles) {
            Write-Host "       签名: $($exe.Name)..." -NoNewline
            $result = & $signtool sign /f $PfxPath /p $PfxPassword /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 $exe.FullName 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host " OK" -ForegroundColor Green
                $signedCount++
            } else {
                # 时间戳服务不可用时尝试不带时间戳签名
                $result = & $signtool sign /f $PfxPath /p $PfxPassword /fd SHA256 $exe.FullName 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Host " OK (无时间戳)" -ForegroundColor Yellow
                    $signedCount++
                } else {
                    Write-Host " FAILED" -ForegroundColor Red
                    $failedCount++
                }
            }
        }

        Write-Host "[OK] 签名完成: $signedCount 成功, $failedCount 失败" -ForegroundColor Green
    }
} else {
    Write-Host "[SKIP] 跳过代码签名" -ForegroundColor Gray
}

# ── Step 3: Windows Defender 扫描 ──────────────────────────────
Write-Host ""
if (-not $SkipScan) {
    Write-Host "[Step 3] Windows Defender 扫描..." -ForegroundColor Yellow

    $defenderPath = "${env:ProgramFiles}\Windows Defender\MpCmdRun.exe"
    if (-not (Test-Path $defenderPath)) {
        Write-Host "[WARN] Windows Defender 未找到，跳过扫描" -ForegroundColor Red
    } else {
        $scanTarget = $DistDir
        Write-Host "       扫描目录: $scanTarget" -ForegroundColor Gray

        $scanResult = & $defenderPath -Scan -ScanType 3 -File $scanTarget 2>&1
        $scanOutput = $scanResult | Out-String

        if ($scanOutput -match "found no threats") {
            Write-Host "[OK] 扫描通过：未发现威胁" -ForegroundColor Green
        } elseif ($scanOutput -match "Threat") {
            Write-Host "[WARN] 发现威胁报告：" -ForegroundColor Red
            Write-Host $scanOutput -ForegroundColor Red
            Write-Host ""
            Write-Host "       如为 Nuitka 编译产物误报，记录后可忽略。" -ForegroundColor Yellow
            Write-Host "       后续可通过正式代码签名证书或提交微软误报申诉解决。" -ForegroundColor Yellow
        } else {
            Write-Host "[INFO] 扫描输出：" -ForegroundColor Gray
            Write-Host $scanOutput
        }

        # 输出扫描报告
        $reportPath = Join-Path $DistDir "defender-scan-report.txt"
        $reportContent = @"
Windows Defender 扫描报告
========================
扫描时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
扫描目录: $scanTarget
扫描结果:
$scanOutput
"@
        Set-Content -Path $reportPath -Value $reportContent -Encoding UTF8
        Write-Host "       报告已保存: $reportPath" -ForegroundColor Gray
    }
} else {
    Write-Host "[SKIP] 跳过杀毒扫描" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  完成！" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
