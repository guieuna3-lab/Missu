$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$launcherRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Split-Path -Parent $launcherRoot
$assetRoot = Join-Path $frontendRoot 'assets/app-icon'
$resourceRoot = Join-Path $launcherRoot 'src/main/res'
$icon = [System.Drawing.Image]::FromFile((Join-Path $assetRoot 'missu-figma.png'))
# Extract from the whole icon so text-only export backgrounds cannot enter the APK.
$wordmarkBounds = [System.Drawing.Rectangle]::new(191, 426, 657, 163)
$wordmark = $icon.Clone($wordmarkBounds, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$wordmark.MakeTransparent([System.Drawing.Color]::White)
$wordmark.Save((Join-Path $assetRoot 'missu-wordmark.png'), [System.Drawing.Imaging.ImageFormat]::Png)

function Save-IconImage {
    param($Image, [int]$Size, [System.Drawing.RectangleF]$Destination, [string]$Path)
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($Image, $Destination)
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    # Legacy launchers use the original rounded Figma icon at each Android density.
    $densities = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
    foreach ($density in $densities.GetEnumerator()) {
        $size = [int]$density.Value
        $destination = [System.Drawing.RectangleF]::new(0, 0, $size, $size)
        Save-IconImage $icon $size $destination (Join-Path $resourceRoot "mipmap-$($density.Key)/ic_launcher.png")
    }

    # 108dp layers contain a 72dp visible viewport, leaving 18dp on each side.
    # Preserve the wordmark's rendered bounds within Figma's 1024px icon.
    # Group 368:3340, text 368:3339; these offsets include Figma's optical alignment.
    $scale = 288.0 / 1024.0
    $destination = [System.Drawing.RectangleF]::new(
        (72 + $wordmarkBounds.X * $scale),
        (72 + $wordmarkBounds.Y * $scale),
        ($wordmarkBounds.Width * $scale),
        ($wordmarkBounds.Height * $scale)
    )
    Save-IconImage $wordmark 432 $destination (Join-Path $resourceRoot 'drawable-nodpi/ic_launcher_foreground.png')
} finally {
    $icon.Dispose()
    $wordmark.Dispose()
}
