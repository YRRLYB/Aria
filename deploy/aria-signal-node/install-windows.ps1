#Requires -Version 5.1
param(
  [int]$Port = 8787,
  [string]$InstallDir = "C:\AriaSignalNode",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
} catch {}

$TaskName = "AriaSignalNode"
$FirewallRuleName = "Aria Signal Node (TCP $Port)"
$RawServerUrl = "https://raw.githubusercontent.com/YRRLYB/Aria/test/macos-0.8.5/deploy/aria-signal-node/server.mjs"
$targetServerMjs = Join-Path $InstallDir "server.mjs"

function Stop-AriaSignalProcesses {
  param([string]$TargetScript)
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    $stoppedAny = $false
    foreach ($p in $procs) {
      if ($p.CommandLine -and $p.CommandLine.IndexOf($TargetScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        $stoppedAny = $true
      }
    }
    if ($stoppedAny) {
      Start-Sleep -Milliseconds 300
    }
  } catch {}
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "请以「管理员身份」运行 PowerShell 后再执行此脚本。"
  exit 1
}

if ($Uninstall) {
  Write-Host "[aria-signal] 正在卸载服务与防火墙规则..."
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  Stop-AriaSignalProcesses -TargetScript $targetServerMjs
  Get-NetFirewallRule -DisplayName "Aria Signal Node*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "[aria-signal] 已完成卸载与清理。"
  exit 0
}

function Get-NodeExe {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($candidate in @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe"
  )) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

$nodeExe = Get-NodeExe
$needInstallNode = $true
if ($nodeExe) {
  $majorStr = & $nodeExe -p "process.versions.node.split('.')[0]" 2>$null
  if ([int]($majorStr -as [int]) -ge 18) {
    $needInstallNode = $false
    $nodeVer = & $nodeExe -v
    Write-Host "[aria-signal] 检测到 Node.js $nodeVer ($nodeExe)"
  }
}

if ($needInstallNode) {
  Write-Host "[aria-signal] 未检测到 Node.js >= 18，正在自动安装 Node.js LTS..."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    try {
      & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
      $nodeExe = Get-NodeExe
    } catch {}
  }
  if (-not $nodeExe) {
    $effectiveArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = if ($effectiveArch -match "ARM64") { "arm64" } else { "x64" }
    $nodeVersion = "v20.19.0"
    try {
      $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 15
      $lts20 = $index | Where-Object { $_.version -like "v20.*" -and $_.lts } | Select-Object -First 1
      if ($lts20 -and $lts20.version) {
        $nodeVersion = [string]$lts20.version
      }
    } catch {}
    $msiUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-$arch.msi"
    $msiPath = Join-Path $env:TEMP "aria-node-$nodeVersion-$arch.msi"
    try {
      Write-Host "[aria-signal] 正在下载 Node.js $nodeVersion ($arch) 安装包..."
      Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 120
      Write-Host "[aria-signal] 正在静默安装 Node.js $nodeVersion..."
      $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$msiPath`"", "/qn", "/norestart") -Wait -PassThru
      if ($proc.ExitCode -ne 0) {
        Write-Warning "[aria-signal] msiexec 返回退出码 $($proc.ExitCode)"
      }
      $nodeExe = Get-NodeExe
    } catch {
      Write-Warning "[aria-signal] 自动下载安装 Node.js 失败: $($_.Exception.Message)"
    } finally {
      if (Test-Path $msiPath) {
        Remove-Item -Path $msiPath -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if (-not $nodeExe) {
    Write-Error "未找到 Node.js >= 18，请先安装 Node.js LTS (https://nodejs.org) 后重跑此脚本。"
    exit 1
  }
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$localServerMjs = Join-Path $scriptDir "server.mjs"

if (Test-Path $localServerMjs) {
  Copy-Item -Path $localServerMjs -Destination $targetServerMjs -Force
} else {
  Write-Host "[aria-signal] 正在下载 server.mjs..."
  Invoke-WebRequest -Uri $RawServerUrl -OutFile $targetServerMjs -UseBasicParsing
}

$launcherCmd = Join-Path $InstallDir "run-aria-signal.cmd"
$logFile = Join-Path $InstallDir "logs\signal.log"
$launcherContent = @(
  "@echo off"
  "set PORT=$Port"
  "set HOST=0.0.0.0"
  "`"$nodeExe`" `"$targetServerMjs`" --port $Port --host 0.0.0.0 >> `"$logFile`" 2>&1"
) -join "`r`n"
Set-Content -Path $launcherCmd -Value $launcherContent -Encoding ASCII

# Configure firewall rule
Get-NetFirewallRule -DisplayName "Aria Signal Node*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule `
  -DisplayName $FirewallRuleName `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $Port `
  -Action Allow | Out-Null

# Register & restart Windows Scheduled Task running at startup as SYSTEM
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}
Stop-AriaSignalProcesses -TargetScript $targetServerMjs

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$launcherCmd`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principalObj = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principalObj `
  -Settings $settings `
  -Description "Aria Listen-Together Signaling Node on TCP $Port" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 4
  if ($health.StatusCode -eq 200 -and $health.Headers["X-Aria-Signal"] -eq "1") {
    Write-Host "[aria-signal] 本地健康检查通过: http://127.0.0.1:$Port/health"
  }
} catch {
  Write-Warning "[aria-signal] 暂未收到本地健康响应，请查看日志: $logFile"
}

$publicIp = ""
try {
  $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 3).Trim()
} catch {
  $publicIp = ""
}
$localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1 -ExpandProperty IPAddress)
$displayIp = if ($publicIp) { $publicIp } elseif ($localIp) { $localIp } else { "你的服务器IP" }

Write-Host ""
Write-Host "========================================================"
Write-Host " Aria 自建信令节点部署完成！（Windows 开机自启任务已注册）"
Write-Host " 填入 Aria「网络设置 -> 信令服务器地址」："
Write-Host "   http://${displayIp}:${Port}"
Write-Host ""
Write-Host " 注意：若使用云服务器，请同时在云控制台安全组放行 TCP $Port。"
Write-Host " 查看任务: Get-ScheduledTask -TaskName $TaskName"
Write-Host " 查看日志: Get-Content `"$logFile`" -Tail 50"
Write-Host " 卸载清理: .\install-windows.ps1 -Uninstall"
Write-Host "========================================================"
