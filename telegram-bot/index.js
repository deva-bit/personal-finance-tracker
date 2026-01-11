const TelegramBot = require('node-telegram-bot-api');
const { Client } = require('pg');
const axios = require('axios');

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://expense-dashboard-0fto.onrender.com';

// Valid categories
const VALID_CATEGORIES = ['food', 'transport', 'shopping', 'bills', 'entertainment', 'health', 'subscription', 'other'];

// Auto-categorization for common items
const AUTO_CATEGORIES = {
    // Food & Drinks
    'coffee': 'food', 'kopi': 'food', 'teh': 'food', 'lunch': 'food', 'dinner': 'food',
    'breakfast': 'food', 'brunch': 'food', 'supper': 'food', 'snack': 'food', 'bubble tea': 'food',
    'bbt': 'food', 'makan': 'food', 'food': 'food', 'eat': 'food', 'meal': 'food',
    'hawker': 'food', 'kopitiam': 'food', 'foodcourt': 'food', 'restaurant': 'food',
    'mcdonalds': 'food', 'mcd': 'food', 'kfc': 'food', 'subway': 'food', 'starbucks': 'food',
    'nasi': 'food', 'mee': 'food', 'rice': 'food', 'chicken': 'food',
    // Transport
    'grab': 'transport', 'gojek': 'transport', 'uber': 'transport', 'taxi': 'transport',
    'mrt': 'transport', 'bus': 'transport', 'train': 'transport', 'petrol': 'transport',
    'fuel': 'transport', 'parking': 'transport', 'toll': 'transport',
    // Shopping
    'ntuc': 'shopping', 'fairprice': 'shopping', 'cold storage': 'shopping', 'giant': 'shopping',
    'shopee': 'shopping', 'lazada': 'shopping', 'amazon': 'shopping', 'uniqlo': 'shopping',
    'clothes': 'shopping', 'shoes': 'shopping', 'grocery': 'shopping',
    // Bills
    'electric': 'bills', 'electricity': 'bills', 'water': 'bills', 'gas': 'bills',
    'phone': 'bills', 'mobile': 'bills', 'internet': 'bills', 'wifi': 'bills', 'rent': 'bills',
    // Subscriptions
    'netflix': 'subscription', 'spotify': 'subscription', 'youtube': 'subscription',
    'disney': 'subscription', 'hbo': 'subscription', 'gym': 'subscription',
    // Entertainment
    'movie': 'entertainment', 'cinema': 'entertainment', 'concert': 'entertainment',
    'karaoke': 'entertainment', 'game': 'entertainment',
    // Health
    'doctor': 'health', 'clinic': 'health', 'hospital': 'health', 'medicine': 'health',
    'pharmacy': 'health', 'dental': 'health', 'vitamin': 'health'
};

// Smart auto-categorize function
function autoCategory(description) {
    const desc = description.toLowerCase();
    if (AUTO_CATEGORIES[desc]) return AUTO_CATEGORIES[desc];
    for (const [keyword, category] of Object.entries(AUTO_CATEGORIES)) {
        if (desc.includes(keyword)) return category;
    }
    return null;
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram Expense Bot starting...');

// Database helper
async function getDb() {
    const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return client;
}

// ============== DATABASE FUNCTIONS ==============

async function addExpense(telegramId, description, amount, category) {
    const client = await getDb();
    try {
        await client.query(
            `INSERT INTO expenses (phone_number, description, amount, category, date)
             VALUES ($1, $2, $3, $4, NOW())`,
            [telegramId.toString(), description, amount, category]
        );
        return true;
    } finally {
        await client.end();
    }
}

async function getTodayTotal(telegramId) {
    const client = await getDb();
    try {
        const result = await client.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses
             WHERE phone_number = $1
             AND date >= CURRENT_DATE`,
            [telegramId.toString()]
        );
        return result.rows[0];
    } finally {
        await client.end();
    }
}

async function getWeeklyTotal(telegramId) {
    const client = await getDb();
    try {
        const result = await client.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses
             WHERE phone_number = $1
             AND date >= CURRENT_DATE - INTERVAL '7 days'`,
            [telegramId.toString()]
        );
        return result.rows[0];
    } finally {
        await client.end();
    }
}

async function getMonthlyTotal(telegramId) {
    const client = await getDb();
    try {
        const result = await client.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
             FROM expenses
             WHERE phone_number = $1
             AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
            [telegramId.toString()]
        );
        return result.rows[0];
    } finally {
        await client.end();
    }
}

async function deleteLastExpense(telegramId) {
    const client = await getDb();
    try {
        const result = await client.query(
            `DELETE FROM expenses
             WHERE id = (
                 SELECT id FROM expenses
                 WHERE phone_number = $1
                 ORDER BY date DESC, id DESC
                 LIMIT 1
             )
             RETURNING description, amount`,
            [telegramId.toString()]
        );
        return result.rows[0];
    } finally {
        await client.end();
    }
}

async function getRecentExpenses(telegramId, limit = 5) {
    const client = await getDb();
    try {
        const result = await client.query(
            `SELECT description, amount, category, date
             FROM expenses
             WHERE phone_number = $1
             ORDER BY date DESC, id DESC
             LIMIT $2`,
            [telegramId.toString(), limit]
        );
        return result.rows;
    } finally {
        await client.end();
    }
}

// ============== PIN MANAGEMENT ==============

const crypto = require('crypto');

function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex').substring(0, 16);
}

async function setUserPin(telegramId, pin) {
    const client = await getDb();
    try {
        const hashedPin = hashPin(pin);
        await client.query(
            `INSERT INTO users (phone_number, pin)
             VALUES ($1, $2)
             ON CONFLICT (phone_number)
             DO UPDATE SET pin = $2`,
            [telegramId.toString(), hashedPin]
        );
        return true;
    } finally {
        await client.end();
    }
}

// ============== DASHBOARD TOKEN ==============

async function getDashboardToken(telegramId) {
    try {
        const response = await axios.post(`${DASHBOARD_URL}/api/create-access-token`, {
            phone: telegramId.toString(),
            secret: process.env.SHARED_SECRET || 'expense-tracker-2024'
        });
        return response.data.token;
    } catch (error) {
        console.error('Failed to get dashboard token:', error.message);
        return null;
    }
}

// ============== MESSAGE PARSING ==============

function parseExpenseMessage(message) {
    const text = message.trim().toLowerCase();

    // Shortcuts
    if (text === '?' || text === 'today') return { type: 'today' };
    if (text === '??' || text === 'week') return { type: 'week' };
    if (text === 'month') return { type: 'month' };
    if (text === '$' || text === 'dashboard') return { type: 'dashboard' };
    if (text === '!' || text === 'delete' || text === 'undo') return { type: 'delete' };
    if (text === 'help' || text === '/help' || text === '/start') return { type: 'help' };
    if (text === 'recent' || text === 'history') return { type: 'recent' };

    // PIN: "pin 1234"
    const pinMatch = text.match(/^pin\s+(\d{4,})$/);
    if (pinMatch) return { type: 'pin', pin: pinMatch[1] };

    // Expense: "coffee 5" or "coffee 5.50" or "food coffee 5"
    // Pattern 1: "description amount" - e.g., "coffee 5"
    const simpleMatch = text.match(/^([a-z\s]+?)\s+(\d+\.?\d*)$/);
    if (simpleMatch) {
        return {
            type: 'add',
            description: simpleMatch[1].trim(),
            amount: parseFloat(simpleMatch[2]),
            category: null // Will be auto-detected
        };
    }

    // Pattern 2: "category description amount" - e.g., "food coffee 5"
    const fullMatch = text.match(/^([a-z]+)\s+([a-z\s]+?)\s+(\d+\.?\d*)$/);
    if (fullMatch && VALID_CATEGORIES.includes(fullMatch[1])) {
        return {
            type: 'add',
            category: fullMatch[1],
            description: fullMatch[2].trim(),
            amount: parseFloat(fullMatch[3])
        };
    }

    return { type: 'unknown' };
}

// ============== MESSAGE HANDLER ==============

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text;

    if (!text) return;

    console.log(`📩 [${telegramId}] ${text}`);

    const parsed = parseExpenseMessage(text);

    try {
        switch (parsed.type) {
            case 'help':
                const helpMessage = `
💰 *Expense Tracker Bot*

*Quick Commands:*
• \`coffee 5\` → Add expense
• \`?\` → Today's total
• \`??\` → This week
• \`$\` → Dashboard link
• \`!\` → Delete last
• \`pin 1234\` → Set PIN

*Examples:*
\`lunch 12.50\`
\`grab 8\`
\`shopping clothes 50\`

*Categories:* food, transport, shopping, bills, entertainment, health, subscription, other

Auto-detects: coffee, grab, mrt, netflix, etc.
                `;
                await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
                break;

            case 'add':
                let category = parsed.category;
                if (!category) {
                    category = autoCategory(parsed.description) || 'other';
                }
                await addExpense(telegramId, parsed.description, parsed.amount, category);
                await bot.sendMessage(chatId, `✅ Added: ${parsed.description} - $${parsed.amount.toFixed(2)} (${category})`);
                break;

            case 'today':
                const today = await getTodayTotal(telegramId);
                await bot.sendMessage(chatId, `📊 *Today*\n💵 Total: $${parseFloat(today.total).toFixed(2)}\n📝 ${today.count} expenses`, { parse_mode: 'Markdown' });
                break;

            case 'week':
                const week = await getWeeklyTotal(telegramId);
                await bot.sendMessage(chatId, `📊 *This Week*\n💵 Total: $${parseFloat(week.total).toFixed(2)}\n📝 ${week.count} expenses`, { parse_mode: 'Markdown' });
                break;

            case 'month':
                const month = await getMonthlyTotal(telegramId);
                await bot.sendMessage(chatId, `📊 *This Month*\n💵 Total: $${parseFloat(month.total).toFixed(2)}\n📝 ${month.count} expenses`, { parse_mode: 'Markdown' });
                break;

            case 'delete':
                const deleted = await deleteLastExpense(telegramId);
                if (deleted) {
                    await bot.sendMessage(chatId, `🗑️ Deleted: ${deleted.description} - $${parseFloat(deleted.amount).toFixed(2)}`);
                } else {
                    await bot.sendMessage(chatId, `❌ No expenses to delete`);
                }
                break;

            case 'pin':
                await setUserPin(telegramId, parsed.pin);
                await bot.sendMessage(chatId, `🔒 PIN set successfully!`);
                break;

            case 'dashboard':
                const token = await getDashboardToken(telegramId);
                if (token) {
                    await bot.sendMessage(chatId, `📊 *Your Dashboard*\n\n${DASHBOARD_URL}?token=${token}\n\n_Link valid for 30 minutes_`, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, `❌ Failed to generate dashboard link. Try again.`);
                }
                break;

            case 'recent':
                const expenses = await getRecentExpenses(telegramId);
                if (expenses.length === 0) {
                    await bot.sendMessage(chatId, `📝 No recent expenses`);
                } else {
                    let list = '*Recent Expenses:*\n\n';
                    expenses.forEach((e, i) => {
                        const date = new Date(e.date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
                        list += `${i + 1}. ${e.description} - $${parseFloat(e.amount).toFixed(2)} (${e.category}) - ${date}\n`;
                    });
                    await bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
                }
                break;

            case 'unknown':
                await bot.sendMessage(chatId, `❓ I didn't understand that.\n\nTry: \`coffee 5\` or type \`help\``, { parse_mode: 'Markdown' });
                break;
        }
    } catch (error) {
        console.error('Error:', error);
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

console.log('✅ Telegram Expense Bot is running!');
