param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json

function Fail([string]$Code, [string]$Message) {
    $exception = New-Object System.Exception($Message)
    $exception.Data['SystemCode'] = $Code
    throw $exception
}
function Identity($Process) {
    return @{ pid = $Process.Id; startedAt = $Process.StartTime.ToUniversalTime().ToString('o') }
}
function Find-Identity([int]$ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try { return Identity $process } catch { Fail 'PERMISSION' "Cannot read the start identity of PID $ProcessId. Run the console server with the required account permissions." }
}
function Stop-Identity($Expected) {
    if ($Expected.pid -le 4 -or $inputData.protectedPids -contains $Expected.pid -or $Expected.pid -eq $PID) { Fail 'PROTECTED_PROCESS' 'The console, its parent and system processes cannot be terminated.' }
    $process = Get-Process -Id $Expected.pid -ErrorAction SilentlyContinue
    if (-not $process) { Fail 'PROCESS_GONE' 'The process has already exited.' }
    # Opening the handle before comparing StartTime binds this operation to the process,
    # even if the OS reuses its PID between the identity check and Kill().
    $null = $process.Handle
    if ($process.ProcessName -match '^(System|Idle|Registry|Secure System|smss|csrss|wininit|services|lsass|winlogon|svchost|dwm)$') { Fail 'PROTECTED_PROCESS' 'A protected Windows system process cannot be terminated.' }
    $actual = Identity $process
    if ($actual.startedAt -cne $Expected.startedAt) { Fail 'IDENTITY_MISMATCH' 'PID was reused; the current process was not terminated.' }
    $process.Kill()
    if (-not $process.WaitForExit(10000)) { Fail 'STOP_TIMEOUT' 'The process did not exit within ten seconds.' }
}
function Initialize-Argv {
    if ('BabelConsole.NativeArgv' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace BabelConsole {
    public static class NativeArgv {
        [DllImport("shell32.dll", SetLastError=true)] private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string cmd, out int count);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr ptr);
        public static string[] Parse(string value) {
            int count; IntPtr ptr = CommandLineToArgvW(value, out count);
            if (ptr == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            try { var result = new string[count]; for (int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(ptr, i*IntPtr.Size)); return result; }
            finally { LocalFree(ptr); }
        }
    }
}
'@
}
function Arguments-Match($Expected, $Actual, $Service) {
    $expectedArgs = @($Expected)
    $actualArgs = @($Actual)
    # This registered proxy launcher expands "auto" into one child per local address.
    # Match the exact script and all fixed options, never a broad powershell.exe name.
    $proxy = ($expectedArgs -contains '-File') -and ($expectedArgs -contains '-ListenAddress') -and ($expectedArgs -contains 'auto')
    if ($proxy) {
        $fileIndex = [Array]::IndexOf($expectedArgs, '-File')
        $proxy = ($fileIndex -ge 0 -and $fileIndex + 1 -lt $expectedArgs.Count -and [IO.Path]::GetFileName($expectedArgs[$fileIndex + 1]) -ieq 'gitlab-wsl-lan-proxy.ps1')
    }
    if ($proxy -and $actualArgs.Count -eq $expectedArgs.Count + 2 -and $actualArgs[-2] -ieq '-LogPath' -and $Service.logPath -and $actualArgs[-1] -ieq $Service.logPath) { $actualArgs = @($actualArgs[0..($actualArgs.Count - 3)]) }
    if ($actualArgs.Count -ne $expectedArgs.Count) { return $false }
    for ($i = 0; $i -lt $expectedArgs.Count; $i++) {
        if ($expectedArgs[$i] -ceq $actualArgs[$i]) { continue }
        if ($proxy -and $i -gt 0 -and $expectedArgs[$i - 1] -ieq '-ListenAddress' -and $expectedArgs[$i] -ceq 'auto') {
            $address = $null
            if ([Net.IPAddress]::TryParse($actualArgs[$i], [ref]$address) -and $address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { continue }
        }
        return $false
    }
    return $true
}
function Matched-Processes($Service) {
    if (-not $Service.executable) { return @() }
    Initialize-Argv
    $matches = @()
    foreach ($item in @(Get-CimInstance Win32_Process)) {
        if (-not $item.ExecutablePath -or $item.ExecutablePath -ine $Service.executable -or -not $item.CommandLine) { continue }
        $parsed = [BabelConsole.NativeArgv]::Parse($item.CommandLine)
        $arguments = @()
        if ($parsed.Count -gt 1) { $arguments = @($parsed[1..($parsed.Count - 1)]) }
        $expected = @()
        if ($null -ne $Service.args) { $expected = @($Service.args) }
        if (-not (Arguments-Match $expected $arguments $Service)) { continue }
        $identity = Find-Identity $item.ProcessId
        if ($identity) { $matches += $identity }
    }
    return @($matches)
}
function Shortcut-Paths($Service) {
    if (-not $Service.shortcutPath -or -not $Service.startupPath) { Fail 'INVALID_ARGUMENT' 'Both persistent shortcutPath and Startup destination startupPath are required.' }
    $source = [IO.Path]::GetFullPath($Service.shortcutPath)
    $destination = [IO.Path]::GetFullPath($Service.startupPath)
    $startup = [Environment]::GetFolderPath('Startup')
    $common = [Environment]::GetFolderPath('CommonStartup')
    if ([IO.Path]::GetDirectoryName($destination) -ine $startup -and [IO.Path]::GetDirectoryName($destination) -ine $common) { Fail 'INVALID_ARGUMENT' 'Startup destination must be directly inside a Windows Startup folder.' }
    if ([IO.Path]::GetExtension($source) -ine '.lnk' -or [IO.Path]::GetExtension($destination) -ine '.lnk' -or $source -ieq $destination) { Fail 'INVALID_ARGUMENT' 'The persistent .lnk source and Startup .lnk destination must be different paths.' }
    return @{ source = $source; destination = $destination }
}
function Set-ShortcutAutostart($Service, [bool]$Enabled) {
    $paths = Shortcut-Paths $Service
    if (-not (Test-Path -LiteralPath $paths.source -PathType Leaf)) { Fail 'NOT_FOUND' 'The persistent shortcut source does not exist.' }
    if (Test-Path -LiteralPath $paths.destination) {
        $sourceHash = (Get-FileHash -LiteralPath $paths.source -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $paths.destination -Algorithm SHA256).Hash
        if ($sourceHash -cne $targetHash) { Fail 'CONFLICT' 'Startup shortcut differs from the registered source. Preserve it and review the local registration before changing it.' }
        if (-not $Enabled) { Remove-Item -LiteralPath $paths.destination }
    } elseif ($Enabled) { Copy-Item -LiteralPath $paths.source -Destination $paths.destination }
}
function Registered-Task($Service) {
    $taskPath = $Service.taskPath
    if (-not $taskPath) { $taskPath = '\' }
    $tasks = @(Get-ScheduledTask -TaskPath $taskPath | Where-Object { $_.TaskName -ceq $Service.target -and $_.TaskPath -ceq $taskPath })
    if ($tasks.Count -ne 1) { Fail 'NOT_FOUND' 'The registered scheduled task does not exist.' }
    return $tasks[0]
}
function Autostart-Triggers($Task) { return @($Task.Triggers | Where-Object { $_.CimClass.CimClassName -in @('MSFT_TaskBootTrigger', 'MSFT_TaskLogonTrigger') }) }
function Read-Events($Filter, [string]$LogName) {
    try {
        if ($Filter) { return @(Get-WinEvent -FilterHashtable $Filter -MaxEvents 1000 -ErrorAction Stop) }
        return @(Get-WinEvent -LogName $LogName -MaxEvents 1000 -ErrorAction Stop)
    } catch {
        if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { return @() }
        throw
    }
}
function Inspect-Service($Service) {
    $result = @{ state = 'unknown'; processes = @(); autostart = @{ enabled = $null; trigger = 'unknown' } }
    switch ($Service.kind) {
        'windows-service' {
            $service = Get-CimInstance Win32_Service -Filter ("Name='" + $Service.target + "'")
            if (-not $service) { $result.state = 'unavailable'; $result.message = 'Windows service is not installed.'; return $result }
            $result.state = switch ($service.State) { 'Running' { 'running' } 'Stopped' { 'stopped' } 'Start Pending' { 'starting' } 'Stop Pending' { 'stopping' } default { 'unknown' } }
            $result.autostart = @{ enabled = ($service.StartMode -eq 'Auto'); trigger = 'windows-boot'; detail = ('StartMode=' + $service.StartMode) }
            if ($service.ProcessId -gt 0) { $identity = Find-Identity $service.ProcessId; if ($identity) { $result.processes = @($identity) } }
        }
        'scheduled-task' {
            $task = Registered-Task $Service
            $triggers = @(Autostart-Triggers $task)
            $enabled = @($triggers | Where-Object { $_.Enabled -ne $false }).Count
            $result.autostart = @{ enabled = ($task.Settings.Enabled -and $enabled -gt 0); trigger = 'scheduled-logon/boot'; detail = "$enabled/$($triggers.Count) logon/boot triggers enabled; TaskEnabled=$($task.Settings.Enabled)" }
            $result.processes = @(Matched-Processes $Service)
            $result.state = if ($task.State -eq 'Running' -or $result.processes.Count -gt 0) { 'running' } else { 'stopped' }
            if (-not $task.Settings.Enabled) { $result.message = 'Task is disabled. A manual start temporarily enables the task and restores its disabled setting.' }
        }
        'startup-shortcut' {
            $paths = Shortcut-Paths $Service
            $result.autostart = @{ enabled = (Test-Path -LiteralPath $paths.destination -PathType Leaf); trigger = 'windows-logon' }
            $result.processes = @(Matched-Processes $Service)
            $result.state = if ($result.processes.Count -gt 0) { 'running' } elseif ($Service.executable) { 'stopped' } else { 'unknown' }
            if (-not $Service.executable) { $result.message = 'Configure executable and args to identify this shortcut process safely.' }
        }
        default { Fail 'UNSUPPORTED' 'This Windows service kind is unsupported.' }
    }
    return $result
}
function Control-Service($Service, [string]$Action) {
    switch ($Service.kind) {
        'windows-service' {
            $item = Get-Service -Name $Service.target
            if ($Action -in @('stop', 'restart') -and $item.Status -ne 'Stopped') { Stop-Service -InputObject $item; $item.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
            if ($Action -in @('start', 'restart')) { Start-Service -InputObject $item; $item.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }
        }
        'scheduled-task' {
            $task = Registered-Task $Service
            if ($Action -in @('stop', 'restart')) {
                $identities = @(Matched-Processes $Service)
                Stop-ScheduledTask -InputObject $task
                foreach ($identity in $identities) { $current = Find-Identity $identity.pid; if ($current -and $current.startedAt -ceq $identity.startedAt) { Stop-Identity $identity } }
            }
            if ($Action -in @('start', 'restart')) {
                $wasEnabled = [bool]$task.Settings.Enabled
                try {
                    if (-not $wasEnabled) { $null = Enable-ScheduledTask -InputObject $task }
                    Start-ScheduledTask -InputObject $task
                    # The scheduler can acknowledge a request before creating the process.
                    # Keep the temporary enabled window until launch is observable.
                    $launched = $false
                    for ($attempt = 0; $attempt -lt 40; $attempt++) {
                        $current = Registered-Task $Service
                        if ($current.State -eq 'Running' -or @(Matched-Processes $Service).Count -gt 0) { $launched = $true; break }
                        Start-Sleep -Milliseconds 250
                    }
                    if (-not $launched) { Fail 'START_FAILED' 'The task start was acknowledged but no running task or exact registered process was observed.' }
                } finally {
                    if (-not $wasEnabled) {
                        $null = Disable-ScheduledTask -InputObject $task
                        if ((Registered-Task $Service).Settings.Enabled) { Fail 'RESTORE_FAILED' 'The temporary manual start could not restore the disabled task setting. Review this task in Task Scheduler.' }
                    }
                }
            }
        }
        'startup-shortcut' {
            $paths = Shortcut-Paths $Service
            if (-not $Service.executable) { Fail 'INVALID_ARGUMENT' 'Shortcut control requires an exact configured executable and args.' }
            $identities = @(Matched-Processes $Service)
            if ($Action -in @('stop', 'restart')) { foreach ($identity in $identities) { Stop-Identity $identity } }
            if ($Action -eq 'restart' -or ($Action -eq 'start' -and $identities.Count -eq 0)) {
                if (-not (Test-Path -LiteralPath $paths.source -PathType Leaf)) { Fail 'NOT_FOUND' 'The persistent shortcut source does not exist.' }
                Initialize-Argv
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut($paths.source)
                $parsed = [BabelConsole.NativeArgv]::Parse('placeholder ' + $shortcut.Arguments)
                $arguments = @()
                if ($parsed.Count -gt 1) { $arguments = @($parsed[1..($parsed.Count - 1)]) }
                $expected = @()
                if ($null -ne $Service.args) { $expected = @($Service.args) }
                if ($shortcut.TargetPath -ine $Service.executable -or -not (Arguments-Match $expected $arguments $Service)) { Fail 'CONFLICT' 'Shortcut target/arguments differ from the local service registration.' }
                # ShellExecute=false prevents .lnk RunAs flags or executable manifests
                # from opening an unsolicited elevation dialog.
                $startInfo = New-Object Diagnostics.ProcessStartInfo
                $startInfo.FileName = $Service.executable
                $startInfo.Arguments = $shortcut.Arguments
                $startInfo.UseShellExecute = $false
                $startInfo.CreateNoWindow = $true
                if ($Service.cwd) { $startInfo.WorkingDirectory = $Service.cwd }
                elseif ($shortcut.WorkingDirectory) { $startInfo.WorkingDirectory = $shortcut.WorkingDirectory }
                $null = [Diagnostics.Process]::Start($startInfo)
            }
        }
        default { Fail 'UNSUPPORTED' 'This Windows service kind is unsupported.' }
    }
}

try {
    $value = $null
    switch ($inputData.operation) {
        'disks' { $value = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ name = $_.DeviceID; totalBytes = [double]$_.Size; freeBytes = [double]$_.FreeSpace } }) }
        'identity' { $value = Find-Identity $inputData.pid }
        'processes' {
            $parents = @{}
            foreach ($item in @(Get-CimInstance Win32_Process)) { $parents[[int]$item.ProcessId] = [int]$item.ParentProcessId }
            $value = @(foreach ($item in @(Get-Process)) {
                $startedAt = ''; $executable = $null; $cpu = $null
                try { $startedAt = $item.StartTime.ToUniversalTime().ToString('o'); $executable = $item.Path; $cpu = $item.TotalProcessorTime.TotalMilliseconds } catch { }
                @{ pid = $item.Id; startedAt = $startedAt; name = $item.ProcessName; parentPid = $parents[$item.Id]; cpuPercent = $null; cpuMilliseconds = $cpu; memoryBytes = [double]$item.WorkingSet64; executable = $executable }
            })
        }
        'terminate' { Stop-Identity $inputData.identity }
        'inspect' { $value = Inspect-Service $inputData.service }
        'control' { Control-Service $inputData.service $inputData.action }
        'shortcut-autostart' { $paths = Shortcut-Paths $inputData.service; $value = @{ enabled = (Test-Path -LiteralPath $paths.destination -PathType Leaf) } }
        'set-shortcut-autostart' { Set-ShortcutAutostart $inputData.service $inputData.enabled }
        'autostart' {
            $service = $inputData.service
            switch ($service.kind) {
                'windows-service' { $mode = if ($inputData.enabled) { 'Automatic' } else { 'Manual' }; Set-Service -Name $service.target -StartupType $mode }
                'scheduled-task' {
                    $task = Registered-Task $service
                    $triggers = @(Autostart-Triggers $task)
                    if ($triggers.Count -eq 0) { Fail 'UNSUPPORTED' 'This task has no logon or boot triggers. Define one in Task Scheduler before editing autostart.' }
                    foreach ($trigger in $triggers) { $trigger.Enabled = [bool]$inputData.enabled }
                    $null = Set-ScheduledTask -InputObject $task
                    # An explicit enable request also clears a pre-existing task-level disable.
                    # Disabling autostart only disables boot/logon triggers, preserving manual start.
                    if ($inputData.enabled -and -not $task.Settings.Enabled) { $null = Enable-ScheduledTask -InputObject $task }
                }
                'startup-shortcut' { Set-ShortcutAutostart $service $inputData.enabled }
                default { Fail 'UNSUPPORTED' 'This Windows autostart kind is unsupported.' }
            }
        }
        'logs' {
            $service = $inputData.service
            if ($service.kind -eq 'startup-shortcut') { Fail 'UNSUPPORTED' 'Configure a logPath for this Startup shortcut.' }
            if ($service.kind -eq 'windows-service') {
                $events = @(Read-Events @{ LogName = 'System'; ProviderName = 'Service Control Manager' } '' | Where-Object { @($_.Properties.Value) -contains $service.target -or @($_.Properties.Value) -contains $service.label } | Select-Object -First $inputData.limit)
            } else {
                $taskPath = if ($service.taskPath) { $service.taskPath } else { '\' }
                $fullName = $taskPath + $service.target
                $events = @(Read-Events $null 'Microsoft-Windows-TaskScheduler/Operational' | Where-Object { @($_.Properties.Value) -contains $fullName } | Select-Object -First $inputData.limit)
            }
            $value = if ($events.Count -gt 0) { ($events | ForEach-Object { $_.TimeCreated.ToString('o') + ' [' + $_.Id + '] ' + $_.Message }) -join "`n" } else { 'No matching events were available in the latest 1000 events. The event channel may be disabled or require additional permissions.' }
        }
        default { Fail 'INVALID_ARGUMENT' 'Unknown Windows operation.' }
    }
    @{ ok = $true; value = $value } | ConvertTo-Json -Depth 12 -Compress
} catch {
    $code = $_.Exception.Data['SystemCode']
    if (-not $code) {
        $code = if ($_.Exception -is [UnauthorizedAccessException] -or $_.Exception.HResult -eq -2147024891 -or $_.CategoryInfo.Category -eq 'PermissionDenied' -or $_.Exception.Message -match 'access.*denied|permission|privilege|elevation|\u62d2\u7edd\u8bbf\u95ee|\u9700\u8981\u63d0\u5347') { 'PERMISSION' } else { 'COMMAND_FAILED' }
    }
    $message = $_.Exception.Message
    if ($code -eq 'PERMISSION') { $message += ' Run the console server manually with the required permissions; the console does not open elevation prompts.' }
    @{ ok = $false; error = @{ code = $code; message = $message } } | ConvertTo-Json -Depth 4 -Compress
}
