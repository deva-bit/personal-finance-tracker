# 💑 How to Use Expense Tracker (For Both of You)

## 🎯 Simple Setup for Your Girlfriend

### Step 1: Link Her WhatsApp to the Bot

**On her phone:**
1. Open WhatsApp
2. Go to **Linked Devices** (tap 3 dots → Linked Devices)
3. Tap **Link a Device**

**On your computer:**
```powershell
docker logs whatsapp-bot
```
4. Show her the QR code on screen
5. She scans it with her phone
6. ✅ Done! Her WhatsApp is now linked

---

## 📱 How to Track Expenses

**Both of you send messages like this:**

```
add lunch 15 food
add taxi 20 transport
add coffee 5 drink
add shopping 80 clothes
```

**Format:** `add [description] [amount] [category]`

---

## 📊 View Your Expenses Separately

**Open Dashboard:** http://localhost:8080

At the top, you'll see a **dropdown menu:**

```
📊 All Expenses          ← Shows combined total
📱 +60146362758 (5)      ← Your expenses
📱 +60123456789 (8)      ← Her expenses
```

**Select your phone number** to see only your expenses!

---

## 🔐 Privacy

- ✅ Each person sees only their data (when filtered)
- ✅ Same database, but filtered by phone number
- ✅ You can see combined total by selecting "All Expenses"

---

## 📈 What the Dashboard Shows

**When filtered by phone:**
- 📅 **Monthly Total** - Only YOUR expenses this month
- 📆 **Weekly Total** - Only YOUR expenses this week
- 📊 **By Category** - YOUR spending breakdown
- 📝 **Recent Expenses** - YOUR last 20 expenses

---

## 💡 Tips

1. **Give her this link:** http://localhost:8080
2. **She can bookmark it** on her phone/laptop
3. **Auto-updates** every 30 seconds
4. **Works on any device** - phone, tablet, laptop

---

## ❓ Common Questions

**Q: Can she see my expenses?**
A: Only if she selects "All Expenses" dropdown. Otherwise, she only sees her own.

**Q: Do we need 2 WhatsApp accounts?**
A: Yes, each person links their own WhatsApp number.

**Q: Can we both add expenses at the same time?**
A: Yes! Completely independent.

**Q: What if we're not together?**
A: She can access the dashboard remotely (need to set up port forwarding or deploy to cloud).

---

## 🚀 Next Steps (Optional)

Want her to access from anywhere? I can help you:
1. Deploy to Railway.app (FREE)
2. Get a web link like: `https://your-expense.railway.app`
3. She accesses from anywhere with internet

Let me know if you want this! 😊
