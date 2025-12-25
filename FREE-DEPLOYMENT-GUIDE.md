# 🚀 Free Cloud Deployment Guide

Deploy your WhatsApp Expense Tracker for **FREE** with 24/7 availability!

## 📋 What We're Using (All Free!)

| Component | Service | Free Tier |
|-----------|---------|-----------|
| Database | Neon.tech | 512MB free forever |
| Workflows | n8n.cloud | Free tier |
| Dashboard | Render.com | Free tier |
| WhatsApp Bot | Render.com | Free tier |

---

## Step 1: Set Up Neon Database (5 minutes)

### 1.1 Create Account
1. Go to **https://neon.tech**
2. Click **"Sign Up"** → Use GitHub or Google
3. Click **"Create Project"**
   - Name: `expense-tracker`
   - Region: Pick closest to you

### 1.2 Copy Connection String
After creating, you'll see:
```
postgresql://username:password@ep-xxxx-xxxx.region.aws.neon.tech/neondb?sslmode=require
```
**📋 SAVE THIS! You'll need it later.**

### 1.3 Create Tables
1. In Neon dashboard, click **"SQL Editor"**
2. Paste and run this SQL:

```sql
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(10, 2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    phone_number VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_date ON expenses(date);
CREATE INDEX idx_phone ON expenses(phone_number);
CREATE INDEX idx_category ON expenses(category);
```

✅ **Database ready!**

---

## Step 2: Set Up n8n.cloud (5 minutes)

### 2.1 Create Account
1. Go to **https://n8n.cloud**
2. Click **"Start Free"**
3. Sign up with email
4. You'll get a URL like: `https://yourname.app.n8n.cloud`

### 2.2 Import Workflow
1. Log into your n8n.cloud instance
2. Click **Workflows** → **Import from File**
3. Upload `expense-tracker-workflow.json` from this repo

### 2.3 Configure Database in n8n
1. In the workflow, find the **PostgreSQL** nodes
2. Click to edit credentials
3. Choose **"Connection String"** option
4. Paste your **Neon connection string**
5. Save and test connection

### 2.4 Get Webhook URL
1. Open your workflow
2. Find the **Webhook** node
3. Copy the webhook URL (looks like):
   ```
   https://yourname.app.n8n.cloud/webhook/whatsapp-webhook
   ```
**📋 SAVE THIS! You'll need it for the WhatsApp bot.**

### 2.5 Activate Workflow
Click the **"Active"** toggle to turn on your workflow!

✅ **n8n ready!**

---

## Step 3: Deploy to Render.com (10 minutes)

### 3.1 Create Render Account
1. Go to **https://render.com**
2. Sign up with **GitHub** (easiest)

### 3.2 Connect Your Repository
1. Push your code to GitHub first:
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

### 3.3 Deploy Dashboard Server

1. In Render, click **"New +"** → **"Web Service"**
2. Connect your GitHub repo: `personal-finance-tracker`
3. Configure:
   - **Name**: `expense-dashboard`
   - **Root Directory**: `dashboard-server`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Instance Type**: `Free`

4. Add Environment Variable:
   - Click **"Environment"**
   - Add: `DATABASE_URL` = `your-neon-connection-string`

5. Click **"Create Web Service"**

6. Wait for deploy... Your dashboard URL will be:
   ```
   https://expense-dashboard.onrender.com
   ```

### 3.4 Deploy WhatsApp Bot

1. Click **"New +"** → **"Web Service"**
2. Connect same repo
3. Configure:
   - **Name**: `whatsapp-bot`
   - **Root Directory**: `whatsapp-bot`
   - **Runtime**: `Docker`
   - **Instance Type**: `Free`

4. Add Environment Variables:
   - `N8N_WEBHOOK_URL` = `https://yourname.app.n8n.cloud/webhook/whatsapp-webhook`

5. Click **"Create Web Service"**

6. Your bot URL will be:
   ```
   https://whatsapp-bot.onrender.com
   ```

✅ **Services deployed!**

---

## Step 4: Connect WhatsApp (2 minutes)

1. Open your WhatsApp bot URL:
   ```
   https://whatsapp-bot.onrender.com/qr.html
   ```

2. Scan the QR code with your WhatsApp app
   - WhatsApp → Settings → Linked Devices → Link a Device

3. Once connected, you're ready to track expenses!

---

## Step 5: Update n8n Reply URL

Your n8n workflow needs to send replies through the WhatsApp bot:

1. In n8n.cloud, open your workflow
2. Find any **HTTP Request** nodes that send WhatsApp replies
3. Update the URL to:
   ```
   https://whatsapp-bot.onrender.com/send
   ```

---

## 🎉 You're Done!

### Your URLs:
- **Dashboard**: `https://expense-dashboard.onrender.com`
- **WhatsApp Bot**: `https://whatsapp-bot.onrender.com`
- **n8n Workflows**: `https://yourname.app.n8n.cloud`

### How to Use:
Send WhatsApp messages like:
```
add lunch 15 food
add taxi 20 transport
add coffee 5 food
```

View expenses at your dashboard URL!

---

## ⚠️ Important Notes

### Free Tier Limitations:

**Render.com Free Tier:**
- Services sleep after 15 mins of inactivity
- First request after sleep takes ~30 seconds
- 750 hours/month free (enough for one service 24/7)

**Workaround for Sleep:** Use a free uptime monitor like:
- https://uptimerobot.com (free)
- https://cron-job.org (free)

Set it to ping your services every 14 minutes to keep them awake!

**n8n.cloud Free Tier:**
- Limited workflow executions per month
- Check their current limits on signup

---

## 🔧 Troubleshooting

### Bot Not Responding?
1. Check Render logs for errors
2. Make sure n8n workflow is **Active**
3. Verify DATABASE_URL is correct

### QR Code Not Showing?
1. Check Render logs: `Logs` tab in Render dashboard
2. Service might be sleeping - wait 30 seconds

### Database Errors?
1. Verify Neon connection string is correct
2. Make sure you created the `expenses` table

---

## 📱 Keep Your Bot Alive (Optional)

To prevent Render free tier from sleeping:

1. Go to https://uptimerobot.com
2. Create free account
3. Add monitors:
   - `https://expense-dashboard.onrender.com/api/expenses/monthly?phone=test`
   - `https://whatsapp-bot.onrender.com/api/status`
4. Set interval: **Every 5 minutes**

This keeps both services awake 24/7!

---

## Need Help?

If you run into issues:
1. Check Render dashboard logs
2. Check n8n execution history
3. Verify all environment variables are set correctly
