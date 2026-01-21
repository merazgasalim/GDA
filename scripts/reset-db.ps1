<#
reset-db.ps1

Backs up (moves) detected SQLite dev.db files and related WAL/SHM files
into a timestamped backup folder under the repository root.

Usage:
  powershell -ExecutionPolicy Bypass -File .\scripts\reset-db.ps1

Options:
  -Delete : delete files instead of moving them to the backup folder.
#>
param(
    [switch]$Delete
)

try {
    $repoRoot = (Resolve-Path -Path ".").Path
} catch {
    $repoRoot = Get-Location
}

$now = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = Join-Path $repoRoot "db-backup-$now"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Write-Output "Backup directory: $backupDir"

# Candidate paths to check (relative and common absolutes)
$candidatePaths = @(
    Join-Path $repoRoot 'prisma\dev.db',
    Join-Path $repoRoot '..\prisma\dev.db',
    Join-Path $repoRoot '..\..\prisma\dev.db',
    'D:\Dev\prisma\dev.db'
) | ForEach-Object { $_ } # keep as array

# Find any dev.db under repo root (recursively)
$foundUnderRepo = @()
try {
    $foundUnderRepo = Get-ChildItem -Path $repoRoot -Filter 'dev.db' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
} catch { }

# Search common AppData locations for any dev.db (may include userData path)
$envPaths = @($env:APPDATA, $env:LOCALAPPDATA) | Where-Object { $_ }
$foundInAppData = @()
foreach ($p in $envPaths) {
    try {
        $foundInAppData += Get-ChildItem -Path $p -Filter 'dev.db' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    } catch { }
}

# Aggregate and dedupe
$allPaths = $candidatePaths + $foundUnderRepo + $foundInAppData
$allPaths = $allPaths | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

if ($allPaths.Count -eq 0) {
    Write-Output "No dev.db files found to back up."
    exit 0
}

# Helper to handle WAL/SHM siblings
function MoveOrDeleteFile([string]$src, [string]$destDir, [bool]$delete) {
    if (-not (Test-Path $src)) { return }
    $leaf = Split-Path $src -Leaf
    $dest = Join-Path $destDir $leaf
    if ($delete) {
        try {
            Remove-Item -LiteralPath $src -Force -ErrorAction Stop
            Write-Output ("Deleted " + $src)
        } catch {
            Write-Warning ("Failed to delete " + $src + ": " + $_)
        }
    } else {
        try {
            Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop
            Write-Output ("Moved " + $src + " -> " + $dest)
        } catch {
            Write-Warning ("Failed to move " + $src + " -> " + $dest + ": " + $_)
        }
    }
}

foreach ($p in $allPaths) {
    # Move/delete the base file
    MoveOrDeleteFile -src $p -destDir $backupDir -delete:$Delete.IsPresent

    # Also handle WAL/SHM (same base name + -wal / -shm or .wal/.shm)
    $dir = Split-Path $p -Parent
    $base = Split-Path $p -Leaf
    $siblings = @(
        (Join-Path $dir ("{0}-wal" -f $base)),
        (Join-Path $dir ("{0}-shm" -f $base)),
        (Join-Path $dir ("{0}.wal" -f $base)),
        (Join-Path $dir ("{0}.shm" -f $base))
    )
    foreach ($s in $siblings) {
        MoveOrDeleteFile -src $s -destDir $backupDir -delete:$Delete.IsPresent
    }
}

Write-Output "Finished. Backups (or deletions) processed."
Write-Output "Backup folder: $backupDir"

# Remind user to restart app
Write-Output "\nNext: restart the application so it recreates an empty database.\n"
