# Swaps a locally built phonon-tts wasm into the extension, so a fix can be tested against
# the real engine.
#
#   pwsh -File scripts/swap-wasm.ps1 -WasmDir C:\Users\Reign\Projects\xn-ptts\ptts-wasm\pkg\wasm
#
# The original files are kept beside the extension in lib/phonon-tts/.upstream/ so the
# vendored package can be restored with -Restore.

param(
    [string]$WasmDir,
    [string]$Extension = (Split-Path -Parent $PSScriptRoot),
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'
$target = Join-Path $Extension 'lib\phonon-tts\wasm'
$backup = Join-Path $Extension 'lib\phonon-tts\.upstream'

if ($Restore) {
    if (-not (Test-Path $backup)) { throw "No backup at $backup to restore from." }
    Copy-Item (Join-Path $backup '*') $target -Force
    Write-Host "Restored the upstream wasm into $target"
    return
}

if (-not $WasmDir) { throw "Pass -WasmDir with the build output, or -Restore to put the upstream wasm back." }
if (-not (Test-Path $WasmDir)) { throw "No such directory: $WasmDir" }

if (-not (Test-Path $backup)) {
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    Copy-Item (Join-Path $target '*') $backup -Force
    Write-Host "Backed the original wasm up to $backup"
}

$copied = @()
foreach ($name in @('phonon_tts_bg.wasm', 'phonon_tts_simd_bg.wasm', 'phonon_tts.js')) {
    $source = Join-Path $WasmDir $name
    if (Test-Path $source) {
        Copy-Item $source (Join-Path $target $name) -Force
        $copied += $name
    }
}

if ($copied.Count -eq 0) {
    throw "Nothing to copy from $WasmDir. Expected phonon_tts_bg.wasm there."
}

Write-Host "Swapped into $target :"
foreach ($name in $copied) {
    $size = (Get-Item (Join-Path $target $name)).Length
    Write-Host ("  {0,-26} {1,12:N0} bytes" -f $name, $size)
}
