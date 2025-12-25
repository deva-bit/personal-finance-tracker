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

// Root endpoint - show welcome page or dashboard
app.get('/', (req, res) => {
  if (req.query.phone) {
    // If phone provided, redirect to dashboard
    res.redirect(`/dashboard.html?phone=${req.query.phone}`);
  } else {
    // Show welcome/login page
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
