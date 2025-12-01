# Expense Tracker - Quick Reference

## Add Expense via WhatsApp
Send to your WhatsApp bot:
```
add description amount category
```

Examples:
- `add lunch 15 food`
- `add coffee 5 drinks`
- `add taxi 12 transport`

## Check Monthly Summary (PowerShell)

### Total This Month
```powershell
docker exec postgres psql -U n8n -d n8n -c "SELECT SUM(amount) as total, COUNT(*) as expenses FROM expenses WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE);"
```

### By Category This Month
```powershell
docker exec postgres psql -U n8n -d n8n -c "SELECT category, COUNT(*) as items, SUM(amount) as total FROM expenses WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) GROUP BY category ORDER BY total DESC;"
```

### Last 7 Days
```powershell
docker exec postgres psql -U n8n -d n8n -c "SELECT category, COUNT(*) as items, SUM(amount) as total FROM expenses WHERE date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY category ORDER BY total DESC;"
```

### All Expenses This Month (Detailed)
```powershell
docker exec postgres psql -U n8n -d n8n -c "SELECT description, amount, category, TO_CHAR(created_at, 'DD/MM HH24:MI') as when FROM expenses WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) ORDER BY created_at DESC;"
```

## Docker Management

### Check if services are running
```powershell
docker ps
```

### View WhatsApp bot logs
```powershell
docker logs whatsapp-bot --tail 50
```

### Restart all services
```powershell
cd C:\expense-tracker-whatsapp
docker-compose restart
```

### Stop all services
```powershell
cd C:\expense-tracker-whatsapp
docker-compose down
```

### Start all services
```powershell
cd C:\expense-tracker-whatsapp
docker-compose up -d
```

## Your Current Setup
- n8n: http://localhost:5678
- Database: PostgreSQL (internal)
- WhatsApp: Connected to +60146362758
- Phone number: Your WhatsApp number

## Troubleshooting

### WhatsApp disconnected
```powershell
docker-compose restart whatsapp-bot
```
Then scan QR code again in logs:
```powershell
docker logs whatsapp-bot
```

### Database not saving
Check n8n workflow is Active at http://localhost:5678
