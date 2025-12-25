const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const { Client: PgClient } = require('pg');
const crypto = require('crypto');

// Valid categories - for validation
const VALID_CATEGORIES = ['food', 'transport', 'shopping', 'bills', 'entertainment', 'health', 'subscription', 'other'];

// Hash PIN for security
function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex').substring(0, 16);
}

// WhatsApp Client Setup
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--disable-features=site-per-process',
            '--disable-web-security'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    }
});

// Configuration
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:8080';

// Database connection - supports Neon (cloud) or local Docker
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || 'postgres',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'n8n',
        user: process.env.DB_USER || 'n8n',
        password: process.env.DB_PASSWORD || 'n8n123'
    };

// Store QR code and status
let currentQR = null;
let currentStatus = 'loading';
let connectedPhone = null;

// ============== DATABASE FUNCTIONS ==============

async function addExpense(phoneNumber, description, amount, category) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `INSERT INTO expenses (phone_number, description, amount, category, date, created_at) 
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [phoneNumber, description, amount, category]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getMonthlyTotal(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses 
             WHERE phone_number = $1 
             AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NOW())
             AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM NOW())`,
            [phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getWeeklyTotal(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses 
             WHERE phone_number = $1 
             AND date >= NOW() - INTERVAL '7 days'`,
            [phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getTodayTotal(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses 
             WHERE phone_number = $1 
             AND DATE(date) = CURRENT_DATE`,
            [phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getRecentExpenses(phoneNumber, limit = 5) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT description, amount, category, TO_CHAR(date, 'DD/MM') as date
             FROM expenses 
             WHERE phone_number = $1 
             ORDER BY created_at DESC LIMIT $2`,
            [phoneNumber, limit]
        );
        return result.rows;
    } finally {
        await pgClient.end();
    }
}

async function deleteLastExpense(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `DELETE FROM expenses 
             WHERE id = (SELECT id FROM expenses WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1)
             RETURNING *`,
            [phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function addBudget(phoneNumber, category, amount) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `INSERT INTO budgets (phone_number, category, amount, created_at) 
             VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [phoneNumber, category, amount]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getBudget(phoneNumber, category) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT amount FROM budgets WHERE phone_number = $1 AND category = $2`,
            [phoneNumber, category]
        );
        return result.rows[0]?.amount || 0;
    } finally {
        await pgClient.end();
    }
}

async function deleteBudget(phoneNumber, category) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `DELETE FROM budgets WHERE phone_number = $1 AND category = $2 RETURNING *`,
            [phoneNumber, category]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function addRecurringExpense(phoneNumber, description, amount, category, frequency) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `INSERT INTO recurring_expenses (phone_number, description, amount, category, frequency, next_date, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 ' || $5, NOW()) RETURNING *`,
            [phoneNumber, description, amount, category, frequency]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getRecurringExpenses(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT description, amount, category, frequency, TO_CHAR(next_date, 'DD/MM') as next_date
             FROM recurring_expenses 
             WHERE phone_number = $1 
             ORDER BY created_at DESC`,
            [phoneNumber]
        );
        return result.rows;
    } finally {
        await pgClient.end();
    }
}

async function deleteRecurringExpense(phoneNumber, id) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `DELETE FROM recurring_expenses WHERE phone_number = $1 AND id = $2 RETURNING *`,
            [phoneNumber, id]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

// ============== PIN MANAGEMENT ==============

async function setUserPin(phoneNumber, pin) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        // Create users table if not exists
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                phone_number VARCHAR(20) PRIMARY KEY,
                pin VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // Upsert PIN
        const result = await pgClient.query(
            `INSERT INTO users (phone_number, pin) VALUES ($1, $2)
             ON CONFLICT (phone_number) DO UPDATE SET pin = $2
             RETURNING *`,
            [phoneNumber, hashPin(pin)]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getUserPin(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT pin FROM users WHERE phone_number = $1`,
            [phoneNumber]
        );
        return result.rows[0]?.pin || null;
    } finally {
        await pgClient.end();
    }
}

async function updateExpense(expenseId, phoneNumber, description, amount, category) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `UPDATE expenses 
             SET description = $1, amount = $2, category = $3
             WHERE id = $4 AND phone_number = $5
             RETURNING *`,
            [description, amount, category, expenseId, phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

// ============== BUDGET MANAGEMENT ==============

async function setBudget(phoneNumber, amount) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        // Add monthly_budget column if not exists
        await pgClient.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_budget DECIMAL(10,2) DEFAULT 0
        `).catch(() => {});
        
        await pgClient.query(
            `UPDATE users SET monthly_budget = $1 WHERE phone_number = $2`,
            [amount, phoneNumber]
        );
        return amount;
    } finally {
        await pgClient.end();
    }
}

async function getBudgetStatus(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const budgetResult = await pgClient.query(
            `SELECT monthly_budget FROM users WHERE phone_number = $1`,
            [phoneNumber]
        );
        const budget = parseFloat(budgetResult.rows[0]?.monthly_budget || 0);
        
        const spentResult = await pgClient.query(
            `SELECT COALESCE(SUM(amount), 0) as spent FROM expenses 
             WHERE phone_number = $1 
             AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NOW())
             AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM NOW())`,
            [phoneNumber]
        );
        const spent = parseFloat(spentResult.rows[0].spent);
        
        return { budget, spent, remaining: budget - spent, percentage: budget > 0 ? (spent / budget * 100) : 0 };
    } finally {
        await pgClient.end();
    }
}

// ============== RECURRING EXPENSES ==============

async function addRecurring(phoneNumber, description, amount, category, dayOfMonth) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        // Create recurring table if not exists
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS recurring_expenses (
                id SERIAL PRIMARY KEY,
                phone_number VARCHAR(20),
                description VARCHAR(255),
                amount DECIMAL(10,2),
                category VARCHAR(50),
                day_of_month INT DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        const result = await pgClient.query(
            `INSERT INTO recurring_expenses (phone_number, description, amount, category, day_of_month)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [phoneNumber, description, amount, category, dayOfMonth]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

async function getRecurringExpenses(phoneNumber) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT * FROM recurring_expenses WHERE phone_number = $1 AND is_active = true ORDER BY day_of_month`,
            [phoneNumber]
        );
        return result.rows;
    } finally {
        await pgClient.end();
    }
}

async function deleteRecurring(phoneNumber, id) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `UPDATE recurring_expenses SET is_active = false WHERE id = $1 AND phone_number = $2 RETURNING *`,
            [id, phoneNumber]
        );
        return result.rows[0];
    } finally {
        await pgClient.end();
    }
}

// ============== EXPORT FUNCTION ==============

async function getMonthlyExportData(phoneNumber, month, year) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            `SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, description, category, amount
             FROM expenses 
             WHERE phone_number = $1 
             AND EXTRACT(MONTH FROM date) = $2
             AND EXTRACT(YEAR FROM date) = $3
             ORDER BY date`,
            [phoneNumber, month, year]
        );
        return result.rows;
    } finally {
        await pgClient.end();
    }
}

// ============== CATEGORY VALIDATION ==============

function validateCategory(category) {
    const cat = category.toLowerCase();
    if (VALID_CATEGORIES.includes(cat)) {
        return cat;
    }
    // Try to match partial
    const match = VALID_CATEGORIES.find(c => c.startsWith(cat) || cat.startsWith(c));
    return match || 'other';
}

// ============== MESSAGE PARSING ==============

function parseExpenseMessage(message) {
    const msg = message.toLowerCase().trim();
    
    // Pattern: add [description] [amount] [category]
    // Example: add lunch 15 food
    const addPattern = /^add\s+(.+?)\s+(\d+(?:\.\d{1,2})?)\s+(\w+)$/i;
    const match = msg.match(addPattern);
    
    if (match) {
        return {
            type: 'add',
            description: match[1].trim(),
            amount: parseFloat(match[2]),
            category: match[3].toLowerCase()
        };
    }
    
    // Quick add pattern: [amount] [category] [description]
    // Example: 15 food lunch
    const quickPattern = /^(\d+(?:\.\d{1,2})?)\s+(\w+)\s+(.+)$/i;
    const quickMatch = msg.match(quickPattern);
    
    if (quickMatch) {
        return {
            type: 'add',
            amount: parseFloat(quickMatch[1]),
            category: quickMatch[2].toLowerCase(),
            description: quickMatch[3].trim()
        };
    }
    
    // Commands
    if (msg === 'total' || msg === 'monthly' || msg === 'month') {
        return { type: 'monthly' };
    }
    if (msg === 'week' || msg === 'weekly') {
        return { type: 'weekly' };
    }
    if (msg === 'today' ) {
        return { type: 'today' };
    }
    if (msg === 'recent' || msg === 'last' || msg === 'history') {
        return { type: 'recent' };
    }
    if (msg === 'delete' || msg === 'undo' || msg === 'remove') {
        return { type: 'delete' };
    }
    if (msg === 'help' || msg === '?') {
        return { type: 'help' };
    }
    if (msg === 'dashboard' || msg === 'link') {
        return { type: 'dashboard' };
    }
    
    // PIN command: pin 1234 or set pin 1234
    if (msg.startsWith('pin ') || msg.startsWith('set pin ')) {
        const pin = msg.replace('set ', '').replace('pin ', '').trim();
        if (pin && pin.length === 4 && !isNaN(pin)) {
            return { type: 'setpin', pin };
        }
    }
    
    // Reset PIN command
    if (msg === 'reset pin' || msg === 'forgot pin') {
        return { type: 'resetpin' };
    }
    
    // Budget commands
    if (msg === 'budget' || msg === 'budget status') {
        return { type: 'budgetstatus' };
    }
    
    // Set budget: budget 500
    const setBudgetPattern = /^budget\s+(\d+(?:\.\d{1,2})?)$/i;
    const setBudgetMatch = msg.match(setBudgetPattern);
    if (setBudgetMatch) {
        return { type: 'setbudget', amount: parseFloat(setBudgetMatch[1]) };
    }
    
    // Recurring: recurring netflix 15 subscription 1 (day 1 of month)
    const recurPattern = /^recurring\s+(.+?)\s+(\d+(?:\.\d{1,2})?)\s+(\w+)\s+(\d{1,2})$/i;
    const recurMatch = msg.match(recurPattern);
    if (recurMatch) {
        return {
            type: 'addrecurring',
            description: recurMatch[1].trim(),
            amount: parseFloat(recurMatch[2]),
            category: recurMatch[3].toLowerCase(),
            day: parseInt(recurMatch[4])
        };
    }
    
    // List recurring
    if (msg === 'recurring' || msg === 'recurring list') {
        return { type: 'listrecurring' };
    }
    
    // Delete recurring: stop recurring 1
    const stopRecurPattern = /^stop\s+recurring\s+(\d+)$/i;
    const stopRecurMatch = msg.match(stopRecurPattern);
    if (stopRecurMatch) {
        return { type: 'stoprecurring', id: parseInt(stopRecurMatch[1]) };
    }
    
    // Export command
    if (msg === 'export' || msg === 'export csv') {
        return { type: 'export' };
    }
    
    // Edit command: edit [id] [description] [amount] [category]
    const editPattern = /^edit\s+(\d+)\s+(.+?)\s+(\d+(?:\.\d{1,2})?)\s+(\w+)$/i;
    const editMatch = msg.match(editPattern);
    if (editMatch) {
        return {
            type: 'edit',
            id: parseInt(editMatch[1]),
            description: editMatch[2].trim(),
            amount: parseFloat(editMatch[3]),
            category: editMatch[4].toLowerCase()
        };
    }
    
    return { type: 'unknown' };
}

// ============== MESSAGE HANDLING ==============

async function handleMessage(messageBody, phoneNumber) {
    const parsed = parseExpenseMessage(messageBody);
    
    try {
        switch (parsed.type) {
            case 'add':
                // Validate category
                const validCategory = validateCategory(parsed.category);
                const expense = await addExpense(phoneNumber, parsed.description, parsed.amount, validCategory);
                const todayData = await getTodayTotal(phoneNumber);
                
                // Check budget alert
                const budgetInfo = await getBudgetStatus(phoneNumber);
                let budgetAlert = '';
                if (budgetInfo.budget > 0) {
                    if (budgetInfo.percentage >= 100) {
                        budgetAlert = `\n\n🚨 *BUDGET EXCEEDED!* You've spent $${budgetInfo.spent.toFixed(2)} of $${budgetInfo.budget.toFixed(2)}`;
                    } else if (budgetInfo.percentage >= 80) {
                        budgetAlert = `\n\n⚠️ *Budget Alert:* ${budgetInfo.percentage.toFixed(0)}% used ($${budgetInfo.remaining.toFixed(2)} left)`;
                    }
                }
                
                let categoryNote = '';
                if (validCategory !== parsed.category) {
                    categoryNote = `\n(Changed "${parsed.category}" → "${validCategory}")`;
                }
                
                return `✅ Added: ${parsed.description}\n💰 Amount: $${parsed.amount}\n📁 Category: ${validCategory}${categoryNote}\n\n📊 Today's total: $${parseFloat(todayData.total).toFixed(2)}${budgetAlert}`;
            
            case 'monthly':
                const monthly = await getMonthlyTotal(phoneNumber);
                const monthBudget = await getBudgetStatus(phoneNumber);
                let monthBudgetInfo = '';
                if (monthBudget.budget > 0) {
                    monthBudgetInfo = `\n\n💼 Budget: $${monthBudget.budget.toFixed(2)}\n📊 Used: ${monthBudget.percentage.toFixed(0)}%\n💵 Remaining: $${monthBudget.remaining.toFixed(2)}`;
                }
                return `📊 Monthly Summary\n\n💰 Total: $${parseFloat(monthly.total).toFixed(2)}\n📝 Expenses: ${monthly.count}${monthBudgetInfo}`;
            
            case 'weekly':
                const weekly = await getWeeklyTotal(phoneNumber);
                return `📊 Weekly Summary (Last 7 days)\n\n💰 Total: $${parseFloat(weekly.total).toFixed(2)}\n📝 Expenses: ${weekly.count}`;
            
            case 'today':
                const today = await getTodayTotal(phoneNumber);
                return `📊 Today's Summary\n\n💰 Total: $${parseFloat(today.total).toFixed(2)}\n📝 Expenses: ${today.count}`;
            
            case 'recent':
                const recent = await getRecentExpenses(phoneNumber);
                if (recent.length === 0) {
                    return '📋 No recent expenses found.';
                }
                let recentList = '📋 Recent Expenses:\n\n';
                recent.forEach((exp, i) => {
                    recentList += `${i + 1}. ${exp.description} - $${exp.amount} (${exp.category}) - ${exp.date}\n`;
                });
                return recentList;
            
            case 'delete':
                const deleted = await deleteLastExpense(phoneNumber);
                if (deleted) {
                    return `🗑️ Deleted: ${deleted.description} - $${deleted.amount}`;
                }
                return '❌ No expense to delete.';
            
            case 'dashboard':
                const hasPin = await getUserPin(phoneNumber);
                if (!hasPin) {
                    return `⚠️ Please set a PIN first for dashboard security!\n\nSend: pin 1234\n(Use any 4 digits you'll remember)`;
                }
                return `🔗 Your Dashboard:\n${DASHBOARD_URL}/dashboard.html?phone=${phoneNumber}\n\n🔒 You'll need your PIN to access it.`;
            
            case 'setpin':
                await setUserPin(phoneNumber, parsed.pin);
                return `🔒 PIN set successfully!\n\nNow you can access your dashboard securely.\nSend "dashboard" to get your link.`;
            
            case 'resetpin':
                // Generate random 4-digit PIN
                const newPin = Math.floor(1000 + Math.random() * 9000).toString();
                await setUserPin(phoneNumber, newPin);
                return `🔑 Your new PIN is: *${newPin}*\n\nPlease remember this PIN!\nYou can change it anytime by sending: pin XXXX`;
            
            case 'edit':
                const editCategory = validateCategory(parsed.category);
                const updated = await updateExpense(parsed.id, phoneNumber, parsed.description, parsed.amount, editCategory);
                if (updated) {
                    return `✏️ Updated expense #${parsed.id}:\n${parsed.description} - $${parsed.amount} (${editCategory})`;
                }
                return '❌ Expense not found or you cannot edit it.';
            
            case 'setbudget':
                await setBudget(phoneNumber, parsed.amount);
                return `💼 Monthly budget set to: $${parsed.amount}\n\nI'll alert you when you reach 80% and 100%!`;
            
            case 'budgetstatus':
                const status = await getBudgetStatus(phoneNumber);
                if (status.budget === 0) {
                    return `💼 No budget set.\n\nTo set a monthly budget, send:\nbudget 500`;
                }
                const progressBar = '█'.repeat(Math.min(10, Math.floor(status.percentage / 10))) + '░'.repeat(Math.max(0, 10 - Math.floor(status.percentage / 10)));
                return `� Budget Status\n\n${progressBar} ${status.percentage.toFixed(0)}%\n\n💰 Budget: $${status.budget.toFixed(2)}\n💸 Spent: $${status.spent.toFixed(2)}\n💵 Remaining: $${status.remaining.toFixed(2)}`;
            
            case 'addrecurring':
                const recurCategory = validateCategory(parsed.category);
                const recur = await addRecurring(phoneNumber, parsed.description, parsed.amount, recurCategory, parsed.day);
                return `🔄 Recurring expense added!\n\n📝 ${parsed.description}\n💰 $${parsed.amount} (${recurCategory})\n📅 Every month on day ${parsed.day}`;
            
            case 'listrecurring':
                const recurList = await getRecurringExpenses(phoneNumber);
                if (recurList.length === 0) {
                    return `🔄 No recurring expenses.\n\nTo add one, send:\nrecurring netflix 15 subscription 1\n(netflix, $15, subscription, day 1 of month)`;
                }
                let listText = '🔄 Recurring Expenses:\n\n';
                recurList.forEach((r, i) => {
                    listText += `${r.id}. ${r.description} - $${r.amount} (${r.category}) - Day ${r.day_of_month}\n`;
                });
                listText += '\nTo stop: stop recurring [id]';
                return listText;
            
            case 'stoprecurring':
                const stopped = await deleteRecurring(phoneNumber, parsed.id);
                if (stopped) {
                    return `✅ Stopped recurring: ${stopped.description}`;
                }
                return '❌ Recurring expense not found.';
            
            case 'export':
                const now = new Date();
                const exportData = await getMonthlyExportData(phoneNumber, now.getMonth() + 1, now.getFullYear());
                if (exportData.length === 0) {
                    return '📋 No expenses to export this month.';
                }
                let csv = 'Date,Description,Category,Amount\n';
                let total = 0;
                exportData.forEach(e => {
                    csv += `${e.date},${e.description},${e.category},${e.amount}\n`;
                    total += parseFloat(e.amount);
                });
                csv += `\nTOTAL,,,${total.toFixed(2)}`;
                return `📊 Export (${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()})\n\n\`\`\`\n${csv}\n\`\`\`\n\n💡 Copy this and paste into Excel/Google Sheets`;
            
            case 'help':
                return `📱 *Expense Tracker Commands*\n
*Add Expense:*
• add lunch 15 food
• 25 food dinner (quick format)

*View Reports:*
• today - Today's total  
• week - Weekly total
• monthly - Monthly total
• recent - Last 5 expenses

*Budget:*
• budget 500 - Set monthly budget
• budget - View budget status

*Recurring:*
• recurring netflix 15 sub 1 - Add (day 1)
• recurring - List all
• stop recurring 1 - Stop by ID

*Edit & Delete:*
• edit [id] [desc] [amt] [cat]
• delete - Remove last

*Other:*
• pin 1234 - Set dashboard PIN
• reset pin - Forgot PIN? Get new one
• dashboard - Get your link
• export - Export to CSV

*Categories:* food, transport, shopping, bills, entertainment, health, subscription, other`;
            
            default:
                return null; // Don't reply to unknown messages
        }
    } catch (error) {
        console.error('Error handling message:', error);
        return '❌ Sorry, something went wrong. Please try again.';
    }
}

// ============== WHATSAPP EVENTS ==============

client.on('qr', (qr) => {
    currentQR = qr;
    currentStatus = 'qr';
    console.log('\n=================================');
    console.log('Scan this QR code with WhatsApp:');
    console.log('=================================\n');
    qrcodeTerminal.generate(qr, { small: true });
    console.log('\n=================================');
    console.log('\n🌐 Or open: http://localhost:3000/qr.html\n');
});

client.on('ready', async () => {
    currentStatus = 'ready';
    console.log('✅ WhatsApp bot is ready!');
    console.log('📱 Send messages to track expenses');
    
    const info = await client.info;
    const phoneNumber = info.wid.user;
    connectedPhone = phoneNumber;
    const dashboardLink = `${DASHBOARD_URL}?phone=${phoneNumber}`;
    
    console.log('\n🔗 Your Personal Dashboard Link:');
    console.log(dashboardLink);
    console.log('\n📋 Save this link to view your expenses!\n');
});

client.on('message_create', async (message) => {
    const messageBody = message.body || '';
    
    // Skip empty messages
    if (!messageBody || messageBody.trim() === '') {
        return;
    }
    
    // Only process messages from yourself (your own WhatsApp)
    if (!message.fromMe) {
        return;
    }
    
    // Skip bot responses to prevent loops
    const isBotResponse = messageBody.startsWith('✅') ||
                         messageBody.startsWith('📊') ||
                         messageBody.startsWith('📋') ||
                         messageBody.startsWith('🗑️') ||
                         messageBody.startsWith('🔗') ||
                         messageBody.startsWith('📱') ||
                         messageBody.startsWith('❌');
    
    if (isBotResponse) {
        return;
    }
    
    console.log(`📩 Received: ${messageBody}`);
    
    // Extract phone number
    const phoneNumber = connectedPhone || message.from.replace('@c.us', '');
    
    // Handle the message
    const reply = await handleMessage(messageBody, phoneNumber);
    
    if (reply) {
        await message.reply(reply);
        console.log(`📤 Replied: ${reply.substring(0, 50)}...`);
    }
});

client.on('auth_failure', (msg) => {
    currentStatus = 'error';
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    currentStatus = 'disconnected';
    console.log('📴 WhatsApp disconnected:', reason);
});

// ============== EXPRESS SERVER ==============

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/qr-image', async (req, res) => {
    try {
        if (!currentQR) {
            return res.status(404).send('QR code not available');
        }
        const qrImage = await QRCode.toDataURL(currentQR, { width: 300, margin: 2 });
        res.json({ image: qrImage });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        status: currentStatus,
        qr: currentQR,
        phoneNumber: connectedPhone,
        dashboardUrl: DASHBOARD_URL
    });
});

// Health check endpoint for uptime monitors
app.get('/health', (req, res) => {
    res.json({ status: 'ok', whatsapp: currentStatus });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 WhatsApp API server running on port ${PORT}`);
    console.log(`🌐 QR Code page: http://localhost:${PORT}/qr.html`);
});

// Initialize WhatsApp client with retry
async function initializeWhatsApp() {
    try {
        console.log('🚀 Starting WhatsApp client...');
        await client.initialize();
    } catch (error) {
        console.error('❌ WhatsApp initialization failed:', error.message);
        console.log('🔄 Retrying in 10 seconds...');
        setTimeout(initializeWhatsApp, 10000);
    }
}

initializeWhatsApp();
