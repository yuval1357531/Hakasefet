$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress)

# Plain TCP socket server (not HttpListener/http.sys) so binding to the
# LAN interface works without Administrator rights or a URL ACL reservation.
# Each accepted connection is handed off to its own runspace so one slow/
# large response (e.g. the background image) can't block other concurrent
# requests the browser opens in parallel.
$tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$tcpListener.Start()

Write-Host "Serving $root on http://localhost:$port/"
if ($lanIp) { Write-Host "LAN (phone) URL: http://$($lanIp):$port/" }

$handlerScript = {
    param($client, $root)

    function Get-ContentType([string]$ext) {
        switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".css"  { "text/css" }
            ".js"   { "application/javascript" }
            ".png"  { "image/png" }
            ".jpg"  { "image/jpeg" }
            ".jpeg" { "image/jpeg" }
            ".webp" { "image/webp" }
            ".svg"  { "image/svg+xml" }
            default { "application/octet-stream" }
        }
    }

    try {
        $client.NoDelay = $true
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)

        $requestLine = $reader.ReadLine()
        while (-not [string]::IsNullOrEmpty($reader.ReadLine())) { }

        $path = "login.html"
        if ($requestLine -match '^(GET|HEAD)\s+(\S+)\s+HTTP') {
            $reqPath = ($matches[2] -split '\?')[0]
            $reqPath = [System.Uri]::UnescapeDataString($reqPath).TrimStart('/')
            if ($reqPath) { $path = $reqPath }
        }

        $filePath = Join-Path $root $path

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $contentType = Get-ContentType ([System.IO.Path]::GetExtension($filePath))
            $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($bytes, 0, $bytes.Length)
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
            $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($body, 0, $body.Length)
        }
        $stream.Flush()
    } catch {
    } finally {
        $client.Close()
    }
}

while ($true) {
    $client = $tcpListener.AcceptTcpClient()
    $ps = [PowerShell]::Create()
    [void]$ps.AddScript($handlerScript).AddArgument($client).AddArgument($root)
    # Fire-and-forget: this is a short-lived dev server, so we don't wait
    # on or clean up finished handles — the accept loop must never block.
    [void]$ps.BeginInvoke()
}
