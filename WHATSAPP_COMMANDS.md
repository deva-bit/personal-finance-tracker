# WhatsApp Expense Tracker - Commands Guide

## 📱 How to Add Expenses

Send a message in this format:

```
expense [description] [amount] [category]
```

### Examples:

1. **With category:**
   ```
   expense lunch 25.50 food
   ```
   ✅ Records: RM 25.50 for lunch in the food category

2. **Without category (uses "general"):**
   ```
   expense taxi 15
   ```
   ✅ Records: RM 15 for taxi in the general category

3. **More examples:**
   ```
   expense coffee 8.50 food
   expense movie 25 entertainment
   expense groceries 150 food
   expense petrol 80 transport
   expense electricity 200 bills
   ```

## 📊 Message Format Breakdown

```
expense [description] [amount] [category]
   │         │           │         │
   │         │           │         └─ Optional: food, transport, bills, entertainment, etc.
   │         │           └─ Required: Any number (e.g., 25, 25.50)
   │         └─ Required: Short description (one word, no spaces)
   └─ Required: Must start with "expense"
```

## ✅ What You'll Get Back

After sending an expense, you'll receive a confirmation:

```
✅ Expense added!
💰 Amount: $25.50
🏷️ Description: lunch
🗂️ Category: food
```

## 🌐 View Your Dashboard

Your personal dashboard link:
```
http://localhost:8080?phone=YOUR_PHONE_NUMBER
```

*(You'll get this link when the bot starts)*

## 📝 Important Notes

1. **Description must be one word** (use dashes for multi-word: `grocery-shopping`)
2. **Amount can have decimals** (25.50 is valid)
3. **Category is optional** (defaults to "general" if not provided)
4. **Case doesn't matter** ("expense", "Expense", "EXPENSE" all work)
5. **Each expense is linked to your phone number** - your girlfriend's expenses are separate!

## 🗑️ Delete Expenses

To delete an expense:
1. Open your dashboard at http://localhost:8080?phone=YOUR_PHONE_NUMBER
2. Click the red "Delete" button next to any expense
3. Confirm the deletion

## 👥 Multi-User Support

- Each phone number has its own separate expenses
- Your girlfriend can use the same bot with her phone
- She'll get her own dashboard link: `http://localhost:8080?phone=HER_PHONE_NUMBER`
- Your expenses never mix!

## 🎯 Quick Tips

**Best practices:**
- Use clear, short descriptions
- Use consistent categories (food, transport, bills, entertainment, etc.)
- Check your dashboard regularly to see spending patterns

**Common categories to use:**
- `food` - meals, groceries, snacks
- `transport` - petrol, taxi, parking
- `bills` - electricity, water, internet
- `entertainment` - movies, games, hobbies
- `shopping` - clothes, gadgets
- `health` - medicine, doctor visits
- `general` - anything else
