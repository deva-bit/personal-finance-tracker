# Export Expenses to Excel
# Creates an Excel file with separate sheets for each month

# Install required module if not already installed
if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    Write-Host "Installing ImportExcel module..."
    Install-Module -Name ImportExcel -Scope CurrentUser -Force
}

Import-Module ImportExcel

$excelFile = "C:\expense-tracker-whatsapp\expenses-export.xlsx"

Write-Host "Exporting expenses to Excel..." -ForegroundColor Green

# Get list of months that have expenses
$monthsQuery = @"
SELECT DISTINCT 
    TO_CHAR(date, 'YYYY-MM') as month,
    TO_CHAR(date, 'Month YYYY') as month_name
FROM expenses
ORDER BY month DESC;
"@

$months = docker exec postgres psql -U n8n -d n8n -t -A -F"|" -c $monthsQuery

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error connecting to database" -ForegroundColor Red
    exit 1
}

# Remove old Excel file if exists
if (Test-Path $excelFile) {
    Remove-Item $excelFile
}

# Process each month
$monthList = $months -split "`n" | Where-Object { $_.Trim() -ne "" }

foreach ($monthData in $monthList) {
    $parts = $monthData -split "\|"
    $monthCode = $parts[0].Trim()
    $monthName = $parts[1].Trim()
    
    Write-Host "Exporting $monthName..." -ForegroundColor Cyan
    
    # Query expenses for this month
    $expensesQuery = @"
SELECT 
    TO_CHAR(date, 'DD/MM/YYYY') as date,
    description,
    amount,
    category,
    phone_number,
    TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI') as added_on
FROM expenses
WHERE TO_CHAR(date, 'YYYY-MM') = '$monthCode'
ORDER BY date DESC, created_at DESC;
"@
    
    # Get CSV output from PostgreSQL
    $csvData = docker exec postgres psql -U n8n -d n8n -t -A -F"," -c $expensesQuery
    
    # Convert to objects
    $expenses = @()
    $lines = $csvData -split "`n" | Where-Object { $_.Trim() -ne "" }
    
    foreach ($line in $lines) {
        $fields = $line -split ","
        if ($fields.Count -ge 6) {
            $expenses += [PSCustomObject]@{
                Date = $fields[0]
                Description = $fields[1]
                Amount = [decimal]$fields[2]
                Category = $fields[3]
                Phone = $fields[4]
                'Added On' = $fields[5]
            }
        }
    }
    
    # Add summary row
    $total = ($expenses | Measure-Object -Property Amount -Sum).Sum
    $count = $expenses.Count
    
    $expenses += [PSCustomObject]@{
        Date = ""
        Description = "TOTAL"
        Amount = $total
        Category = "$count items"
        Phone = ""
        'Added On' = ""
    }
    
    # Export to Excel
    $expenses | Export-Excel -Path $excelFile -WorksheetName $monthName -AutoSize -TableStyle Medium2 -FreezeTopRow
}

# Add a Summary sheet
Write-Host "Creating summary sheet..." -ForegroundColor Cyan

$summaryQuery = @"
SELECT 
    TO_CHAR(date, 'Month YYYY') as month,
    category,
    COUNT(*) as items,
    SUM(amount) as total
FROM expenses
GROUP BY TO_CHAR(date, 'YYYY-MM'), TO_CHAR(date, 'Month YYYY'), category
ORDER BY TO_CHAR(date, 'YYYY-MM') DESC, total DESC;
"@

$summaryData = docker exec postgres psql -U n8n -d n8n -t -A -F"," -c $summaryQuery
$summaryLines = $summaryData -split "`n" | Where-Object { $_.Trim() -ne "" }

$summary = @()
foreach ($line in $summaryLines) {
    $fields = $line -split ","
    if ($fields.Count -ge 4) {
        $summary += [PSCustomObject]@{
            Month = $fields[0].Trim()
            Category = $fields[1]
            Items = [int]$fields[2]
            Total = [decimal]$fields[3]
        }
    }
}

$summary | Export-Excel -Path $excelFile -WorksheetName "Summary" -AutoSize -TableStyle Medium6 -FreezeTopRow

Write-Host "`nExport complete! " -ForegroundColor Green -NoNewline
Write-Host "File saved to: $excelFile" -ForegroundColor Yellow

# Open the Excel file
Start-Process $excelFile

Write-Host "`nExcel file opened!" -ForegroundColor Green
