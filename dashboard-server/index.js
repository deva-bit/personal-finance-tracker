const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// Root endpoint - redirect to dashboard
app.get('/', (req, res) => {
  if (req.query.phone) {
    // If phone provided, redirect to dashboard
    res.redirect(`/dashboard.html?phone=${req.query.phone}`);
  } else {
    // No login page - access only via WhatsApp bot link
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

// PIN verification endpoint
app.post('/api/verify-pin', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const { phone, pin } = req.body;
    
    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN required' });
    }
    
    const result = await client.query(
      'SELECT pin FROM users WHERE phone_number = $1',
      [phone]
    );
    
    if (result.rows.length === 0) {
      return res.json({ valid: false, error: 'No PIN set. Please set one via WhatsApp: pin 1234' });
    }
    
    const valid = result.rows[0].pin === pin;
    res.json({ valid });
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
    const phone = req.query.phone;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
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

// Update expense endpoint
app.put('/api/expenses/:id', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const { phone, description, amount, category } = req.body;
    const expenseId = req.params.id;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
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

    const phone = req.query.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
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

    const phone = req.query.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
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

    const phone = req.query.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
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

    const phone = req.query.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'expense-dashboard' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running on port ${PORT}`);
});
