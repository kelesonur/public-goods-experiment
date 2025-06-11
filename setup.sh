#!/bin/bash

# Public Goods Game Experiment Setup Script
# Kamusal Mal Oyunu - Kurulum Scripti

echo "🎯 Kamusal Mal Oyunu - Kurulum Başlıyor..."
echo "=========================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js bulunamadı!"
    echo "Lütfen Node.js'i buradan indirin: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo "⚠️  Node.js sürümü çok eski (v$NODE_VERSION)"
    echo "En az v14 gerekli. Lütfen güncelleyin: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js v$(node -v) bulundu"

# Install dependencies
echo "📦 Paketler yükleniyor..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Paketler başarıyla yüklendi"
else
    echo "❌ Paket yükleme hatası!"
    exit 1
fi

# Create public directory if it doesn't exist
mkdir -p public

echo ""
echo "🎉 Kurulum tamamlandı!"
echo "=========================================="
echo ""
echo "🚀 Sunucuyu başlatmak için:"
echo "   npm start"
echo ""
echo "🌐 Tarayıcıda şu adresi açın:"
echo "   http://localhost:3000"
echo ""
echo "📊 Yönetici paneli için:"
echo "   http://localhost:3000/admin.html"
echo ""
echo "📋 Veri exportu için:"
echo "   http://localhost:3000/api/export-data"
echo ""
echo "⚠️  Not: Deney için 4 katılımcı gereklidir"
echo "==========================================" 