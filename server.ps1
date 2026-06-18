param(
  [string]$HostName = "0.0.0.0",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $root "data"
$vaultFile = Join-Path $dataDir "diary-vault.json"
$maxBodyBytes = 30MB
$ipAddress = if ($HostName -eq "0.0.0.0") {
  [System.Net.IPAddress]::Any
} else {
  [System.Net.IPAddress]::Parse($HostName)
}
$listener = [System.Net.Sockets.TcpListener]::new($ipAddress, $Port)

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html"; break }
    ".css" { "text/css"; break }
    ".js" { "application/javascript"; break }
    ".json" { "application/json"; break }
    ".png" { "image/png"; break }
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".svg" { "image/svg+xml"; break }
    default { "application/octet-stream" }
  }
}

function Get-Vault {
  if (-not (Test-Path -LiteralPath $vaultFile)) {
    return @{ auth = $null; entries = $null; updatedAt = $null }
  }

  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $vaultFile | ConvertFrom-Json
  } catch {
    return @{ auth = $null; entries = $null; updatedAt = $null }
  }
}

function Resolve-StaticPath {
  param([string]$UrlPath)

  $relative = [Uri]::UnescapeDataString($UrlPath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($relative)) {
    $relative = "index.html"
  }

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
  $rootPath = [System.IO.Path]::GetFullPath($root)

  if (-not $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  return $fullPath
}

function New-HttpResponse {
  param(
    [int]$StatusCode,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType = "text/plain"
  )

  $headers = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType; charset=utf-8",
    "Content-Length: $($Body.Length)",
    "Cache-Control: no-store",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type, Accept",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $response = [byte[]]::new($headerBytes.Length + $Body.Length)
  [Array]::Copy($headerBytes, 0, $response, 0, $headerBytes.Length)
  [Array]::Copy($Body, 0, $response, $headerBytes.Length, $Body.Length)
  return $response
}

function ConvertTo-JsonBytes {
  param([object]$Value)

  return [System.Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 20))
}

function Read-HttpRequest {
  param([System.Net.Sockets.NetworkStream]$Stream)

  $buffer = [byte[]]::new(8192)
  $bytes = New-Object System.Collections.Generic.List[byte]
  $headerEnd = -1

  while ($headerEnd -lt 0) {
    $read = $Stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) {
      break
    }

    for ($i = 0; $i -lt $read; $i++) {
      $bytes.Add($buffer[$i])
    }

    $text = [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
    $headerEnd = $text.IndexOf("`r`n`r`n", [System.StringComparison]::Ordinal)
  }

  if ($headerEnd -lt 0) {
    throw "Invalid HTTP request"
  }

  $allBytes = $bytes.ToArray()
  $headerText = [System.Text.Encoding]::ASCII.GetString($allBytes, 0, $headerEnd)
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0] -split " "
  $headers = @{}

  foreach ($line in $lines[1..($lines.Length - 1)]) {
    $colon = $line.IndexOf(":")
    if ($colon -gt 0) {
      $headers[$line.Substring(0, $colon).Trim().ToLowerInvariant()] = $line.Substring($colon + 1).Trim()
    }
  }

  $contentLength = 0
  if ($headers.ContainsKey("content-length")) {
    $contentLength = [int]$headers["content-length"]
  }

  if ($contentLength -gt $maxBodyBytes) {
    throw "Request body is too large"
  }

  $bodyStart = $headerEnd + 4
  $bodyBytes = New-Object System.Collections.Generic.List[byte]
  for ($i = $bodyStart; $i -lt $allBytes.Length; $i++) {
    $bodyBytes.Add($allBytes[$i])
  }

  while ($bodyBytes.Count -lt $contentLength) {
    $read = $Stream.Read($buffer, 0, [Math]::Min($buffer.Length, $contentLength - $bodyBytes.Count))
    if ($read -le 0) {
      break
    }
    for ($i = 0; $i -lt $read; $i++) {
      $bodyBytes.Add($buffer[$i])
    }
  }

  return @{
    Method = $requestLine[0]
    Path = ($requestLine[1] -split "\?")[0]
    Body = $bodyBytes.ToArray()
  }
}

$listener.Start()
Write-Host "Diary server running at http://$HostName`:$Port"
Write-Host "Press Ctrl+C to stop."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $request = Read-HttpRequest -Stream $stream
      $method = $request.Method
      $path = $request.Path

      if ($path -eq "/api/diary") {
        if ($method -eq "GET") {
          $response = New-HttpResponse -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonBytes (Get-Vault)) -ContentType "application/json"
        } elseif ($method -eq "PUT") {
          $raw = [System.Text.Encoding]::UTF8.GetString($request.Body)
          $vault = $raw | ConvertFrom-Json
          if (-not (Test-Path -LiteralPath $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir | Out-Null
          }
          $vault | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $vaultFile
          $response = New-HttpResponse -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonBytes $vault) -ContentType "application/json"
        } elseif ($method -eq "OPTIONS") {
          $response = New-HttpResponse -StatusCode 204 -StatusText "No Content" -Body @() -ContentType "application/json"
        } else {
          $response = New-HttpResponse -StatusCode 405 -StatusText "Method Not Allowed" -Body ([System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed"))
        }
      } else {
        $filePath = Resolve-StaticPath -UrlPath $path
        if (-not $filePath -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
          $response = New-HttpResponse -StatusCode 404 -StatusText "Not Found" -Body ([System.Text.Encoding]::UTF8.GetBytes("Not Found"))
        } else {
          $response = New-HttpResponse -StatusCode 200 -StatusText "OK" -Body ([System.IO.File]::ReadAllBytes($filePath)) -ContentType (Get-ContentType -Path $filePath)
        }
      }

      $stream.Write($response, 0, $response.Length)
      $stream.Flush()
    } catch {
      $body = [System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      $response = New-HttpResponse -StatusCode 500 -StatusText "Server Error" -Body $body
      $client.GetStream().Write($response, 0, $response.Length)
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
