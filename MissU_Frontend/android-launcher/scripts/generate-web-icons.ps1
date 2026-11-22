$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$frontendRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = Join-Path $frontendRoot 'assets/app-icon/missu-figma.png'
$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
    # 같은 Figma 원본을 사용하고, iOS가 아이콘 외곽을 그리도록 투명 모서리만 흰색으로 채웁니다.
    $outputs = @{
        180 = 'public/missu-180-v2.png'
        192 = 'public/missu-192-v2.png'
        512 = 'public/missu-512-v2.png'
        1024 = 'assets/app-icon/missu-ios.png'
    }
    foreach ($entry in $outputs.GetEnumerator()) {
        $size = [int]$entry.Key
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
            $bitmap.Save((Join-Path $frontendRoot $entry.Value), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}
