# 💰 WhatsApp Expense Tracker

Track your expenses by sending WhatsApp messages like `add lunch 15 food`. Automatically saves to database with a beautiful web dashboard.

## ✨ Features

- 📱 **WhatsApp Integration** - Track expenses via WhatsApp messages
- 🗄️ **PostgreSQL Database** - Persistent storage
- 🎨 **Web Dashboard** - Beautiful UI to view expenses
- 📊 **Excel Export** - Export data with monthly sheets
- 🔄 **Auto-sync** - Real-time updates
- 🐳 **Docker** - Easy deployment

## 🏗️ Architecture

```
WhatsApp → WhatsApp Bot → n8n Workflow → PostgreSQL
                                              ↓
                                        Web Dashboard
```

## 📋 Prerequisites

- Docker Desktop installed
- Git installed
- WhatsApp on your phone

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/deva-bit/personal-finance-tracker.git
cd personal-finance-tracker
```

### 2. Start All Services

```bash
# First time - build and start
docker-compose up -d --build

# If you get cache errors, run:
docker system prune -f
docker-compose up -d --build
```

This starts 4 services:
- **PostgreSQL** (port 5432) - Database
- **n8n** (port 5678) - Workflow automation
- **WhatsApp Bot** (port 3000) - WhatsApp connector
- **Dashboard** (port 8080) - Web interface

### 3. Link WhatsApp

```bash
# View QR code
docker logs whatsapp-bot

# Scan the QR code with your WhatsApp
```

### 4. Import n8n Workflow

1. Open http://localhost:5678
2. Login with: `admin` / `admin123`
3. Click **Workflows** → **Import from File**
4. Upload: `expense-tracker-workflow.json`
5. **Activate** the workflow

### 5. Use the Dashboard

Open http://localhost:8080 to view your expenses

## 📱 How to Track Expenses

Send WhatsApp messages in this format:

```
add [description] [amount] [category]
```

**Examples:**
```
add lunch 15 food
add taxi 20 transport
add coffee 5 food
add netflix 50 subscription
add groceries 120 food
```

## 🎯 Usage

### View Dashboard
```
http://localhost:8080
```

### Export to Excel
```powershell
# Windows PowerShell
.\export-to-excel.ps1
```

### Check Database
```bash
docker exec postgres psql -U n8n -d n8n -c "SELECT * FROM expenses ORDER BY created_at DESC LIMIT 10;"
```

### View Logs
```bash
# WhatsApp bot logs
docker logs whatsapp-bot --tail 50

# n8n logs
docker logs n8n --tail 50
```

## 🛠️ Management Commands

### Stop All Services
```bash
docker-compose down
```

### Restart WhatsApp Bot
```bash
docker restart whatsapp-bot
```

### Rebuild Services
```bash
docker-compose up -d --build
```

## 📁 Project Structure

```
personal-finance-tracker/
├── docker-compose.yml              # Services configuration
├── setup-database.sql              # Database schema
├── export-to-excel.ps1             # Excel export script
├── expense-tracker-workflow.json   # Import this to n8n
├── whatsapp-bot/
│   ├── Dockerfile
│   ├── package.json
│   └── index.js
└── dashboard-server/
    ├── Dockerfile
    ├── package.json
    ├── index.js
    └── public/
        └── dashboard.html
```

## 🐛 Troubleshooting

### WhatsApp not connecting
```bash
docker restart whatsapp-bot
docker logs whatsapp-bot
```

### Dashboard showing no data
```bash
docker exec postgres psql -U n8n -d n8n -c "SELECT * FROM expenses;"
```

## 📝 License

MIT License

---

**Built with:** Node.js, Docker, PostgreSQL, n8n, WhatsApp Web.js
