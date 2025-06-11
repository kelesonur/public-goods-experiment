# 🌐 Online Hosting Guide - Kamusal Mal Oyunu

This guide will help you host your experiment platform online for **FREE** so participants can access it from anywhere in the world.

## 🚀 Option 1: Railway.app (Recommended - Easiest)

### Step 1: Prepare Your Code
```bash
# Make sure all files are ready
git init
git add .
git commit -m "Initial commit - Public Goods Game"
```

### Step 2: Deploy to Railway
1. **Go to [Railway.app](https://railway.app)**
2. **Sign up** with GitHub account (free)
3. **Click "New Project"**
4. **Select "Deploy from GitHub repo"**
5. **Connect your repository**
6. **Railway will auto-deploy!**

### Step 3: Get Your URL
- Railway will give you a URL like: `https://yourapp-production.up.railway.app`
- **Share this URL** with your participants!

### Step 4: Monitor
- **Admin Panel**: `https://yourapp-production.up.railway.app/admin.html`
- **Data Export**: `https://yourapp-production.up.railway.app/api/export-data`

---

## 🌟 Option 2: Render.com (Also Free)

### Step 1: Prepare
```bash
git init
git add .
git commit -m "Public Goods Game Experiment"
git remote add origin https://github.com/yourusername/your-repo.git
git push -u origin main
```

### Step 2: Deploy to Render
1. **Go to [Render.com](https://render.com)**
2. **Sign up** with GitHub
3. **New Web Service**
4. **Connect your GitHub repo**
5. **Settings:**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
6. **Deploy!**

---

## 🔧 Option 3: Heroku (Limited Free Tier)

### Step 1: Install Heroku CLI
```bash
# Install Heroku CLI from https://devcenter.heroku.com/articles/heroku-cli
```

### Step 2: Deploy
```bash
heroku login
heroku create your-experiment-name
git push heroku main
heroku open
```

---

## 📱 Option 4: Vercel + Database (Advanced)

For Vercel, you'd need to modify the app to use a cloud database since it's serverless.

---

## 🎯 Quick Setup (Railway - 5 minutes!)

1. **Create GitHub account** (if you don't have one)
2. **Upload your code** to a GitHub repository
3. **Go to Railway.app** and sign up
4. **Connect GitHub** and select your repo
5. **Wait 2-3 minutes** for deployment
6. **Get your URL** and start testing!

## 🔍 Testing Your Online Deployment

Once deployed, test with:

1. **Open 4 browser tabs** to your online URL
2. **Play through** a complete session
3. **Check admin panel** for data collection
4. **Export data** to verify everything works

## 💾 Data Persistence

- **Railway/Render**: Your SQLite database will persist as long as the service runs
- **For production**: Consider upgrading to PostgreSQL (Railway offers this free too)

## 🔐 Security Notes

- **Admin panel** has no authentication - only share admin URL with researchers
- **Data export** endpoint is open - consider adding password protection for production
- **Participant data** is anonymous by default

## 🌍 Sharing with Participants

Once online, simply share:
```
🎯 Kamusal Mal Oyunu Deneyi
Katılım için: https://your-app-url.railway.app

Deney yaklaşık 10-15 dakika sürmektedir.
4 kişilik gruplar oluşturulmaktadır.
```

## 📊 Monitoring Your Online Experiment

- **Real-time monitoring**: Visit admin panel during experiments
- **Download data**: Use export buttons or API endpoints
- **Server logs**: Check Railway/Render dashboard for any issues

## 🚨 Important Notes

- **Free tiers** have limitations (CPU/memory/bandwidth)
- **For heavy usage** (50+ participants simultaneously), consider paid plans
- **Database backups**: Download your data regularly
- **SSL included**: All platforms provide HTTPS automatically

## 🎉 You're Ready!

Your experiment is now accessible worldwide! Participants can join from any device with an internet connection.

**Test URL Structure:**
- **Main game**: `https://your-url.com/`
- **Admin panel**: `https://your-url.com/admin.html`
- **Data export**: `https://your-url.com/api/export-data`
- **Statistics**: `https://your-url.com/api/stats` 