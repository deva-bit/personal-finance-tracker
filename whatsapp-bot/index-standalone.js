const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const { Client: PgClient } = require('pg');

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

// ============== PIN MANAGEMENT ==============

async function setUserPin(phoneNumber, pin) {
    const pgClient = new PgClient(dbConfig);
    try {
        await pgClient.connect();
        // Create users table if not exists
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                phone_number VARCHAR(20) PRIMARY KEY,
                pin VARCHAR(4) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // Upsert PIN
        const result = await pgClient.query(
            `INSERT INTO users (phone_number, pin) VALUES ($1, $2)
             ON CONFLICT (phone_number) DO UPDATE SET pin = $2
             RETURNING *`,
            [phoneNumber, pin]
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
                const expense = await addExpense(phoneNumber, parsed.description, parsed.amount, parsed.category);
                const todayData = await getTodayTotal(phoneNumber);
                return `✅ Added: ${parsed.description}\n💰 Amount: $${parsed.amount}\n📁 Category: ${parsed.category}\n\n📊 Today's total: $${parseFloat(todayData.total).toFixed(2)}`;
            
            case 'monthly':
                const monthly = await getMonthlyTotal(phoneNumber);
                return `📊 Monthly Summary\n\n💰 Total: $${parseFloat(monthly.total).toFixed(2)}\n📝 Expenses: ${monthly.count}`;
            
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
                return `🔗 Your Dashboard:\n${DASHBOARD_URL}?phone=${phoneNumber}\n\n🔒 You'll need your PIN to access it.`;
            
            case 'setpin':
                await setUserPin(phoneNumber, parsed.pin);
                return `🔒 PIN set successfully!\n\nNow you can access your dashboard securely.\nSend "dashboard" to get your link.`;
            
            case 'edit':
                const updated = await updateExpense(parsed.id, phoneNumber, parsed.description, parsed.amount, parsed.category);
                if (updated) {
                    return `✏️ Updated expense #${parsed.id}:\n${parsed.description} - $${parsed.amount} (${parsed.category})`;
                }
                return '❌ Expense not found or you cannot edit it.';
            
            case 'help':
                return `📱 *Expense Tracker Commands*\n
*Add Expense:*
• add lunch 15 food
• add taxi 20 transport
• 25 food dinner (quick format)

*View Reports:*
• today - Today's total  
• week - Weekly total
• monthly - Monthly total
• recent - Last 5 expenses

*Edit & Delete:*
• edit [id] [desc] [amount] [category]
• delete - Remove last expense

*Security & Dashboard:*
• pin 1234 - Set your dashboard PIN
• dashboard - Get your secure link

*Categories:* food, transport, shopping, bills, entertainment, health, other`;
            
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
