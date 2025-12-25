const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const axios = require('axios');
const express = require('express');
const path = require('path');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://n8n:5678/webhook/whatsapp-webhook';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:8080';

// Store QR code and status
let currentQR = null;
let currentStatus = 'loading';
let connectedPhone = null;

// Track recently sent messages to avoid processing them when they echo back
const recentlySentMessages = new Set();

function addToRecentlySent(messageBody) {
    recentlySentMessages.add(messageBody);
    // Clean up after 5 seconds
    setTimeout(() => {
        recentlySentMessages.delete(messageBody);
    }, 5000);
}

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
    
    // Get the connected phone number
    const info = await client.info;
    const phoneNumber = info.wid.user;
    connectedPhone = phoneNumber;
    const dashboardLink = `${DASHBOARD_URL}?phone=${phoneNumber}`;
    
    console.log('\n🔗 Your Personal Dashboard Link:');
    console.log(dashboardLink);
    console.log('\n📋 Save this link to view your expenses!\n');
});

// Listen for all messages (both incoming and outgoing)
client.on('message_create', async (message) => {
    const messageBody = message.body || '';
    
    // Skip empty messages
    if (!messageBody || messageBody.trim() === '') {
        return;
    }
    
    // Skip messages that look like bot responses (to prevent echo loop)
    const isBotResponse = messageBody.includes('What category?') || 
                         messageBody.includes('How much?') || 
                         messageBody.includes('Description?') ||
                         messageBody.includes('Expense added!') ||
                         messageBody.includes('Invalid amount') ||
                         messageBody.includes('Monthly total') ||
                         messageBody.startsWith('📝') ||
                         messageBody.startsWith('💰') ||
                         messageBody.startsWith('📋') ||
                         messageBody.startsWith('✅') ||
                         messageBody.startsWith('❌') ||
                         messageBody.startsWith('👋');
    
    if (isBotResponse) {
        console.log(`⏭️ Skipping bot response: ${messageBody.substring(0, 50)}`);
        return;
    }
    
    console.log(`📩 Received: ${messageBody} from ${message.from} (fromMe: ${message.fromMe})`);
    
    try {
        // Send message to n8n webhook
        const response = await axios.post(N8N_WEBHOOK_URL, {
            body: {
                data: {
                    message: {
                        conversation: messageBody
                    },
                    key: {
                        remoteJid: message.from
                    }
                }
            }
        });

        // Send reply back if n8n returns a response (only for messages you sent, not received)
        if (response.data && response.data.reply && message.fromMe) {
            const replyText = response.data.reply;
            await message.reply(replyText);
        }
    } catch (error) {
        console.error('Error sending to n8n:', error.message);
    }
});

// Express server for API and web interface - Start FIRST
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// QR Code image endpoint
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
// Status API for QR page
app.get('/api/status', (req, res) => {
    res.json({
        status: currentStatus,
        qr: currentQR,
        phoneNumber: connectedPhone,
        dashboardUrl: DASHBOARD_URL
    });
});

// Send WhatsApp message function (for n8n to call)
app.post('/send', async (req, res) => {
    const { number, text } = req.body;
    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, text);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 WhatsApp API server running on port ${PORT}`);
    console.log(`🌐 QR Code page: http://localhost:${PORT}/qr.html`);
});

// Initialize WhatsApp client AFTER server starts
client.initialize();


