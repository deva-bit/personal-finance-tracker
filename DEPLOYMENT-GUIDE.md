# 24/7 Free Deployment Guide

Complete step-by-step guide to deploy your expense tracker for free, running 24/7.

## Best Option: Railway.app

Railway offers the easiest deployment with free tier perfect for this project.

### Step-by-Step Railway Deployment

#### 1. Create Railway Account (2 minutes)

1. Go to https://railway.app
2. Click "Login" → "Login with GitHub"
3. Authorize Railway
4. You get $5 free credit monthly (enough for 24/7)

#### 2. Deploy PostgreSQL (1 minute)

1. Click "New Project"
2. Click "Add Service" → "Database" → "Add PostgreSQL"
3. Wait for deployment (30 seconds)
4. Click on PostgreSQL service
5. Go to "Connect" tab
6. Copy connection details (save for later)

#### 3. Deploy n8n (3 minutes)

1. In same project, click "New Service" → "Empty Service"
2. Select "Docker Image"
3. Enter image: `n8nio/n8n:latest`
4. Click "Add Service"
5. Go to service → "Variables" tab
6. Add these variables:

```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=YourStrongPassword123
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=[PostgreSQL host from step 2]
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=railway
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=[PostgreSQL password from step 2]
N8N_HOST=[will get after deployment]
WEBHOOK_URL=[will get after deployment]
```

7. Go to "Settings" tab
8. Click "Generate Domain" (gets you a public URL)
9. Copy the URL (something like: your-app.up.railway.app)
10. Go back to "Variables"
11. Update:
    - `N8N_HOST=your-app.up.railway.app`
    - `WEBHOOK_URL=https://your-app.up.railway.app/`
12. Click "Redeploy"

#### 4. Setup Database Schema (2 minutes)

1. Click on PostgreSQL service
2. Click "Connect" → "Postgres Connection URL"
3. Copy the connection string
4. On your local computer, open PowerShell:

```powershell
# Install PostgreSQL client if not installed
winget install PostgreSQL.PostgreSQL

# Connect to Railway database
psql "postgresql://postgres:password@host:port/railway"

# Copy and paste content from setup-database.sql
# Press Enter
# Type \q to quit
```

Or use Railway's Web Terminal:
1. Click PostgreSQL service
2. Click "Deploy Logs"
3. Click terminal icon
4. Run: `psql -U postgres -d railway`
5. Paste SQL from `setup-database.sql`

#### 5. Deploy Evolution API (3 minutes)

**Option A: Deploy on Railway (uses more credits)**

1. Click "New Service" → "Empty Service"
2. Select "Docker Image"
3. Enter: `atendai/evolution-api:latest`
4. Go to "Variables":
```
SERVER_URL=[will get after domain generation]
AUTHENTICATION_API_KEY=YourSecretKey12345
```
5. Generate domain
6. Update SERVER_URL with the new domain

**Option B: Run Evolution API Locally (Recommended - Free)**

1. On your computer (must be on 24/7):

```powershell
docker run -d --name evolution-api \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=YourSecretKey12345 \
  -e SERVER_URL=http://localhost:8080 \
  -v evolution_data:/evolution/instances \
  atendai/evolution-api:latest
```

2. Install ngrok for public access:
```powershell
winget install Ngrok.Ngrok
ngrok http 8080
```

3. Copy the ngrok URL (https://xxxxx.ngrok.io)

#### 6. Import Workflow to n8n (3 minutes)

1. Open your n8n URL: https://your-app.up.railway.app
2. Login with credentials you set
3. Click "Workflows" → "Import from File"
4. Upload `expense-tracker-workflow.json`
5. Workflow will open

#### 7. Configure Database Connection in Workflow

1. Click on "Save to Database" node
2. Click "Credentials" → "Create New"
3. Select "PostgreSQL"
4. Enter connection details from Railway PostgreSQL:
   - Host: [from Railway]
   - Database: railway
   - User: postgres
   - Password: [from Railway]
   - Port: 5432
   - SSL: Enabled
5. Test connection → Save

#### 8. Update Evolution API URLs in Workflow

1. Click "Send WhatsApp Reply" node
2. Update URL to your Evolution API URL
3. Update apikey header to your `AUTHENTICATION_API_KEY`
4. Save workflow
5. Click "Activate" toggle (top right)

#### 9. Connect WhatsApp (5 minutes)

1. Open Evolution API: http://localhost:8080 (or Railway URL)
2. Click "Create Instance"
3. Settings:
   - Instance Name: `expense-tracker`
   - API Key: Same as AUTHENTICATION_API_KEY
   - Webhook URL: `https://your-n8n.up.railway.app/webhook/whatsapp-webhook`
4. Save
5. Scan QR code with WhatsApp:
   - Open WhatsApp → Settings → Linked Devices
   - Scan the QR code shown

#### 10. Test Everything! (2 minutes)

Send WhatsApp message to yourself:
```
add test 1 general
```

You should get response:
```
✅ Expense added!
💰 Amount: $1
📝 Description: test
🏷️ Category: general
```

## Alternative: Render.com

### Step-by-Step Render Deployment

#### 1. Create Account
1. Go to https://render.com
2. Sign up with GitHub (free)

#### 2. Deploy PostgreSQL
1. Click "New" → "PostgreSQL"
2. Name: `expense-db`
3. Select Free tier
4. Click "Create Database"
5. Copy "Internal Database URL"

#### 3. Deploy n8n
1. Click "New" → "Web Service"
2. "Deploy from Docker Image"
3. Image: `n8nio/n8n:latest`
4. Name: `expense-n8n`
5. Plan: Free
6. Add environment variables (same as Railway)
7. Click "Create Web Service"

#### 4. Deploy Evolution API
1. Click "New" → "Web Service"
2. Image: `atendai/evolution-api:latest`
3. Name: `evolution-whatsapp`
4. Plan: Free
5. Add environment variables
6. Create

#### 5. Continue from step 6 in Railway guide

## Monitoring & Maintenance

### Check if Services are Running

**Railway:**
1. Login to Railway dashboard
2. See deployment status
3. Check logs in real-time

**Render:**
1. Login to Render dashboard
2. View service status
3. Check logs

### Monthly Free Limits

**Railway (Best):**
- $5 credit = ~500 hours
- 1 service running 24/7 = 720 hours
- **Solution**: 
  - Use PostgreSQL + n8n on Railway (main services)
  - Run Evolution API locally with ngrok (free)
  - OR Pay $5/month for unlimited

**Render:**
- 750 hours/month free
- Enough for ONE service 24/7
- Use for n8n only, others locally

### Keep Evolution API Running (If Local)

**Windows:**
1. Create `start-evolution.bat`:
```batch
@echo off
docker start evolution-api
ngrok http 8080
```

2. Add to Windows Startup:
   - Press Win+R
   - Type: `shell:startup`
   - Copy `start-evolution.bat` there

**Set PC to Never Sleep:**
1. Settings → System → Power & Sleep
2. Set both to "Never"

## Costs Summary

### Completely Free (Recommended Setup)
- **n8n on Railway**: $0 (within free tier)
- **PostgreSQL on Railway**: $0 (free database)
- **Evolution API**: $0 (run locally with Docker)
- **ngrok**: $0 (free tier, 1 tunnel)
- **Total**: **$0/month**

### All Cloud (Easier but Limited)
- **Railway with all services**: $5/month (after free credits)
- Still much cheaper than any alternative!

## Troubleshooting

### "Out of hours" on Railway
- Switch Evolution API to local + ngrok
- OR upgrade to Hobby plan ($5/month)

### WhatsApp disconnects
1. Open Evolution API dashboard
2. Click "Reconnect"
3. Scan QR code again

### Webhook not receiving messages
1. Check webhook URL in Evolution API
2. Test webhook manually:
```powershell
curl -X POST https://your-n8n.up.railway.app/webhook/whatsapp-webhook -H "Content-Type: application/json" -d '{"test": true}'
```

### Database connection failed
1. Check PostgreSQL is running
2. Verify connection credentials
3. Enable SSL in n8n database config

## Need Help?

1. Check Railway/Render logs
2. Check n8n execution logs
3. Check Evolution API status page
4. Test each component separately

---

**Deployment Time**: ~20 minutes total
**Monthly Cost**: $0 (or $5 for full cloud)
**Maintenance**: Zero (automatic restarts)

Your expense tracker is now running 24/7! 🎉
