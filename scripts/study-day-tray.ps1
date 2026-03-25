param(
  [Parameter(Mandatory = $true)]
  [string]$RootDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$backgroundDir = Join-Path $RootDir '.local\background'
$pidPath = Join-Path $backgroundDir 'study-day.tray.pid.json'
$statusPath = Join-Path $backgroundDir 'study-day.status.json'
$logPath = Join-Path $backgroundDir 'study-day.log'
$statusJsonPath = $statusPath
$global:lastState = ''

[System.IO.Directory]::CreateDirectory($backgroundDir) | Out-Null

function Get-IconForState {
  param([string]$State)

  switch ($State) {
    'running' { return [System.Drawing.SystemIcons]::Information }
    'starting' { return [System.Drawing.SystemIcons]::Application }
    'completed' { return [System.Drawing.SystemIcons]::Shield }
    'failed' { return [System.Drawing.SystemIcons]::Error }
    'stopped' { return [System.Drawing.SystemIcons]::Warning }
    default { return [System.Drawing.SystemIcons]::Application }
  }
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-PidFile {
  $payload = @{
    pid = $PID
    startedAt = (Get-Date).ToString('o')
    rootDir = $RootDir
  } | ConvertTo-Json

  [System.IO.File]::WriteAllText($pidPath, $payload, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-PidFile {
  if (-not (Test-Path $pidPath)) {
    return
  }

  $current = Read-JsonFile -Path $pidPath
  if ($null -eq $current -or $current.pid -eq $PID) {
    Remove-Item -Path $pidPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-StatusModel {
  $status = Read-JsonFile -Path $statusPath
  if ($null -eq $status) {
    return [pscustomobject]@{
      state = 'not_running'
      message = 'No study-day background status yet.'
      updatedAt = ''
    }
  }

  $state = [string]$status.state
  if ([string]::IsNullOrWhiteSpace($state)) {
    $state = 'unknown'
  }

  return [pscustomobject]@{
    state = $state
    message = [string]$status.message
    updatedAt = [string]$status.updatedAt
  }
}

function Get-TooltipText {
  param([object]$Model)

  $text = "Study Day: $($Model.state)"
  if (-not [string]::IsNullOrWhiteSpace($Model.message)) {
    $text = "$text - $($Model.message)"
  }

  if ($text.Length -gt 63) {
    return $text.Substring(0, 63)
  }

  return $text
}

function Start-HiddenCommand {
  param([string]$Command)

  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $Command -WorkingDirectory $RootDir -WindowStyle Hidden
}

function Start-VisibleCommand {
  param([string]$Command)

  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $Command -WorkingDirectory $RootDir -WindowStyle Normal
}

$context = New-Object System.Windows.Forms.ApplicationContext
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Enabled = $false
$messageItem = New-Object System.Windows.Forms.ToolStripMenuItem
$messageItem.Enabled = $false
$menu.Items.Add($statusItem) | Out-Null
$menu.Items.Add($messageItem) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$startItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Start Background'
$startItem.add_Click({ Start-VisibleCommand 'npm.cmd run study-day' })
$menu.Items.Add($startItem) | Out-Null

$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Stop Background'
$stopItem.add_Click({ Start-HiddenCommand 'npm.cmd run study-day:stop' })
$menu.Items.Add($stopItem) | Out-Null

$openLogItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Open Log'
$openLogItem.add_Click({ if (Test-Path $logPath) { Start-Process -FilePath $logPath } })
$menu.Items.Add($openLogItem) | Out-Null

$openStatusItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Open Status JSON'
$openStatusItem.add_Click({ if (Test-Path $statusJsonPath) { Start-Process -FilePath $statusJsonPath } })
$menu.Items.Add($openStatusItem) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Exit Tray'
$exitItem.add_Click({
  $script:notifyIcon.Visible = $false
  $script:timer.Stop()
  Remove-PidFile
  $context.ExitThread()
})
$menu.Items.Add($exitItem) | Out-Null

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon = $notifyIcon
$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Visible = $true
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = 'Study Day Tray'
$notifyIcon.add_DoubleClick({ if (Test-Path $logPath) { Start-Process -FilePath $logPath } })

function Update-Ui {
  $model = Get-StatusModel
  $statusItem.Text = "State: $($model.state)"

  if ([string]::IsNullOrWhiteSpace($model.message)) {
    $messageItem.Text = 'Message: -'
  } else {
    $messageText = $model.message
    if ($messageText.Length -gt 60) {
      $messageText = $messageText.Substring(0, 60)
    }
    $messageItem.Text = "Message: $messageText"
  }

  $notifyIcon.Icon = Get-IconForState -State $model.state
  $notifyIcon.Text = Get-TooltipText -Model $model
  $stopItem.Enabled = $model.state -in @('starting', 'running')

  if ($global:lastState -ne $model.state) {
    $global:lastState = $model.state
    if ($model.state -in @('running', 'completed', 'failed')) {
      $notifyIcon.BalloonTipTitle = 'Study Day'
      $notifyIcon.BalloonTipText = Get-TooltipText -Model $model
      $notifyIcon.ShowBalloonTip(3000)
    }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$script:timer = $timer
$timer.Interval = 5000
$timer.add_Tick({ Update-Ui })

$context.add_ThreadExit({
  try {
    $notifyIcon.Visible = $false
    $timer.Stop()
    Remove-PidFile
    $notifyIcon.Dispose()
    $menu.Dispose()
    $timer.Dispose()
  } catch {
  }
})

Write-PidFile
Update-Ui
$timer.Start()
[System.Windows.Forms.Application]::Run($context)

