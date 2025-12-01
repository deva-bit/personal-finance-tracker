-- View all expenses for current month
SELECT 
    description,
    amount,
    category,
    date,
    TO_CHAR(created_at, 'DD/MM HH24:MI') as added_at
FROM expenses
WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE)
ORDER BY created_at DESC;

-- Monthly summary by category
SELECT 
    category,
    COUNT(*) as count,
    SUM(amount) as total,
    TO_CHAR(SUM(amount), 'FM999,999.00') as formatted_total
FROM expenses
WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE)
GROUP BY category
ORDER BY total DESC;

-- Monthly total
SELECT 
    TO_CHAR(SUM(amount), 'FM999,999.00') as monthly_total,
    COUNT(*) as total_expenses
FROM expenses
WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE);

-- Daily expenses for current month
SELECT 
    DATE(date) as expense_date,
    COUNT(*) as count,
    TO_CHAR(SUM(amount), 'FM999,999.00') as daily_total
FROM expenses
WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE)
GROUP BY DATE(date)
ORDER BY expense_date DESC;
