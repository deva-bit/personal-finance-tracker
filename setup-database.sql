-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(10, 2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    phone_number VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX idx_date ON expenses(date);
CREATE INDEX idx_phone ON expenses(phone_number);
CREATE INDEX idx_category ON expenses(category);

-- Sample view for daily totals
CREATE OR REPLACE VIEW daily_expenses AS
SELECT 
    DATE(date) as expense_date,
    phone_number,
    category,
    SUM(amount) as total_amount,
    COUNT(*) as expense_count
FROM expenses
GROUP BY DATE(date), phone_number, category
ORDER BY expense_date DESC;
