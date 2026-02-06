$imageUrl = "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200"
$outputPath = Join-Path $PSScriptRoot ".." "public" "images" "hero-image.jpg"

Write-Host "Downloading hero image from $imageUrl"
Write-Host "Saving to $outputPath"

try {
    Invoke-WebRequest -Uri $imageUrl -OutFile $outputPath
    Write-Host "Image downloaded successfully!"
} catch {
    Write-Error "Failed to download image: $_"
    exit 1
}
