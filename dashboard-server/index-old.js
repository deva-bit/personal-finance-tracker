const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const dbConfig = {
  host: 'postgres',
  port: 5432,
  database: 'n8n',
  user: 'n8n',
  password: 'n8n123'
};

// API endpoint to get expenses
app.get('/api/expenses/monthly', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    const phoneFilter = req.query.phone;
    let query = `
      SELECT 
        SUM(amount) as total,
        COUNT(*) as count
      FROM expenses
      WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `;
    
    if (phoneFilter) {
      query += ` AND phone_number = $1`;
      const result = await client.query(query, [phoneFilter]);
      res.json(result.rows[0]);
    } else {
      const result = await client.query(query);
      res.json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

app.get('/api/expenses/weekly', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    const phoneFilter = req.query.phone;
    let query = `
      SELECT 
        SUM(amount) as total,
        COUNT(*) as count
      FROM expenses
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `;
    
    if (phoneFilter) {
      query += ` AND phone_number = $1`;
      const result = await client.query(query, [phoneFilter]);
      res.json(result.rows[0]);
    } else {
      const result = await client.query(query);
      res.json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

app.get('/api/expenses/by-category', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    const phoneFilter = req.query.phone;
    let query = `
      SELECT 
        category,
        COUNT(*) as count,
        SUM(amount) as total
      FROM expenses
      WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `;
    
    if (phoneFilter) {
      query += ` AND phone_number = $1`;
    }
    query += `
      GROUP BY category
      ORDER BY total DESC
    `;
    
    const result = phoneFilter ? 
      await client.query(query, [phoneFilter]) : 
      await client.query(query);
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

app.get('/api/expenses/recent', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    const phoneFilter = req.query.phone;
    let query = `
      SELECT 
        TO_CHAR(date, 'DD/MM/YYYY') as date,
        description,
        category,
        amount,
        TO_CHAR(created_at, 'DD/MM HH24:MI') as added_on
      FROM expenses
    `;
    
    if (phoneFilter) {
      query += ` WHERE phone_number = $1`;
    }
    query += `
      ORDER BY created_at DESC
      LIMIT 20
    `;
    
    const result = phoneFilter ? 
      await client.query(query, [phoneFilter]) : 
      await client.query(query);
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// New endpoint to get list of phone numbers
app.get('/api/expenses/phones', async (req, res) => {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    
    const result = await client.query(`
      SELECT 
        phone_number,
        COUNT(*) as count
      FROM expenses
      GROUP BY phone_number
      ORDER BY count DESC
    `);
    
    res.json({ phones: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Dashboard server running on http://localhost:${PORT}`);
});
