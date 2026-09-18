$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot = Split-Path $PSScriptRoot
$taskOutput = Join-Path $taskRoot 'src-tauri/installer'
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskIcon = [Drawing.Image]::FromFile((Join-Path $taskRoot 'src-tauri/icons/128x128.png'))
try {
    foreach ($taskLayout in @(
        @{ Name='header.bmp'; Width=150; Height=57; Sidebar=$false },
        @{ Name='sidebar.bmp'; Width=164; Height=314; Sidebar=$true }
    )) {
        $taskBitmap = [Drawing.Bitmap]::new($taskLayout.Width, $taskLayout.Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
        try {
            $taskGraphics.Clear([Drawing.Color]::White)
            $taskGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            if ($taskLayout.Sidebar) {
                $taskBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(11,15,25))
                $taskFont = [Drawing.Font]::new('Segoe UI', 12, [Drawing.FontStyle]::Bold)
                try {
                    $taskGraphics.FillRectangle($taskBrush, 0, 0, 164, $taskLayout.Height)
                    $taskGraphics.DrawImage($taskIcon, 26, 52, 112, 112)
                    $taskGraphics.DrawString('CTRLbot', $taskFont, [Drawing.Brushes]::White, 24, 191)
                    $taskGraphics.DrawString('Terminator', $taskFont, [Drawing.Brushes]::White, 24, 214)
                } finally { $taskBrush.Dispose(); $taskFont.Dispose() }
            } else {
                $taskGraphics.DrawImage($taskIcon, ($taskLayout.Width - 53), 4, 48, 48)
            }
            $taskBitmap.Save((Join-Path $taskOutput $taskLayout.Name), [Drawing.Imaging.ImageFormat]::Bmp)
        } finally { $taskGraphics.Dispose(); $taskBitmap.Dispose() }
    }
} finally { $taskIcon.Dispose() }
