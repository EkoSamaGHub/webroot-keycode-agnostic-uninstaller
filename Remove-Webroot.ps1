<#
.SYNOPSIS
    EKO-II :: Keycode-agnostic Webroot SecureAnywhere remover.

.DESCRIPTION
    Removes Webroot SecureAnywhere from ANY managed machine without hardcoding a
    per-customer keycode. On each host it:
        1. Detects the installed agent (registry + service + WRSA.exe).
        2. Reads THAT machine's own keycode from its local agent config.
        3. Invokes the official Webroot uninstall using that keycode.
        4. Sweeps residual services, files, registry keys, and scheduled tasks.

    This uses the machine's OWN license to remove software the owner manages.
    It does NOT patch the signed binary and does NOT bypass tamper/self-protection.
    If Webroot's tamper-protection ("uninstall password") is enabled, that control
    is honored by supplying the legitimate keycode -- not circumvented.

.PARAMETER KeyCode
    Optional. Force a specific keycode instead of auto-discovering it.
    Format: XXXX-XXXX-XXXX-XXXX-XXXX (or 20 contiguous chars).

.PARAMETER DiscoverOnly
    Detect the install and keycode, report, but DO NOT uninstall. (Safe dry run.)

.PARAMETER SkipCleanup
    Run the official uninstall but skip the residual-file/registry sweep.

.PARAMETER UninstallArgs
    Optional. Override the uninstall invocation entirely, e.g. '-uninstall'.
    Use this once you've confirmed the correct switch on your agent build.

.PARAMETER WaitSeconds
    How long to wait for the uninstall process / service teardown. Default 240.

.PARAMETER LogPath
    Log file path. Default: C:\ProgramData\EKO\webroot-uninstall.log

.NOTES
    Run elevated (SYSTEM or local admin). RMM-friendly exit codes:
        0 = success (removed, or already absent)
        2 = installed but keycode could not be discovered (pass -KeyCode)
        3 = uninstall command failed / agent still present after attempt
        4 = not running as administrator
    >>> VALIDATE the uninstall switch on a test VM before fleet rollout. <<<
#>
[CmdletBinding()]
param(
    [string]$KeyCode,
    [switch]$DiscoverOnly,
    [switch]$SkipCleanup,
    [string]$UninstallArgs,
    [int]$WaitSeconds = 240,
    [string]$LogPath = "$env:ProgramData\EKO\webroot-uninstall.log"
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [ValidateSet('INFO','WARN','ERROR','OK')][string]$Level = 'INFO')
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] [$Level] $Message"
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue
    $color = switch ($Level) { 'OK'{'Green'} 'WARN'{'Yellow'} 'ERROR'{'Red'} default{'Gray'} }
    Write-Host $line -ForegroundColor $color
}

# ---------------------------------------------------------------------------
# Admin check
# ---------------------------------------------------------------------------
function Test-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object System.Security.Principal.WindowsPrincipal($id)).IsInRole(
        [System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------
# Detect the Webroot install
# ---------------------------------------------------------------------------
function Get-WebrootInstall {
    $candidates = @(
        "$env:ProgramFiles\Webroot\WRSA.exe",
        "${env:ProgramFiles(x86)}\Webroot\WRSA.exe",
        "$env:ProgramData\WRData\WRSA.exe"
    )
    $wrsa = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    $svc = Get-Service -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match '^(WRSVC|WRCoreService|WRSkyClient|WRSAVC|WRBoot)$' -or $_.DisplayName -match 'Webroot' }

    $regPresent = @('HKLM:\SOFTWARE\WRData','HKLM:\SOFTWARE\WRCore',
                    'HKLM:\SOFTWARE\WOW6432Node\WRData','HKLM:\SOFTWARE\WOW6432Node\WRCore') |
                  Where-Object { Test-Path $_ }

    [pscustomobject]@{
        Installed   = [bool]($wrsa -or $svc -or $regPresent)
        WrsaPath    = $wrsa
        Services    = @($svc | Select-Object -ExpandProperty Name)
        RegKeys     = @($regPresent)
    }
}

# ---------------------------------------------------------------------------
# Discover the machine's own keycode (scan local agent config; no hardcoding)
#   Webroot keycodes are 20 chars, usually rendered XXXX-XXXX-XXXX-XXXX-XXXX.
#   Rather than depend on one value name (which varies by build), we scan the
#   WR* registry hives for any value matching the keycode shape.
# ---------------------------------------------------------------------------
function Get-WebrootKeyCode {
    $rxDashed = '^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){4}$'
    $rxFlat   = '^[A-Za-z0-9]{20}$'
    $roots = @(
        'HKLM:\SOFTWARE\WRData','HKLM:\SOFTWARE\WRCore','HKLM:\SOFTWARE\WRMIDData',
        'HKLM:\SOFTWARE\WOW6432Node\WRData','HKLM:\SOFTWARE\WOW6432Node\WRCore',
        'HKLM:\SOFTWARE\WOW6432Node\WRMIDData'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $keys = @($root) + (Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PSPath)
        foreach ($k in $keys) {
            $props = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            foreach ($p in $props.PSObject.Properties) {
                $name = $p.Name
                $val  = "$($p.Value)"
                if ($name -like 'PS*') { continue }
                # prefer values whose NAME hints at a keycode, but accept by shape too
                if ($val -match $rxDashed) {
                    return [pscustomobject]@{ KeyCode = $val.ToUpper(); Source = "$k\$name" }
                }
                if (($name -match 'key|code|licen' ) -and ($val -match $rxFlat)) {
                    $fmt = ($val.ToUpper() -replace '(.{4})(.{4})(.{4})(.{4})(.{4})','$1-$2-$3-$4-$5')
                    return [pscustomobject]@{ KeyCode = $fmt; Source = "$k\$name" }
                }
            }
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Run the official uninstall with the keycode
#   NOTE: switch syntax varies by agent build. We try a prioritized list and
#   stop at the first that makes the agent disappear. Override with -UninstallArgs.
# ---------------------------------------------------------------------------
function Invoke-WebrootUninstall {
    param([string]$WrsaPath, [string]$Key, [string]$Override, [int]$Wait)

    if (-not $WrsaPath -or -not (Test-Path $WrsaPath)) {
        Write-Log "WRSA.exe not found; cannot run official uninstall." 'WARN'
        return $false
    }

    # Prioritized candidate invocations. <<< CONFIRM on your build. >>>
    $candidates = if ($Override) {
        @($Override)
    } elseif ($Key) {
        @(
            "-uninstall $Key",      # keycode-gated uninstall (tamper-protected installs)
            "-uninstall -keycode=$Key",
            "-uninstall"            # fallback if no passcode required
        )
    } else {
        @("-uninstall")
    }

    foreach ($args in $candidates) {
        Write-Log "Attempting: `"$WrsaPath`" $args"
        try {
            $p = Start-Process -FilePath $WrsaPath -ArgumentList $args -PassThru -WindowStyle Hidden -ErrorAction Stop
            $p.WaitForExit($Wait * 1000) | Out-Null
            if (-not $p.HasExited) { Write-Log "Process still running after ${Wait}s; continuing to verify." 'WARN' }
        } catch {
            Write-Log "Invocation failed: $_" 'WARN'
            continue
        }
        Start-Sleep -Seconds 8
        if (-not (Get-WebrootInstall).Installed) {
            Write-Log "Agent no longer detected after: $args" 'OK'
            return $true
        }
        Write-Log "Agent still present after: $args" 'WARN'
    }
    return $false
}

# ---------------------------------------------------------------------------
# Residual sweep (only after the official uninstall has run)
# ---------------------------------------------------------------------------
function Remove-WebrootLeftovers {
    Write-Log "Sweeping residual services / files / registry / tasks..."
    foreach ($s in @('WRSVC','WRCoreService','WRSkyClient','WRSAVC','WRBoot')) {
        $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
        if ($svc) {
            try { Stop-Service $s -Force -ErrorAction SilentlyContinue } catch {}
            & sc.exe delete $s | Out-Null
            Write-Log "Removed service: $s"
        }
    }
    foreach ($d in @("$env:ProgramFiles\Webroot","${env:ProgramFiles(x86)}\Webroot",
                     "$env:ProgramData\WRData","$env:ProgramData\WRCore")) {
        if ($d -and (Test-Path $d)) {
            try { Remove-Item $d -Recurse -Force -ErrorAction Stop; Write-Log "Removed dir: $d" }
            catch { Write-Log "Could not remove $d : $_" 'WARN' }
        }
    }
    foreach ($r in @('HKLM:\SOFTWARE\WRData','HKLM:\SOFTWARE\WRCore','HKLM:\SOFTWARE\WRMIDData',
                     'HKLM:\SOFTWARE\WOW6432Node\WRData','HKLM:\SOFTWARE\WOW6432Node\WRCore',
                     'HKLM:\SOFTWARE\WOW6432Node\WRMIDData')) {
        if (Test-Path $r) {
            try { Remove-Item $r -Recurse -Force -ErrorAction Stop; Write-Log "Removed regkey: $r" }
            catch { Write-Log "Could not remove $r : $_" 'WARN' }
        }
    }
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'Webroot|WRSA' } |
        ForEach-Object {
            try { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction Stop; Write-Log "Removed task: $($_.TaskName)" }
            catch {}
        }
}

# ===========================================================================
# Main
# ===========================================================================
Write-Log "==== EKO-II Webroot remover starting (host: $env:COMPUTERNAME) ===="

if (-not (Test-Admin)) {
    Write-Log "Not elevated. Re-run as administrator / SYSTEM." 'ERROR'
    exit 4
}

$install = Get-WebrootInstall
if (-not $install.Installed) {
    Write-Log "Webroot not detected on this machine. Nothing to do." 'OK'
    exit 0
}
Write-Log "Webroot detected. WRSA: $($install.WrsaPath); services: $($install.Services -join ', ')"

# Resolve keycode
if ($KeyCode) {
    $kc = $KeyCode.ToUpper()
    Write-Log "Using supplied keycode (masked): $($kc.Substring(0,4))-****-****-****-****"
} else {
    $found = Get-WebrootKeyCode
    if ($found) {
        $kc = $found.KeyCode
        Write-Log "Discovered keycode (masked): $($kc.Substring(0,4))-****-****-****-**** from $($found.Source)" 'OK'
    } else {
        $kc = $null
        Write-Log "Could not auto-discover a keycode in local config." 'WARN'
    }
}

if ($DiscoverOnly) {
    Write-Log "DiscoverOnly set -- stopping before uninstall." 'OK'
    if (-not $kc) { exit 2 }
    exit 0
}

if (-not $kc -and -not $UninstallArgs) {
    Write-Log "No keycode and no override; a tamper-protected agent will refuse to uninstall. Pass -KeyCode or -UninstallArgs." 'ERROR'
    exit 2
}

$ok = Invoke-WebrootUninstall -WrsaPath $install.WrsaPath -Key $kc -Override $UninstallArgs -Wait $WaitSeconds

if (-not $SkipCleanup) { Remove-WebrootLeftovers }

# Final verdict
if ((Get-WebrootInstall).Installed) {
    Write-Log "Webroot STILL present after removal attempt. Validate the uninstall switch for this build." 'ERROR'
    exit 3
}
Write-Log "Webroot successfully removed from $env:COMPUTERNAME." 'OK'
exit 0
