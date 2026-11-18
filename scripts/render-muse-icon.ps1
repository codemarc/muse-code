# Rasterize the existing official vector; no network access or app automation.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore,WindowsBase
$repo = Split-Path -Parent $PSScriptRoot
[xml]$source = Get-Content -LiteralPath (Join-Path $repo 'media\muse-brand.svg') -Raw
$paths = @($source.DocumentElement.ChildNodes | Where-Object LocalName -EQ 'path')
if ($paths.Count -ne 1) { throw 'Expected the original single-path Muse mark.' }
$geometry = [System.Windows.Media.Geometry]::Parse($paths[0].GetAttribute('d'))
$brush = [System.Windows.Media.LinearGradientBrush]::new()
$brush.MappingMode = [System.Windows.Media.BrushMappingMode]::Absolute
$brush.StartPoint = [System.Windows.Point]::new(133.245,109.046)
$brush.EndPoint = [System.Windows.Point]::new(24.9203,-12.5565)
foreach($stop in @(@('#0082FB',0.254808),@('#0064E0',0.697115),@('#0040DC',1.0))) {
  $brush.GradientStops.Add([System.Windows.Media.GradientStop]::new([System.Windows.Media.ColorConverter]::ConvertFromString($stop[0]),$stop[1]))
}
$visual = [System.Windows.Media.DrawingVisual]::new()
$drawing = $visual.RenderOpen()
$drawing.PushTransform([System.Windows.Media.TranslateTransform]::new(28,28))
$drawing.PushTransform([System.Windows.Media.ScaleTransform]::new(2,2))
$drawing.DrawGeometry($brush,$null,$geometry)
$drawing.Pop(); $drawing.Pop(); $drawing.Close()
$bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(256,256,96,96,[System.Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($visual)
$encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
$output = [IO.File]::Create((Join-Path $repo 'media\icon.png'))
try { $encoder.Save($output) } finally { $output.Dispose() }
Write-Output 'Rendered Muse vector to media/icon.png (256x256)'
