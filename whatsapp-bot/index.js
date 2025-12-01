const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://n8n:5678/webhook/whatsapp-webhook';

client.on('qr', (qr) => {
    console.log('\n=================================');
    console.log('Scan this QR code with WhatsApp:');
    console.log('=================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=================================');
});

client.on('ready', () => {
    console.log('✅ WhatsApp bot is ready!');
    console.log('📱 Send messages to track expenses');
});

// Listen for message_create instead of message to capture both incoming and outgoing
client.on('message_create', async (message) => {
    console.log(`📩 Received: ${message.body} from ${message.from}`);
    
    try {
        // Send message to n8n webhook
        const response = await axios.post(N8N_WEBHOOK_URL, {
            body: {
                data: {
                    message: {
                        conversation: message.body
                    },
                    key: {
                        remoteJid: message.from
                    }
                }
            }
        });

        // Send reply back if n8n returns a response
        if (response.data && response.data.reply) {
            await message.reply(response.data.reply);
        }
    } catch (error) {
        console.error('Error sending to n8n:', error.message);
    }
});

client.initialize();

// Send WhatsApp message function (for n8n to call)
const express = require('express');
const app = express();
app.use(express.json());

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
});
