$ErrorActionPreference = "Stop"

# Créer le dossier uploads s'il n'existe pas
$uploadsPath = "..\public\uploads"
if (-not (Test-Path $uploadsPath)) {
    New-Item -ItemType Directory -Path $uploadsPath -Force
}

# URLs des images (images de salles de conférence de haute qualité)
$imageUrls = @(
    "https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg",
    "https://images.pexels.com/photos/1181354/pexels-photo-1181354.jpeg"
)

# Télécharger les images
$i = 1
foreach ($url in $imageUrls) {
    $outputFile = Join-Path $uploadsPath "conference-room-$i.jpg"
    Write-Host "Téléchargement de $url vers $outputFile"
    Invoke-WebRequest -Uri $url -OutFile $outputFile
    $i++
}

Write-Host "Images téléchargées avec succès!"
