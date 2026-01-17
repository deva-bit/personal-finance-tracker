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
    // Self-references (so 'food 10' -> category: food)
    'food': 'food', 'transport': 'transport', 'shopping': 'shopping',
    'bills': 'bills', 'entertainment': 'entertainment', 'health': 'health',
    'subscription': 'subscription', 'other': 'other',

    // Synonyms
    'coffee': 'food', 'kopi': 'food', 'teh': 'food', 'lunch': 'food', 'dinner': 'food',
    'breakfast': 'food', 'brunch': 'food', 'supper': 'food', 'snack': 'food', 'bubble tea': 'food',
    'bbt': 'food', 'makan': 'food', 'eat': 'food', 'meal': 'food', 'drink': 'food',
    'hawker': 'food', 'kopitiam': 'food', 'restaurant': 'food', 'cafe': 'food',
    'mcdonalds': 'food', 'mcd': 'food', 'kfc': 'food', 'subway': 'food', 'starbucks': 'food',
    'pizza': 'food', 'nasi': 'food', 'chicken': 'food', 'rice': 'food', 'noodle': 'food',

    'grab': 'transport', 'gojek': 'transport', 'uber': 'transport', 'taxi': 'transport', 'cab': 'transport',
    'mrt': 'transport', 'bus': 'transport', 'train': 'transport', 'petrol': 'transport', 'gas': 'transport',
    'fuel': 'transport', 'parking': 'transport', 'toll': 'transport', 'erp': 'transport', 'ezlink': 'transport',

    'ntuc': 'shopping', 'fairprice': 'shopping', 'giant': 'shopping', 'shopee': 'shopping',
    'lazada': 'shopping', 'amazon': 'shopping', 'clothes': 'shopping', 'grocery': 'shopping',
    'buy': 'shopping', 'supermarket': 'shopping', 'markt': 'shopping', 'uniqlo': 'shopping',

    'electric': 'bills', 'electricity': 'bills', 'water': 'bills', 'gas': 'bills',
    'phone': 'bills', 'mobile': 'bills', 'internet': 'bills', 'wifi': 'bills', 'rent': 'bills',
    'singtel': 'bills', 'starhub': 'bills', 'm1': 'bills',

    'netflix': 'subscription', 'spotify': 'subscription', 'youtube': 'subscription',
    'disney': 'subscription', 'gym': 'subscription', 'chatgpt': 'subscription', 'prime': 'subscription',
    'icloud': 'subscription',

    'movie': 'entertainment', 'cinema': 'entertainment', 'karaoke': 'entertainment', 'game': 'entertainment',
    'steam': 'subscription', 'ticket': 'entertainment',

    'doctor': 'health', 'clinic': 'health', 'medicine': 'health', 'pharmacy': 'health', 'panadol': 'health'
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
                currency VARCHAR(10) DEFAULT '$',
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

        // Migration: Add currency column if it doesn't exist (for existing users)
        try {
            await db.query(`ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT '$'`);
        } catch (e) {
            // Ignore error if column exists
        }

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

async function getUserCurrency(userId) {
    const res = await db.query(`SELECT currency FROM telegram_users WHERE user_id = $1`, [userId]);
    return res.rows[0]?.currency || '$';
}

async function setUserCurrency(userId, currency) {
    await db.query(`UPDATE telegram_users SET currency = $1 WHERE user_id = $2`, [currency.toUpperCase(), userId]);
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

async function updateExpense(id, userId, description, amount, category) {
    const res = await db.query(`
        UPDATE telegram_expenses
        SET description = $1, amount = $2, category = $3
        WHERE id = $4 AND user_id = $5
        RETURNING *
    `, [description, amount, category, id, userId]);
    return res.rows[0];
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

    // 1. Check exact match
    if (AUTO_CATEGORIES[desc]) return AUTO_CATEGORIES[desc];

    // 2. Check if description contains keyword (whole word match preferred)
    for (const [keyword, category] of Object.entries(AUTO_CATEGORIES)) {
        // Use regex for whole word match to avoid 'business' matching 'bus'
        const regex = new RegExp(`\\b${keyword}\\b`);
        if (regex.test(desc)) return category;
    }

    // 3. Fallback: partial match
    for (const [keyword, category] of Object.entries(AUTO_CATEGORIES)) {
        if (desc.includes(keyword)) return category;
    }

    return 'other'; // Default is now 'other' instead of null, but addExpense handles null
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

    const currencyMatch = text.match(/^currency\s+([a-zA-Z$]+)$/);
    if (currencyMatch) return { type: 'setcurrency', currency: currencyMatch[1] };

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
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-sub: #94a3b8;
            --accent: #3b82f6;
            --success: #22c55e;
            --danger: #ef4444;
            --warning: #eab308;
            --input-bg: #334155;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { 
            font-family: 'Outfit', sans-serif; 
            background: var(--bg); 
            color: var(--text-main); 
            padding: 20px; 
            min-height: 100vh;
        }
        .container { max-width: 600px; margin: 0 auto; padding-bottom: 80px; }
        
        /* Header */
        .header { 
            margin-bottom: 30px; 
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 { font-size: 1.5rem; font-weight: 700; }
        .badge { 
            background: rgba(59, 130, 246, 0.1); 
            color: var(--accent); 
            padding: 5px 12px; 
            border-radius: 20px; 
            font-size: 0.85rem; 
            font-weight: 600;
        }

        /* Summary Cards */
        .summary-grid { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 12px; 
            margin-bottom: 24px; 
        }
        .stat-card { 
            background: var(--card-bg); 
            padding: 16px; 
            border-radius: 16px; 
            text-align: center;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .stat-label { font-size: 0.75rem; color: var(--text-sub); margin-bottom: 4px; font-weight: 500; }
        .stat-value { font-size: 1.1rem; font-weight: 700; color: var(--text-main); }
        .stat-card.today .stat-value { color: var(--accent); }

        /* Generic Cards */
        .section-card {
            background: var(--card-bg);
            border-radius: 20px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .section-title { font-size: 1.1rem; font-weight: 600; }
        
        /* Budget */
        .budget-info { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 8px; }
        .progress-track { background: #334155; height: 12px; border-radius: 6px; overflow: hidden; }
        .progress-fill { height: 100%; transition: width 1s ease; border-radius: 6px; }
        
        /* Charts */
        .chart-container { position: relative; height: 250px; width: 100%; display: flex; justify-content: center; }

        /* Expense List */
        .expense-list { display: flex; flex-direction: column; gap: 12px; }
        .expense-item { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding-bottom: 12px;
            border-bottom: 1px solid #334155;
        }
        .expense-item:last-child { border-bottom: none; padding-bottom: 0; }
        
        .expense-left { display: flex; align-items: center; gap: 14px; }
        .icon-box { 
            width: 42px; height: 42px; 
            border-radius: 12px; 
            background: #334155; 
            display: flex; align-items: center; justify-content: center; 
            font-size: 1.25rem; 
        }
        .expense-details h4 { font-size: 0.95rem; font-weight: 600; margin-bottom: 2px; }
        .expense-details p { font-size: 0.75rem; color: var(--text-sub); }
        .expense-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
        .expense-amount { font-weight: 600; font-size: 1rem; color: var(--text-main); }
        .actions { display: flex; gap: 10px; }
        .action-btn { font-size: 0.75rem; color: var(--text-sub); cursor: pointer; background: none; border: none; padding: 0; }
        .action-btn.edit { color: var(--accent); }
        .action-btn.delete { color: var(--danger); }
        
        /* Floating Action Button */
        .fab {
            position: fixed;
            bottom: 33px;
            right: 30px;
            width: 56px;
            height: 56px;
            background: var(--accent);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
            cursor: pointer;
            transition: transform 0.2s;
            color: white;
            z-index: 100;
        }
        .fab:hover { transform: scale(1.05); }

        /* Modal */
        .modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            display: flex; justify-content: center; align-items: flex-end; /* Mobile bottom sheet style */
            z-index: 200;
            opacity: 0; pointer-events: none; transition: opacity 0.3s;
        }
        .modal-overlay.active { opacity: 1; pointer-events: auto; }
        
        .modal {
            background: var(--card-bg);
            width: 100%; max-width: 500px;
            border-radius: 20px 20px 0 0;
            padding: 24px;
            transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative; /* For close button positioning */
        }
        .modal-overlay.active .modal { transform: translateY(0); }
        @media(min-width: 500px) {
            .modal-overlay { align-items: center; }
            .modal { border-radius: 20px; transform: scale(0.9); transition: transform 0.2s; }
            .modal-overlay.active .modal { transform: scale(1); }
        }

        .form-group { margin-bottom: 16px; }
        .form-label { display: block; margin-bottom: 8px; font-size: 0.9rem; color: var(--text-sub); }
        .form-input, .form-select {
            width: 100%; padding: 12px;
            background: var(--input-bg);
            border: 1px solid transparent;
            border-radius: 12px;
            color: var(--text-main);
            font-family: inherit; font-size: 1rem;
            outline: none;
        }
        .form-input:focus { border-color: var(--accent); }
        .modal-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 20px; }
        .btn-primary {
            width: 100%; padding: 14px;
            background: var(--accent); color: white;
            border: none; border-radius: 12px;
            font-size: 1rem; font-weight: 600;
            cursor: pointer; margin-top: 10px;
        }
        .btn-close {
            position: absolute; top: 24px; right: 24px;
            background: none; border: none; color: var(--text-sub); font-size: 1.5rem; cursor: pointer;
        }

        .loading, .error { text-align: center; padding: 40px; color: var(--text-sub); }
        .error { color: var(--danger); }
        .empty-state { text-align: center; padding: 30px 0; color: var(--text-sub); font-size: 0.9rem; }
    </style>
</head>
<body>
    <div id="app" class="container">
        <div class="loading"><h2>💰 Loading...</h2></div>
    </div>

    <!-- ADD/EDIT MODAL -->
    <div class="modal-overlay" id="expenseModal">
        <div class="modal">
            <button class="btn-close" onclick="closeModal()">×</button>
            <h2 class="modal-title" id="modalTitle">Add Expense</h2>
            <form id="expenseForm" onsubmit="handleFormSubmit(event)">
                <input type="hidden" id="expenseId">
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <input type="text" id="descInput" class="form-input" placeholder="e.g., Lunch" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Amount</label>
                    <input type="number" id="amountInput" class="form-input" step="0.01" placeholder="0.00" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Category</label>
                    <select id="catInput" class="form-select">
                        <!-- Populated by JS -->
                    </select>
                </div>
                <button type="submit" class="btn-primary" id="modalBtn">Save Expense</button>
            </form>
        </div>
    </div>

    <div class="fab" onclick="openAddModal()">+</div>

    <script>
        const emojis = ${JSON.stringify(CATEGORIES)};
        const categoriesList = Object.keys(emojis);
        let currentToken = '';
        let currentData = null;

        // Populate Categories
        const catSelect = document.getElementById('catInput');
        categoriesList.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
            catSelect.appendChild(opt);
        });

        async function load() {
            currentToken = new URLSearchParams(window.location.search).get('token');
            if(!currentToken) return showError('Link expired. Return to Telegram.');
            
            try {
                const res = await fetch('/api/dashboard?token=' + currentToken);
                if(!res.ok) throw new Error('Refresh link via Telegram ($)');
                currentData = await res.json();
                render(currentData);
            } catch(e) {
                showError(e.message);
            }
        }

        function render(data) {
            const cur = data.currency || '$';
            const budgetPercent = data.budget.budget > 0 
                ? Math.min(100, (data.budget.spent / data.budget.budget) * 100) 
                : 0;
            
            let progressBarColor = 'var(--success)';
            if (budgetPercent > 80) progressBarColor = 'var(--warning)';
            if (budgetPercent >= 100) progressBarColor = 'var(--danger)';

            const hasExpenses = data.expenses.length > 0;
            const hasCategories = Object.keys(data.categories).length > 0;

            let html = '';
            
            // Header
            html += \`
                <div class="header">
                    <h1>Hi, \${data.name.split(' ')[0]} 👋</h1>
                    <span class="badge">\${cur}</span>
                </div>

                <div class="summary-grid">
                    <div class="stat-card today">
                        <div class="stat-label">TODAY</div>
                        <div class="stat-value">\${cur}\${data.today.total.toFixed(2)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">WEEK</div>
                        <div class="stat-value">\${cur}\${data.week.total.toFixed(2)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">MONTH</div>
                        <div class="stat-value">\${cur}\${data.month.total.toFixed(2)}</div>
                    </div>
                </div>\`;

            // Budget
            if (data.budget.budget > 0) {
                html += \`
                <div class="section-card">
                    <div class="section-header" style="margin-bottom:12px">
                        <div class="section-title">Monthly Budget</div>
                        <div style="font-weight:600; font-size:0.9rem">\${budgetPercent.toFixed(0)}%</div>
                    </div>
                    <div class="budget-info">
                        <span>Spent: \${cur}\${data.budget.spent.toFixed(2)}</span>
                        <span style="opacity:0.6">Target: \${cur}\${data.budget.budget.toFixed(0)}</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: \${budgetPercent}%; background: \${progressBarColor}"></div>
                    </div>
                    <div style="text-align:right; font-size:0.8rem; margin-top:8px; color:var(--text-sub)">
                        \${data.budget.remaining < 0 ? 'Over by' : 'Left:'} 
                        <span style="color:\${data.budget.remaining < 0 ? 'var(--danger)' : 'var(--success)'}">
                            \${cur}\${Math.abs(data.budget.remaining).toFixed(2)}
                        </span>
                    </div>
                </div>\`;
            }

            // Charts
            html += \`
                <div class="section-card">
                    <div class="section-header">
                        <div class="section-title">Spending Breakdown</div>
                    </div>
                    \${hasCategories ? \`
                        <div class="chart-container">
                            <canvas id="expensesChart"></canvas>
                        </div>
                    \` : '<div class="empty-state">No data this month yet 📉</div>'}
                </div>\`;

            // Recent Activity
            html += \`
                <div class="section-card">
                    <div class="section-header">
                        <div class="section-title">Recent Activity</div>
                    </div>
                    <div class="expense-list">
                        \${hasExpenses ? data.expenses.map(e => \`
                            <div class="expense-item">
                                <div class="expense-left">
                                    <div class="icon-box">\${emojis[e.category] || '📦'}</div>
                                    <div class="expense-details">
                                        <h4>\${e.description}</h4>
                                        <p>\${new Date(e.date).toLocaleDateString('en-US', {month:'short', day:'numeric'})} • \${e.category}</p>
                                    </div>
                                </div>
                                <div class="expense-right">
                                    <div class="expense-amount">-\${cur}\${parseFloat(e.amount).toFixed(2)}</div>
                                    <div class="actions">
                                        <button class="action-btn edit" onclick="openEditModal(\${e.id})">Edit</button>
                                        <button class="action-btn delete" onclick="deleteExpense(\${e.id})">Delete</button>
                                    </div>
                                </div>
                            </div>
                        \`).join('') : '<div class="empty-state">No transactions yet 🎉</div>'}
                    </div>
                </div>\`;
            
            document.getElementById('app').innerHTML = html;

            if (hasCategories) renderChart(data.categories);
        }

        function renderChart(categories) {
            const ctx = document.getElementById('expensesChart').getContext('2d');
            const labels = []; const values = []; const colors = [];
            
            const catColors = {food: '#f59e0b', transport: '#3b82f6', shopping: '#ec4899', bills: '#ef4444', entertainment: '#8b5cf6', health: '#10b981', subscription: '#6366f1', other: '#64748b'};

            Object.entries(categories).filter(([, val]) => val > 0).sort(([, a], [, b]) => b - a).forEach(([cat, val]) => {
                    labels.push(cat.charAt(0).toUpperCase() + cat.slice(1));
                    values.push(val); colors.push(catColors[cat] || '#cbd5e1');
            });

            if(window.myChart) window.myChart.destroy();
            window.myChart = new Chart(ctx, {
                type: 'doughnut',
                data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, cutout: '70%' }
            });
        }
        
        // MODAL LOGIC
        function openAddModal() {
            document.getElementById('modalTitle').innerText = 'Add Expense';
            document.getElementById('modalBtn').innerText = 'Add Expense';
            document.getElementById('expenseId').value = '';
            document.getElementById('descInput').value = '';
            document.getElementById('amountInput').value = '';
            document.getElementById('catInput').value = 'food';
            document.getElementById('expenseModal').classList.add('active');
        }

        function openEditModal(id) {
            const exp = currentData.expenses.find(e => e.id == id);
            if(!exp) return;
            document.getElementById('modalTitle').innerText = 'Edit Expense';
            document.getElementById('modalBtn').innerText = 'Save Changes';
            document.getElementById('expenseId').value = exp.id;
            document.getElementById('descInput').value = exp.description;
            document.getElementById('amountInput').value = exp.amount;
            document.getElementById('catInput').value = exp.category;
            document.getElementById('expenseModal').classList.add('active');
        }

        function closeModal() {
            document.getElementById('expenseModal').classList.remove('active');
        }

        async function handleFormSubmit(e) {
            e.preventDefault();
            const id = document.getElementById('expenseId').value;
            const desc = document.getElementById('descInput').value;
            const amount = document.getElementById('amountInput').value;
            const category = document.getElementById('catInput').value;

            const url = id ? ('/api/expenses/' + id) : '/api/expenses';
            const method = id ? 'PUT' : 'POST';

            try {
                const res = await fetch(url + '?token=' + currentToken, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc, amount: amount, category: category })
                });
                
                if(res.ok) {
                    closeModal();
                    load();
                } else {
                    alert('Error saving expense');
                }
            } catch(e) {
                alert('Connection error');
            }
        }

        async function deleteExpense(id) {
            if(!confirm('Delete this expense?')) return;
            try {
                await fetch('/api/expenses/' + id + '?token=' + currentToken, { method: 'DELETE' });
                load();
            } catch(e) { alert('Error deleting'); }
        }
        
        function showError(msg) { document.getElementById('app').innerHTML = `< div class="error" ><h3>❌ Error</h3><p>${msg}</p></div > `; }

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

        const [today, week, month, expenses, budget, categories, currency] = await Promise.all([
            getTodayTotal(userId),
            getWeeklyTotal(userId),
            getMonthlyTotal(userId),
            getRecentExpenses(userId, 20),
            getBudgetStatus(userId),
            getCategoryBreakdown(userId),
            getUserCurrency(userId)
        ]);

        // Get user name
        const userRes = await db.query('SELECT name FROM telegram_users WHERE user_id = $1', [userId]);

        res.json({
            name: userRes.rows[0]?.name || 'User',
            currency,
            today, week, month, expenses, budget, categories
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// NEW ROUTES 
app.post('/api/expenses', async (req, res) => {
    const token = req.query.token;
    const { description, amount, category } = req.body;

    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
        const userId = await validateToken(token);
        if (!userId) return res.status(401).json({ error: 'Invalid token' });

        const expense = await addExpense(userId, description, amount, category || 'other');
        res.json(expense);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/expenses/:id', async (req, res) => {
    const token = req.query.token;
    const { id } = req.params;
    const { description, amount, category } = req.body;

    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
        const userId = await validateToken(token);
        if (!userId) return res.status(401).json({ error: 'Invalid token' });

        const expense = await updateExpense(id, userId, description, amount, category);
        if (!expense) return res.status(404).json({ error: 'Not found' });
        res.json(expense);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    const token = req.query.token;
    const expenseId = req.params.id;

    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
        const userId = await validateToken(token);
        if (!userId) return res.status(401).json({ error: 'Invalid token' });

        // Delete only if expense belongs to user
        const result = await db.query('DELETE FROM telegram_expenses WHERE id = $1 AND user_id = $2 RETURNING *', [expenseId, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Expense not found or unauthorized' });
        }

        res.json({ success: true, deleted: result.rows[0] });
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
            const cur = await getUserCurrency(userId);

            const parsed = parseExpenseMessage(text);

            switch (parsed.type) {
                case 'help':
                    await bot.sendMessage(chatId, `💰 *Expense Bot*\nAdd: \`coffee 5\`\nCheck: \`?\`, \`??\`, \`???\`\nDash: \`$\`\n\nSet Currency: \`currency SGD\``, { parse_mode: 'Markdown' });
                    break;

                case 'setcurrency':
                    await setUserCurrency(userId, parsed.currency);
                    await bot.sendMessage(chatId, `💱 Currency set to *${parsed.currency.toUpperCase()}*`, { parse_mode: 'Markdown' });
                    break;

                case 'setbudget':
                    await setBudget(userId, parsed.amount);
                    await bot.sendMessage(chatId, `💼 Budget set to *${cur}${parsed.amount.toFixed(2)}*`, { parse_mode: 'Markdown' });
                    break;

                case 'add':
                    const cat = parsed.category || autoCategory(parsed.description) || 'other';
                    await addExpense(userId, parsed.description, parsed.amount, cat);
                    const today = await getTodayTotal(userId);
                    await bot.sendMessage(chatId, `✅ Added: ${parsed.description} (${cur}${parsed.amount.toFixed(2)})\n📊 Today: ${cur}${today.total.toFixed(2)}`);
                    break;

                case 'dashboard':
                    const token = await generateAccessToken(userId);
                    // Use Render URL if available, else localhost
                    const url = `${BASE_URL}/?token=${token}`;
                    await bot.sendMessage(chatId, `📊 *Dashboard Link:*\n${url}\n_(Valid for 30 mins)_`, { parse_mode: 'Markdown' });
                    break;

                case 'today':
                    const t = await getTodayTotal(userId);
                    await bot.sendMessage(chatId, `📊 Today: ${cur}${t.total.toFixed(2)}`);
                    break;

                case 'week':
                    const w = await getWeeklyTotal(userId);
                    await bot.sendMessage(chatId, `📊 Week: ${cur}${w.total.toFixed(2)}`);
                    break;

                case 'month':
                    const m = await getMonthlyTotal(userId);
                    await bot.sendMessage(chatId, `📊 Month: ${cur}${m.total.toFixed(2)}`);
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
