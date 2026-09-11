param([string]$Command = '', [string]$AppId = 'com.yrrlyb.aria')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Result($Operation, $Type) {
  $task = $asTask.MakeGenericMethod($Type).Invoke($null, @($Operation))
  if (-not $task.Wait(10000)) { throw 'WinRT operation timed out' }
  return $task.Result
}
$manager = Await-Result ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$results = @()
foreach ($session in $manager.GetSessions()) {
  if ($Command -and $session.SourceAppUserModelId -ne $AppId) { continue }
  $success = $null
  switch ($Command) {
    'play' { $success = Await-Result ($session.TryPlayAsync()) ([bool]) }
    'pause' { $success = Await-Result ($session.TryPauseAsync()) ([bool]) }
    'next' { $success = Await-Result ($session.TrySkipNextAsync()) ([bool]) }
    'previous' { $success = Await-Result ($session.TrySkipPreviousAsync()) ([bool]) }
  }
  $properties = Await-Result ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $info = $session.GetPlaybackInfo()
  $artworkHash = $null
  if ($properties.Thumbnail -and $session.SourceAppUserModelId -eq $AppId) {
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $stream = Await-Result ($properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $randomType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $inputStream = $randomType.GetMethod('GetInputStreamAt').Invoke($stream, @([uint64]0))
    $readerType = [Windows.Storage.Streams.DataReader]
    $reader = $readerType.GetConstructors()[0].Invoke(@($inputStream))
    try {
      $size = $randomType.GetProperty('Size').GetValue($stream)
      $length = Await-Result ($reader.LoadAsync([uint32]$size)) ([uint32])
      $bytes = New-Object byte[] $length
      $reader.ReadBytes($bytes)
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try { $artworkHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    } finally { $reader.Dispose(); $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) }
  }
  $results += [pscustomobject]@{ appId = $session.SourceAppUserModelId; title = $properties.Title; artist = $properties.Artist; album = $properties.AlbumTitle; artwork = ($null -ne $properties.Thumbnail); artworkHash = $artworkHash; status = [string]$info.PlaybackStatus; next = $info.Controls.IsNextEnabled; previous = $info.Controls.IsPreviousEnabled; commandSuccess = $success }
}
ConvertTo-Json -InputObject @($results) -Compress
