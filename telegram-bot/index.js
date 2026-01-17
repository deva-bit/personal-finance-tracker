const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Client } = require('pg');

// ============== CONFIGURATION ==============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Required on Render
const DATABASE_URL = process.env.DATABASE_URL;    // Required on Render
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Valid categories with emojis
const CATEGORIES = {
    'food': '🍔',
    'transport': '🚗',
    'shopping': '🛒',
    'bills': '💡',
    'entertainment': '🎬',
    'health': '💊',
    'subscription': '📺',
    'other': '📦'
};

const VALID_CATEGORIES = Object.keys(CATEGORIES);

// Auto-categorization
const AUTO_CATEGORIES = {
    'coffee': 'food', 'kopi': 'food', 'teh': 'food', 'lunch': 'food', 'dinner': 'food',
    'breakfast': 'food', 'brunch': 'food', 'supper': 'food', 'snack': 'food', 'bubble tea': 'food',
    'bbt': 'food', 'makan': 'food', 'food': 'food', 'eat': 'food', 'meal': 'food',
    'hawker': 'food', 'kopitiam': 'food', 'restaurant': 'food', 'mcdonalds': 'food', 'mcd': 'food',
    'kfc': 'food', 'subway': 'food', 'starbucks': 'food', 'pizza': 'food', 'nasi': 'food',
    'grab': 'transport', 'gojek': 'transport', 'uber': 'transport', 'taxi': 'transport',
    'mrt': 'transport', 'bus': 'transport', 'train': 'transport', 'petrol': 'transport',
    'fuel': 'transport', 'parking': 'transport', 'toll': 'transport',
    'ntuc': 'shopping', 'fairprice': 'shopping', 'giant': 'shopping', 'shopee': 'shopping',
    'lazada': 'shopping', 'amazon': 'shopping', 'clothes': 'shopping', 'grocery': 'shopping',
    'electric': 'bills', 'electricity': 'bills', 'water': 'bills', 'gas': 'bills',
    'phone': 'bills', 'mobile': 'bills', 'internet': 'bills', 'rent': 'bills',
    'netflix': 'subscription', 'spotify': 'subscription', 'youtube': 'subscription',
    'disney': 'subscription', 'gym': 'subscription', 'chatgpt': 'subscription',
    'movie': 'entertainment', 'cinema': 'entertainment', 'karaoke': 'entertainment',
    'doctor': 'health', 'clinic': 'health', 'medicine': 'health', 'pharmacy': 'health'
};

// ============== DATABASE CONNECTION ==============

const db = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL && DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function initDb() {
    try {
        await db.connect();
        console.log('✅ Connected to database');

        // Create tables if not exist
        await db.query(`
            CREATE TABLE IF NOT EXISTS telegram_users (
                user_id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100),
                budget DECIMAL(10,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS telegram_expenses (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(50) REFERENCES telegram_users(user_id),
                description TEXT,
                amount DECIMAL(10,2),
                category VARCHAR(50),
                date TIMESTAMP DEFAULT NOW()
            );

             CREATE TABLE IF NOT EXISTS dashboard_tokens (
                token VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(50) REFERENCES telegram_users(user_id),
                expires_at TIMESTAMP
            );
        `);
        console.log('✅ Database tables ready');
    } catch (error) {
        console.error('❌ Database connection error:', error.message);
    }
}

// ============== DATA FUNCTIONS ==============

async function ensureUser(userId, name) {
    await db.query(`
        INSERT INTO telegram_users (user_id, name) 
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET name = $2
    `, [userId, name]);
}

async function addExpense(userId, description, amount, category) {
    const res = await db.query(`
        INSERT INTO telegram_expenses (user_id, description, amount, category, date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
    `, [userId, description, amount, category]);
    return res.rows[0];
}

async function getTodayTotal(userId) {
    const res = await db.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
        FROM telegram_expenses 
        WHERE user_id = $1 AND date::date = CURRENT_DATE
    `, [userId]);
    return { total: parseFloat(res.rows[0].total), count: parseInt(res.rows[0].count) };
}

async function getWeeklyTotal(userId) {
    const res = await db.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
        FROM telegram_expenses 
        WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
    `, [userId]);
    return { total: parseFloat(res.rows[0].total), count: parseInt(res.rows[0].count) };
}

async function getMonthlyTotal(userId) {
    const res = await db.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
        FROM telegram_expenses 
        WHERE user_id = $1 
        AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `, [userId]);
    return { total: parseFloat(res.rows[0].total), count: parseInt(res.rows[0].count) };
}

async function deleteLastExpense(userId) {
    const res = await db.query(`
        DELETE FROM telegram_expenses
        WHERE id = (
            SELECT id FROM telegram_expenses 
            WHERE user_id = $1 
            ORDER BY date DESC LIMIT 1
        )
        RETURNING *
    `, [userId]);
    return res.rows[0];
}

async function getRecentExpenses(userId, limit = 10) {
    const res = await db.query(`
        SELECT * FROM telegram_expenses 
        WHERE user_id = $1 
        ORDER BY date DESC LIMIT $2
    `, [userId, limit]);
    return res.rows;
}

async function setBudget(userId, amount) {
    await db.query(`UPDATE telegram_users SET budget = $1 WHERE user_id = $2`, [amount, userId]);
}

async function getBudgetStatus(userId) {
    const userRes = await db.query(`SELECT budget FROM telegram_users WHERE user_id = $1`, [userId]);
    const budget = parseFloat(userRes.rows[0]?.budget || 0);
    const monthly = await getMonthlyTotal(userId);

    return {
        budget,
        spent: monthly.total,
        remaining: budget - monthly.total,
        percentage: budget > 0 ? (monthly.total / budget * 100) : 0
    };
}

async function getCategoryBreakdown(userId) {
    const res = await db.query(`
        SELECT category, SUM(amount) as total
        FROM telegram_expenses 
        WHERE user_id = $1 
        AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
        GROUP BY category
    `, [userId]);

    const breakdown = {};
    VALID_CATEGORIES.forEach(c => breakdown[c] = 0);
    res.rows.forEach(r => breakdown[r.category] = parseFloat(r.total));
    return breakdown;
}

// ============== TOKEN MANAGEMENT ==============

async function generateAccessToken(userId) {
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    // Expires in 30 minutes
    await db.query(`
        INSERT INTO dashboard_tokens (token, user_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
    `, [token, userId]);
    return token;
}

async function validateToken(token) {
    const res = await db.query(`
        SELECT user_id FROM dashboard_tokens 
        WHERE token = $1 AND expires_at > NOW()
    `, [token]);
    return res.rows[0]?.user_id;
}

// ============== HELPERS ==============

function autoCategory(description) {
    const desc = description.toLowerCase();
    if (AUTO_CATEGORIES[desc]) return AUTO_CATEGORIES[desc];
    for (const [keyword, category] of Object.entries(AUTO_CATEGORIES)) {
        if (desc.includes(keyword)) return category;
    }
    return null;
}

function parseExpenseMessage(message) {
    const text = message.trim().toLowerCase();

    if (text === '?' || text === 'today') return { type: 'today' };
    if (text === '??' || text === 'week') return { type: 'week' };
    if (text === '???' || text === 'month') return { type: 'month' };
    if (text === '$' || text === 'dashboard') return { type: 'dashboard' };
    if (text === '!' || text === 'delete' || text === 'undo') return { type: 'delete' };
    if (text === 'help' || text === '/help' || text === '/start') return { type: 'help' };
    if (text === 'recent' || text === 'history') return { type: 'recent' };
    if (text === 'budget') return { type: 'budgetstatus' };
    if (text === 'categories' || text === 'breakdown') return { type: 'breakdown' };

    const budgetMatch = text.match(/^budget\s+(\d+\.?\d*)$/);
    if (budgetMatch) return { type: 'setbudget', amount: parseFloat(budgetMatch[1]) };

    const simpleMatch = text.match(/^([a-z\s]+?)\s+(\d+\.?\d*)$/);
    if (simpleMatch) {
        return { type: 'add', description: simpleMatch[1].trim(), amount: parseFloat(simpleMatch[2]), category: null };
    }

    const fullMatch = text.match(/^([a-z]+)\s+([a-z\s]+?)\s+(\d+\.?\d*)$/);
    if (fullMatch && VALID_CATEGORIES.includes(fullMatch[1])) {
        return { type: 'add', category: fullMatch[1], description: fullMatch[2].trim(), amount: parseFloat(fullMatch[3]) };
    }

    return { type: 'unknown' };
}

// ============== EXPRESS APP ==============

const app = express();
app.use(express.json());

// Dashboard HTML
const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>💰 Expense Tracker</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #0f172a; color: #fff; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; padding: 20px; background: #1e293b; border-radius: 16px; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
        .stat { background: #1e293b; padding: 15px; border-radius: 12px; text-align: center; }
        .stat h3 { color: #94a3b8; font-size: 0.8rem; margin-bottom: 5px; }
        .stat div { font-size: 1.2rem; font-weight: 700; color: #4ade80; }
        .card { background: #1e293b; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
        .card h2 { font-size: 1.1rem; margin-bottom: 15px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
        .expense-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155; }
        .expense-left { display: flex; align-items: center; gap: 12px; }
        .expense-emoji { font-size: 1.2rem; background: #334155; padding: 8px; border-radius: 50%; }
        .expense-amount { color: #f87171; font-weight: 600; }
        .error { text-align: center; padding: 50px; background: #1e293b; border-radius: 16px; margin-top: 50px; }
    </style>
</head>
<body>
    <div id="app" class="container">
        <div class="loading" style="text-align:center; padding: 50px;">Loading...</div>
    </div>
    <script>
        const emojis = ${JSON.stringify(CATEGORIES)};
        async function load() {
            const token = new URLSearchParams(window.location.search).get('token');
            if(!token) return showError('Missing access token. Please get a link from Telegram.');
            
            try {
                const res = await fetch('/api/dashboard?token=' + token);
                if(!res.ok) throw new Error('Invalid token');
                const data = await res.json();
                render(data);
            } catch(e) {
                showError(e.message);
            }
        }
        
        function showError(msg) {
            document.getElementById('app').innerHTML = '<div class="error"><h3>❌ Access Denied</h3><p>' + msg + '</p></div>';
        }
        
        function render(data) {
            document.getElementById('app').innerHTML = \`
                <div class="header">
                    <h1>💰 \${data.name}'s Expenses</h1>
                </div>
                <div class="stats">
                    <div class="stat"><h3>Today</h3><div>$\${data.today.total.toFixed(0)}</div></div>
                    <div class="stat"><h3>Week</h3><div>$\${data.week.total.toFixed(0)}</div></div>
                    <div class="stat"><h3>Month</h3><div>$\${data.month.total.toFixed(0)}</div></div>
                </div>
                <div class="card">
                    <h2>📋 Recent Activity</h2>
                    <div>\${data.expenses.map(e => \`
                        <div class="expense-item">
                            <div class="expense-left">
                                <div class="expense-emoji">\${emojis[e.category] || '📦'}</div>
                                <div>
                                    <div style="font-weight:500">\${e.description}</div>
                                    <div style="font-size:0.8rem;color:#94a3b8">\${new Date(e.date).toLocaleDateString()}</div>
                                </div>
                            </div>
                            <div class="expense-amount">-$\${parseFloat(e.amount).toFixed(2)}</div>
                        </div>
                    \`).join('')}</div>
                </div>
            \`;
        }
        load();
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(dashboardHTML));

app.get('/api/dashboard', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
        const userId = await validateToken(token);
        if (!userId) return res.status(401).json({ error: 'Invalid token' });

        const [today, week, month, expenses] = await Promise.all([
            getTodayTotal(userId),
            getWeeklyTotal(userId),
            getMonthlyTotal(userId),
            getRecentExpenses(userId, 20)
        ]);

        // Get user name
        const userRes = await db.query('SELECT name FROM telegram_users WHERE user_id = $1', [userId]);

        res.json({
            name: userRes.rows[0]?.name || 'User',
            today, week, month, expenses
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== TELEGRAM BOT ==============

if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        try {
            const userId = msg.from.id.toString();
            const text = msg.text;
            const firstName = msg.from.first_name || 'User';

            if (!text) return;

            // Ensure user exists
            await ensureUser(userId, firstName);

            const parsed = parseExpenseMessage(text);

            switch (parsed.type) {
                case 'help':
                    await bot.sendMessage(chatId, `💰 *Expense Bot*\nAdd: \`coffee 5\`\nCheck: \`?\`, \`??\`, \`???\`\nDash: \`$\``, { parse_mode: 'Markdown' });
                    break;

                case 'add':
                    const cat = parsed.category || autoCategory(parsed.description) || 'other';
                    await addExpense(userId, parsed.description, parsed.amount, cat);
                    const today = await getTodayTotal(userId);
                    await bot.sendMessage(chatId, `✅ Added: ${parsed.description} ($${parsed.amount})\n📊 Today: $${today.total.toFixed(2)}`);
                    break;

                case 'dashboard':
                    const token = await generateAccessToken(userId);
                    // Use Render URL if available, else localhost
                    const url = `${BASE_URL}/?token=${token}`;
                    await bot.sendMessage(chatId, `📊 *Dashboard Link:*\n${url}\n_(Valid for 30 mins)_`, { parse_mode: 'Markdown' });
                    break;

                case 'today':
                    const t = await getTodayTotal(userId);
                    await bot.sendMessage(chatId, `📊 Today: $${t.total.toFixed(2)}`);
                    break;

                case 'week':
                    const w = await getWeeklyTotal(userId);
                    await bot.sendMessage(chatId, `📊 Week: $${w.total.toFixed(2)}`);
                    break;

                case 'month':
                    const m = await getMonthlyTotal(userId);
                    await bot.sendMessage(chatId, `📊 Month: $${m.total.toFixed(2)}`);
                    break;

                case 'delete':
                    const del = await deleteLastExpense(userId);
                    await bot.sendMessage(chatId, del ? `🗑️ Deleted: ${del.description}` : '❌ Nothing to delete');
                    break;

                default:
                    await bot.sendMessage(chatId, `❓ Unknown command. Try \`help\``);
            }
        } catch (e) {
            console.error(e);
            await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
    });

    console.log('🤖 Bot started');
}

// Start Server
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`🌍 Server running on port ${PORT}`);
    });
});
