// Get the webhook input
const webhookData = $input.first().json;

// The structure is: webhookData.body.body.data.message.conversation
const message = webhookData.body?.body?.data?.message?.conversation || '';
const phone = webhookData.body?.body?.data?.key?.remoteJid || '';

// If message is empty, skip
if (!message) {
  return [];
}

const lowerMessage = message.trim().toLowerCase();
const cleanPhone = phone.replace('@c.us', '').replace('@newsletter', '');

// Handle "report" command
if (lowerMessage === 'report' || lowerMessage === 'summary') {
  return [{
    json: {
      command: 'report',
      phone_number: cleanPhone
    }
  }];
}

// Handle "add" command
if (lowerMessage.startsWith('add')) {
  // Parse message: "add description amount category"
  const parts = message.trim().split(/\s+/);

  if (parts.length < 3) {
    return [];
  }

  const description = parts[1];
  const amount = parseFloat(parts[2]);
  const category = parts[3] || 'general';

  // Validate that amount is a valid number
  if (isNaN(amount) || amount <= 0) {
    return [];
  }

  // Return the parsed data
  return [{
    json: {
      command: 'add',
      amount: amount,
      category: category,
      description: description,
      phone_number: cleanPhone
    }
  }];
}

// Ignore other messages
return [];
