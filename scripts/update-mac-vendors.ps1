$ErrorActionPreference = 'Stop'
$taskRegistries = @(
    'https://standards-oui.ieee.org/oui/oui.csv',
    'https://standards-oui.ieee.org/oui28/mam.csv',
    'https://standards-oui.ieee.org/oui36/oui36.csv',
    'https://standards-oui.ieee.org/iab/iab.csv'
)
$taskAssignments = @{}
foreach ($taskUrl in $taskRegistries) {
    $taskResponse = Invoke-WebRequest -Uri $taskUrl -TimeoutSec 60
    $taskCsv = if ($taskResponse.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($taskResponse.Content) } else { $taskResponse.Content }
    $taskRows = $taskCsv | ConvertFrom-Csv
    foreach ($taskRow in $taskRows) {
        $taskPrefix = $taskRow.Assignment.Trim().ToUpperInvariant()
        $taskVendor = ($taskRow.'Organization Name' -replace '[\t\r\n]+', ' ').Trim()
        if ($taskPrefix -match '^([0-9A-F]{6}|[0-9A-F]{7}|[0-9A-F]{9})$' -and $taskVendor) {
            $taskAssignments[$taskPrefix] = $taskVendor
        }
    }
}
if ($taskAssignments.Count -lt 40000) { throw 'Incomplete IEEE registry download; existing data was not replaced.' }
$taskDestination = Join-Path $PSScriptRoot '../src-tauri/data/mac-vendors.tsv'
[IO.Directory]::CreateDirectory((Split-Path $taskDestination)) | Out-Null
$taskLines = @('# IEEE Registration Authority public MA-L, MA-M, MA-S and IAB assignments', "# Retrieved $([DateTime]::UtcNow.ToString('yyyy-MM-dd'))")
$taskLines += $taskAssignments.Keys | Sort-Object | ForEach-Object { "$_`t$($taskAssignments[$_])" }
[IO.File]::WriteAllLines($taskDestination, $taskLines, [Text.UTF8Encoding]::new($false))
Write-Output "Saved $($taskAssignments.Count) IEEE assignments to $taskDestination"
