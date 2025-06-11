# 🎯 Kamusal Mal Oyunu - Ekonomik Karar Verme Deneyi

Bu proje, David G. Rand, Joshua D. Greene ve Martin A. Nowak'ın "Spontaneous giving and calculated greed" çalışmasına dayanan bir kamusal mal oyunu deneyidir. Türk öğrenciler için uyarlanmış, çok oyunculu, gerçek zamanlı bir web platformudur.

## 🚀 Özellikler

- **Çok Oyunculu**: 4 kişilik gruplar halinde eş zamanlı oyun
- **Gerçek Zamanlı**: Socket.io ile anlık iletişim
- **Veri Toplama**: SQLite veritabanı ile otomatik veri kayıt
- **Türkçe Arayüz**: Türk öğrenciler için özelleştirilmiş
- **Mobil Uyumlu**: Responsive tasarım
- **Kolay Kurulum**: Yerel bilgisayarda çalışır

## 📊 Deney Detayları

### Oyun Mekanizması
- Her oyuncu 20 TL ile başlar (orijinal çalışmadaki $0.50 yerine)
- 0-20 TL arası gruba katkı verebilir
- Tüm katkılar ikiye katlanır ve 4 oyuncu arasında eşit paylaşılır
- Karar süreleri milisaniye hassasiyetle ölçülür

### Veri Toplama
- Katkı miktarları
- Karar verme süreleri
- Anlama soruları cevapları
- Demografik bilgiler
- Grup dinamikleri

## 🛠️ Kurulum

### Gereksinimler
- Node.js (v14 veya üzeri)
- npm (Node.js ile birlikte gelir)

### Adımlar

1. **Depoyu klonlayın:**
```bash
git clone <repo-url>
cd public-goods-experiment
```

2. **Bağımlılıkları yükleyin:**
```bash
npm install
```

3. **Sunucuyu başlatın:**
```bash
npm start
```

4. **Tarayıcıda açın:**
```
http://localhost:3000
```

## 🎮 Kullanım

### Deney Yöneticisi İçin

1. **Sunucuyu başlatın** ve URL'yi katılımcılarla paylaşın
2. **Katılımcıları bekleyin** (4 kişi gerekli)
3. **İzleme paneli**: `http://localhost:3000/admin.html`
4. **Analiz paneli**: `http://localhost:3000/analytics.html`
5. **Veri exportu**: `http://localhost:3000/api/export-data`

### 🌐 Online Hosting (ÜCRETSİZ!)

**Railway.app ile 5 dakikada online yayın:**
1. **GitHub hesabı** oluşturun ve kodları yükleyin
2. **[Railway.app](https://railway.app)** gidin ve GitHub ile giriş yapın
3. **"New Project"** → **"Deploy from GitHub repo"** seçin
4. **Repository seçin** ve bekleyin (2-3 dakika)
5. **URL alın** ve katılımcılarla paylaşın!

**Alternatif hostinglar:**
- **Render.com** (ücretsiz)
- **Heroku** (sınırlı ücretsiz)

Detaylı talimatlar: `deploy-guide.md` dosyasını okuyun

### Katılımcılar İçin

1. **Web sitesine gidin**
2. **Adınızı girin** (isteğe bağlı)
3. **Diğer oyuncuları bekleyin**
4. **Talimatları okuyun**
5. **Katkı kararınızı verin**
6. **Anlama sorularını cevaplayın**
7. **Sonuçları görün**
8. **Demografik bilgileri doldurun**

## 📁 Proje Yapısı

```
├── server.js              # Ana sunucu dosyası
├── package.json           # Proje bağımlılıkları
├── experiment_data.db     # SQLite veritabanı (otomatik oluşur)
├── public/
│   ├── index.html         # Ana HTML dosyası
│   ├── styles.css         # CSS stilleri
│   └── script.js          # Client-side JavaScript
└── README.md              # Bu dosya
```

## 🗄️ Veritabanı Şeması

### sessions tablosu
- `id`: Unique session ID
- `player_id`: Oyuncu ID'si
- `group_id`: Grup ID'si
- `contribution`: Katkı miktarı (0-20)
- `decision_time`: Karar süresi (milisaniye)
- `payoff`: Toplam kazanç
- `comprehension_q1`: Anlama sorusu 1 cevabı
- `comprehension_q2`: Anlama sorusu 2 cevabı
- `age`: Yaş
- `gender`: Cinsiyet
- `major`: Bölüm
- `created_at`: Kayıt zamanı

## 📊 Veri Analizi

### Gelişmiş Analiz Paneli
- **Analytics Dashboard**: `http://localhost:3000/analytics.html`
- **Gerçek zamanlı grafikler**: Katkı dağılımı, karar süreleri, korelasyonlar
- **İstatistiksel analiz**: Korelasyon hesaplamaları, grup karşılaştırmaları
- **Export seçenekleri**: JSON, CSV, R script, SPSS formatı

### API Endpoints
```bash
# Ana veriler
curl http://localhost:3000/api/export-data > experiment_data.json

# Etkileşim verileri
curl http://localhost:3000/api/export-interactions > interactions.json

# Grup analizi
curl http://localhost:3000/api/group-analysis > group_analysis.json

# Korelasyon verileri
curl http://localhost:3000/api/correlation-analysis > correlation_data.json
```

### Toplanan Veriler
- **Demografik**: Yaş, cinsiyet, bölüm, katılımcı adı
- **Davranışsal**: Katkı miktarları, karar süreleri, talimat okuma süreleri
- **Teknik**: IP adresleri, tarayıcı bilgileri, oturum süreleri, zaman damgaları
- **Grup dinamikleri**: Grup performansı, tamamlanma oranları
- **Anlama değerlendirmesi**: Soru cevapları ve doğruluk oranları

### R ile Analiz Örneği
```r
library(jsonlite)
library(dplyr)
library(ggplot2)
library(corrplot)

# Veriyi yükle
data <- fromJSON("experiment_data.json")

# Temel korelasyon analizi (Rand-Greene-Nowak hipotezi)
cor.test(data$decision_time, data$contribution)

# Regresyon modeli
model <- lm(contribution ~ decision_time + age + gender + instructions_time, data = data)
summary(model)

# Görselleştirme
ggplot(data, aes(x = decision_time/1000, y = contribution)) +
  geom_point() + 
  geom_smooth(method = "lm") +
  labs(x = "Karar Süresi (saniye)", y = "Katkı (TL)", 
       title = "Spontaneous Giving - Decision Time vs Contribution")

# Grup bazlı analiz
group_stats <- data %>%
  group_by(group_id) %>%
  summarise(
    avg_contribution = mean(contribution, na.rm = TRUE),
    avg_decision_time = mean(decision_time, na.rm = TRUE),
    cooperation_rate = mean(contribution > 10, na.rm = TRUE),
    total_payoff = sum(payoff, na.rm = TRUE)
  )
```

## 🔧 Yapılandırma

### Port Değiştirme
```bash
PORT=8080 npm start
```

### Farklı Para Birimi
`server.js` dosyasında `20` değerini değiştirin (başlangıç miktarı).

## 🚨 Güvenlik ve Gizlilik

- Kişisel veriler yerel olarak saklanır
- İnternet bağlantısı sadece Socket.io için gerekli
- Katılımcı isimleri isteğe bağlı
- Veriler anonim ID'lerle eşleştirilir

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/AmazingFeature`)
3. Commit yapın (`git commit -m 'Add some AmazingFeature'`)
4. Push yapın (`git push origin feature/AmazingFeature`)
5. Pull Request açın

## 📚 Referanslar

- Rand, D. G., Greene, J. D., & Nowak, M. A. (2012). Spontaneous giving and calculated greed. *Nature*, 489(7416), 427-430.
- Public goods game literature
- Behavioral economics experimental methods

## 📄 Lisans

MIT License - detaylar için LICENSE dosyasına bakın.

## 📞 Destek

Herhangi bir sorun yaşarsanız:
1. GitHub Issues kullanın
2. Veya e-posta gönderin: [email]

---

**Not**: Bu platform akademik araştırma amaçlıdır. Ticari kullanım için izin gerekebilir. 