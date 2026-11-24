param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'))

$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'A 64-bit .NET Framework compiler is required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$binary = Join-Path $OutputDirectory 'OverclockConnect.exe'
$icon = Join-Path $PSScriptRoot 'OverclockConnect.ico'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$binary" "/win32icon:$icon" "/resource:$icon,OverclockConnect.ico,private" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Net.Http.dll /reference:System.Management.dll (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $PSScriptRoot 'Hardware.cs')
if ($LASTEXITCODE -ne 0) { throw 'OVERCLOCK Connect compilation failed.' }
Write-Output $binary
