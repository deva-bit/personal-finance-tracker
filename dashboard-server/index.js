const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory token storage (tokens expire in 10 minutes)
const accessTokens = new Map();

// Hash PIN for security (must match whatsapp-bot)
function hashPin(pin) {
    return crypto.createHash('sha256').update(pin).digest('hex').substring(0, 16);
}

// Generate secure access token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Session storage (phone -> session token after PIN verified)
const sessions = new Map();

// Database connection - supports both local Docker and cloud (Neon)
const dbConfig = process.env.DATABASE_URL 
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'postgres',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'n8n',
      user: process.env.DB_USER || 'n8n',
      password: process.env.DB_PASSWORD || 'n8n123'
    };

// Create access token endpoint (called by WhatsApp bot)
app.post('/api/create-access-token', async (req, res) => {
    const { phone, secret } = req.body;
    
    // Verify shared secret
    if (secret !== (process.env.SHARED_SECRET || 'expense-tracker-2024')) {
        return res.status(403).json({ error: 'Invalid secret' });
    }
    
    const token = generateToken();
    const expiry = Date.now() + 30 * 60 * 1000; // 30 minutes (extended from 10)
    
    accessTokens.set(token, { phone, expiry });
    
    // Clean up expired tokens
    for (const [t, data] of accessTokens.entries()) {
        if (data.expiry < Date.now()) accessTokens.delete(t);
    }
    
    res.json({ token });
});

// Root endpoint - handle token-based access
app.get('/', (req, res) => {
  const token = req.query.token;
  
  if (token) {
    // Validate token and redirect to dashboard
    const tokenData = accessTokens.get(token);
    if (tokenData && tokenData.expiry > Date.now()) {
      res.redirect(`/dashboard.html?token=${token}`);
    } else {
      res.status(403).send(`
        <html>
          <head><title>Link Expired</title></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #667eea, #764ba2); margin: 0;">
            <div style="background: white; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px;">
              <h1 style="color: #f59e0b;">⏰ Link Expired</h1>
              <p style="color: #666; margin-top: 15px;">This dashboard link has expired for security.</p>
              <p style="color: #888; margin-top: 20px; font-size: 14px;">Send <code style="background: #f3f4f6; padding: 3px 8px; border-radius: 4px;">dashboard</code> on WhatsApp to get a new link.</p>
            </div>
          </body>
        </html>
      `);
    }
  } else {
    // No token - access denied
    res.status(403).send(`
      <html>
        <head><title>Access Denied</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #667eea, #764ba2); margin: 0;">
          <div style="background: white; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px;">
            <h1 style="color: #dc2626;">🔒 Access Denied</h1>
            <p style="color: #666; margin-top: 15px;">This dashboard can only be accessed through the WhatsApp bot.</p>
            <p style="color: #888; margin-top: 20px; font-size: 14px;">Send <code style="background: #f3f4f6; padding: 3px 8px; border-radius: 4px;">dashboard</code> on WhatsApp to get your personal link.</p>
          </div>
        </body>
      </html>
    `);
  }
});

// Get phone from token (internal helper)
function getPhoneFromToken(token) {
    const tokenData = accessTokens.get(token);
    if (tokenData && tokenData.expiry > Date.now()) {
        return tokenData.phone;
    }
    // Check sessions
    const sessionData = sessions.get(token);
    if (sessionData && sessionData.expiry > Date.now()) {
        return sessionData.phone;
    }
    return null;
}

// PIN verification endpoint
app.post('/api/verify-pin', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const { token, pin } = req.body;
    
    // Get phone from access token
    const phone = getPhoneFromToken(token);
    if (!phone) {
      return res.status(403).json({ valid: false, error: 'Invalid or expired token' });
    }
    
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' });
    }
    
    // Hash the provided PIN and compare
    const hashedPin = hashPin(pin);
    
    const result = await client.query(
      'SELECT pin FROM users WHERE phone_number = $1',
      [phone]
    );
    
    if (result.rows.length === 0) {
      return res.json({ valid: false, error: 'No PIN set. Please set one via WhatsApp: pin 1234' });
    }
    
    const valid = result.rows[0].pin === hashedPin;
    
    if (valid) {
      // Create a long-lived session token (24 hours)
      const sessionToken = generateToken();
      sessions.set(sessionToken, { phone, expiry: Date.now() + 24 * 60 * 60 * 1000 });
      
      // Clean old sessions
      for (const [t, data] of sessions.entries()) {
          if (data.expiry < Date.now()) sessions.delete(t);
      }
      
      res.json({ valid: true, sessionToken });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    console.error('PIN verification error:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    await client.end();
  }
});

// Check if user has PIN set
app.get('/api/has-pin', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const token = req.query.token;
    const phone = getPhoneFromToken(token);
    
    if (!phone) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    const result = await client.query(
      'SELECT 1 FROM users WHERE phone_number = $1',
      [phone]
    );
    
    res.json({ hasPin: result.rows.length > 0 });
  } catch (error) {
    res.json({ hasPin: false });
  } finally {
    await client.end();
  }
});

// Middleware to get phone from session or token
function getPhone(req) {
    const token = req.query.token || req.query.session || req.body.token || req.body.session;
    return getPhoneFromToken(token);
}

// Update expense endpoint
app.put('/api/expenses/:id', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const { description, amount, category } = req.body;
    const phone = getPhone(req);
    const expenseId = req.params.id;
    
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }
    
    const result = await client.query(
      `UPDATE expenses 
       SET description = $1, amount = $2, category = $3
       WHERE id = $4 AND phone_number = $5
       RETURNING *`,
      [description, amount, category, expenseId, phone]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    res.json({ success: true, expense: result.rows[0] });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    await client.end();
  }
});

// Monthly expenses endpoint with date filter
app.get('/api/expenses/monthly', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();

    const phone = getPhone(req);
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }

    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await client.query(`
      SELECT
        SUM(amount) as total,
        COUNT(*) as count
      FROM expenses
      WHERE EXTRACT(MONTH FROM date) = $1
        AND EXTRACT(YEAR FROM date) = $2
        AND phone_number = $3
    `, [month, year, phone]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Weekly expenses endpoint
app.get('/api/expenses/weekly', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();

    const phone = getPhone(req);
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }

    const result = await client.query(`
      SELECT
        SUM(amount) as total,
        COUNT(*) as count
      FROM expenses
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
        AND phone_number = $1
    `, [phone]);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Expenses by category endpoint with date filter
app.get('/api/expenses/by-category', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();

    const phone = getPhone(req);
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }

    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await client.query(`
      SELECT
        category,
        COUNT(*) as count,
        SUM(amount) as total
      FROM expenses
      WHERE EXTRACT(MONTH FROM date) = $1
        AND EXTRACT(YEAR FROM date) = $2
        AND phone_number = $3
      GROUP BY category
      ORDER BY total DESC
    `, [month, year, phone]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Recent expenses endpoint with date filter
app.get('/api/expenses/recent', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();

    const phone = getPhone(req);
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }

    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await client.query(`
      SELECT id, TO_CHAR(date, 'DD/MM/YYYY') as date,
        description,
        category,
        amount,
        TO_CHAR(created_at, 'DD/MM HH24:MI') as added_on
      FROM expenses
      WHERE EXTRACT(MONTH FROM date) = $1
        AND EXTRACT(YEAR FROM date) = $2
        AND phone_number = $3
      ORDER BY created_at DESC
      LIMIT 20
    `, [month, year, phone]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Delete expense endpoint
app.delete('/api/expenses/:id', async (req, res) => {
  const phone = req.query.phone;
  const expenseId = req.params.id;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  const client = new Client(dbConfig);
  try {
    await client.connect();
    const result = await client.query(
      'DELETE FROM expenses WHERE id = $1 AND phone_number = $2 RETURNING *',
      [expenseId, phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    await client.end();
  }
});

// Export to CSV endpoint
app.get('/api/expenses/export', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const phone = getPhone(req);
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }
    
    const result = await client.query(`
      SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, description, category, amount
      FROM expenses 
      WHERE phone_number = $1 
      AND EXTRACT(MONTH FROM date) = $2
      AND EXTRACT(YEAR FROM date) = $3
      ORDER BY date
    `, [phone, month, year]);
    
    // Generate CSV
    let csv = 'Date,Description,Category,Amount\n';
    let total = 0;
    result.rows.forEach(row => {
      csv += `${row.date},"${row.description}",${row.category},${row.amount}\n`;
      total += parseFloat(row.amount);
    });
    csv += `\nTOTAL,,,${total.toFixed(2)}`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=expenses-${year}-${month}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    await client.end();
  }
});

// Budget status endpoint
app.get('/api/budget', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const phone = getPhone(req);
    
    if (!phone) {
      return res.status(403).json({ error: 'Invalid session' });
    }
    
    const budgetResult = await client.query(
      'SELECT monthly_budget FROM users WHERE phone_number = $1',
      [phone]
    );
    const budget = parseFloat(budgetResult.rows[0]?.monthly_budget || 0);
    
    const spentResult = await client.query(`
      SELECT COALESCE(SUM(amount), 0) as spent FROM expenses 
      WHERE phone_number = $1 
      AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM NOW())
      AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM NOW())
    `, [phone]);
    const spent = parseFloat(spentResult.rows[0].spent);
    
    res.json({
      budget,
      spent,
      remaining: budget - spent,
      percentage: budget > 0 ? (spent / budget * 100) : 0
    });
  } catch (error) {
    res.json({ budget: 0, spent: 0, remaining: 0, percentage: 0 });
  } finally {
    await client.end();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'expense-dashboard' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running on port ${PORT}`);
});
