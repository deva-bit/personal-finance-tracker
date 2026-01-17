# 💰 Telegram Expense Tracker

A simple, powerful expense tracker for you and your partner. Track expenses via Telegram and view them on a beautiful web dashboard.

## ✨ Features

- **📱 Telegram Bot** - Log expenses instantly (`coffee 5`, `grab 15`)
- **📊 Web Dashboard** - Visual breakdown of spending
- **🔒 Private** - Each user has their own separate data
- **👫 Multi-User** - Works for you and your girlfriend (separate accounts)
- **☁️ Cloud Sync** - Data stored safely in Neon PostgreSQL
- **📈 Budgeting** - Set monthly budgets and get alerts

---

## 🚀 How to Use

### 1. Start the Bot
Find your bot on Telegram and click **Start**.

### 2. Log Expenses
Just send a message:

- **Simple:** `coffee 5` (Auto-categorized as Food)
- **Categorized:** `grab 15 transport`
- **Specific:** `shopping clothes 50`

### 3. Commands

| Command | Action |
|---------|--------|
| `?` | Daily Total |
| `??` | Weekly Total |
| `???` | Monthly Total |
| `$` | **Get Dashboard Link** |
| `!` | Delete last expense |
| `recent` | View last 10 expenses |
| `budget 500` | Set monthly budget |
| `breakdown` | View category breakdown |

### 4. Categories
The bot automatically categorizes common items. Supported categories:
- 🍔 `food`
- 🚗 `transport`
- 🛒 `shopping`
- 💡 `bills`
- 🎬 `entertainment`
- 💊 `health`
- 📺 `subscription`
- 📦 `other`

---

## 🛠 Deployment (Render)

This project is ready for **Render**.

1. **Root Directory:** `telegram-bot`
2. **Build Command:** `npm install`
3. **Start Command:** `node index.js`
4. **Environment Variables:**
   - `TELEGRAM_BOT_TOKEN`: Your BotFather token
   - `DATABASE_URL`: Your Neon PostgreSQL connection string

---

## 💻 Local Development

1. Install dependencies:
   ```bash
   cd telegram-bot
   npm install
   ```

2. Run locally:
   ```bash
   export TELEGRAM_BOT_TOKEN="your_token"
   export DATABASE_URL="postgres://..."
   node index.js
   ```
