# 📦 PT Ikan Terbang Makmur Sejahtera Tbk - Distributor Module

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0+-green.svg)](https://flask.palletsprojects.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange.svg)](https://firebase.google.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Modul Distributor** untuk Sistem Supply Chain Management - UTS Integrasi Aplikasi Kelompok D

## 🎯 Overview

Sistem distribusi terintegrasi yang menghubungkan **Supplier** dengan **Retail** melalui RESTful API. Menyediakan tracking real-time, webhook notifications, dan dashboard analytics lengkap.

```
┌──────────┐      ┌──────────────┐      ┌────────┐
│ SUPPLIER │────▶│ DISTRIBUTOR  │─────▶│ RETAIL │
│  (A/B)   │      │     (D)      │      │ (E/F)  │
└──────────┘      └──────────────┘      └────────┘
   Request          Process & Track       Notify
```

---

## ✨ Key Features

- 🚚 **Multi-item Shipment Support** - Handle multiple products dalam 1 pengiriman
- 💰 **Dynamic Pricing** - Perhitungan otomatis berdasarkan rute & berat
- 📍 **Real-time Tracking** - 8-stage status tracking dengan ETA
- 🔔 **Webhook Notifications** - Auto-notify Retail saat status berubah
- 📊 **Analytics Dashboard** - 6-month statistics, revenue chart, route analysis
- 🔐 **Secure Authentication** - Excel-based admin login dengan session
- 🌐 **Public Tracking Page** - Customer bisa track paket tanpa login

---

## 🛠️ Tech Stack

**Backend:**

- Flask 3.0+ (Python)
- Firebase Firestore (Database)
- Pandas (Excel auth)

**Frontend:**

- HTML5 + CSS3 + Vanilla JavaScript
- Chart.js (Visualisasi)
- Font Awesome (Icons)

---

## 🚀 Quick Start

### Prerequisites

```bash
Python 3.8+
pip
Firebase account
```

### Installation

1. **Clone repository**

```bash
git clone https://github.com/your-repo/distributor-d.git
cd distributor-d
```

2. **Install dependencies**

```bash
pip install flask firebase-admin pandas openpyxl requests
```

3. **Setup Firebase**

- Download `DistributorD.json` dari Firebase Console
- Place di root folder project

4. **Setup Admin Auth**

- Buat file `auth.xlsx` dengan kolom: `name`, `password`
- Isi dengan credentials admin

5. **Run application**

```bash
python app.py
```

6. **Access**

- Public Page: `http://localhost:5000`
- Admin Login: `http://localhost:5000/login`
- Admin Dashboard: `http://localhost:5000/admin`

---

## 📡 API Endpoints

### 🔵 Public Endpoints

#### Get Shipment Status

```http
GET /status?no_resi=RESI-20250107-ABC123
```

**Response:**

```json
{
  "status": "success",
  "no_resi": "RESI-20250107-ABC123",
  "status_pengiriman": "Kurir mengirim paket",
  "asal": "malang",
  "tujuan": "surabaya",
  "harga_pengiriman": 182750,
  "eta_text": "1 hari",
  "eta_delivery_date": "2025-01-08"
}
```

---

### 🟢 Supplier Endpoints

#### Create Shipment Request

```http
POST /api/pengiriman
Content-Type: application/json
```

**Request Body:**

```json
{
  "id_order": 101,
  "id_retail": 1,
  "nama_supplier": "PT Supplier A",
  "asal_supplier": "malang",
  "tujuan_retail": "surabaya",
  "barang_dipesan": [
    {
      "id_barang": "BRG001",
      "nama_barang": "Ikan Tuna",
      "kuantitas": 10
    }
  ]
}
```

**Response:**

```json
{
  "status": "success",
  "id_pengiriman": "PG-ABC12",
  "no_resi": "RESI-20250107-ABC123",
  "biaya_pengiriman": 182750,
  "status_pengiriman": "Pesanan anda sedang kami proses",
  "eta_days": 1,
  "eta_text": "1 hari",
  "eta_delivery_date": "2025-01-08"
}
```

---

### 🟡 Retail Endpoints

#### Subscribe to Webhook

```http
POST /webhooks/subscribe
Content-Type: application/json
```

**Request Body:**

```json
{
  "url": "http://your-retail-url.com/api/distributor-events",
  "events": ["shipment.status.updated"],
  "secret": "your_webhook_secret"
}
```

#### Webhook Event (sent to Retail)

```http
POST /api/distributor-events
Content-Type: application/json
X-Event-Type: shipment.status.updated
X-Event-Id: evt_XXXXXXXX
X-Signature: HMAC-SHA256
```

**Payload:**

```json
{
  "id": "evt_XXXXXXXX",
  "type": "shipment.status.updated",
  "created_at": "2025-01-07T14:00:00Z",
  "data": {
    "no_resi": "RESI-20250107-ABC123",
    "old_status": "Pesanan anda sedang kami proses",
    "new_status": "Kurir mengirim paket",
    "status_now": "ON_DELIVERY",
    "order": {
      "id_order": 101,
      "id_retail": 1
    },
    "items": [...],
    "total_kuantitas": 10,
    "biaya_pengiriman": 182750
  }
}
```

---

## 💰 Pricing Formula

```
Total = Base Price + (Extra Weight × Factor × Base Price)

Example:
Base Price: Rp 25,000
Quantity: 10 kg
Included: 1 kg
Factor: 0.7

Extra Weight = 10 - 1 = 9 kg
Extra Cost = 9 × 0.7 × 25,000 = Rp 157,500
Total = 25,000 + 157,500 = Rp 182,500
```

### Supported Routes

| Origin | Destination | Base Price | ETA    |
| ------ | ----------- | ---------- | ------ |
| Malang | Surabaya    | Rp 25,000  | 1 hari |
| Malang | Banyuwangi  | Rp 40,000  | 2 hari |
| Gresik | Surabaya    | Rp 20,000  | 1 hari |
| Gresik | Banyuwangi  | Rp 45,000  | 3 hari |

---

## 📊 Database Schema

**Firebase Firestore Collections:**

- `tb_pengiriman` - Active shipments
- `tb_histori` - Completed shipments
- `tb_quote` - Price quotes
- `routes` - Shipping routes config
- `webhook_subscribers` - Webhook registrations
- `webhook_deadletter` - Failed webhook queue

---

## 🔍 Status Tracking

8 tahap pelacakan pengiriman:

1. ✅ Pesanan anda sedang kami proses
2. 🏍️ Kurir berangkat mengambil paket
3. 📦 Kurir mengirim paket
4. 🏭 Paket telah sampai di Gudang Sortir
5. 🚚 Paket Keluar dari Gudang Sortir
6. 🛣️ Kurir menuju ke lokasi anda
7. 🏠 Paket telah sampai di lokasi anda
8. ✅ Pesanan Selesai

---

## 🧪 Testing

### Using cURL

**Test Create Shipment:**

```bash
curl -X POST http://localhost:5000/api/pengiriman \
  -H "Content-Type: application/json" \
  -d '{
    "id_order": 101,
    "id_retail": 1,
    "nama_supplier": "PT Supplier A",
    "asal_supplier": "malang",
    "tujuan_retail": "surabaya",
    "barang_dipesan": [
      {"id_barang": "BRG001", "nama_barang": "Ikan Tuna", "kuantitas": 10}
    ]
  }'
```

**Test Get Status:**

```bash
curl http://localhost:5000/status?no_resi=RESI-20250107-ABC123
```

### Using Postman

Import [Postman Collection](docs/postman_collection.json) untuk testing lengkap.

---

## 📸

### Landing Page



### Admin Dashboard



### Analytics


## 🤝 Integration

### Untuk Supplier (Kelompok A/B)

```python
import requests

# Request pengiriman baru
response = requests.post(
    "http://distributor-url.com/api/pengiriman",
    json={
        "id_order": 101,
        "id_retail": 1,
        "nama_supplier": "PT Supplier A",
        "asal_supplier": "malang",
        "tujuan_retail": "surabaya",
        "barang_dipesan": [...]
    }
)

data = response.json()
no_resi = data["no_resi"]  # Save for tracking
```

### Untuk Retail (Kelompok E/F)

```python
# 1. Subscribe webhook (one-time)
requests.post(
    "http://distributor-url.com/webhooks/subscribe",
    json={
        "url": "http://your-retail.com/api/distributor-events",
        "events": ["shipment.status.updated"],
        "secret": "your_secret"
    }
)

# 2. Handle webhook di endpoint kamu
@app.route("/api/distributor-events", methods=["POST"])
def handle_distributor_event():
    event = request.get_json()

    # Verify signature (recommended)
    signature = request.headers.get("X-Signature")
    verify_webhook_signature(request.get_data(), signature, YOUR_SECRET)

    # Process event
    if event["type"] == "shipment.status.updated":
        update_order_status(
            no_resi=event["data"]["no_resi"],
            new_status=event["data"]["status_now"]
        )

    return jsonify({"received": True}), 200
```

## 👥 Team

**Kelompok D - Modul Distributor**

- ILHAM DICKY DARMAWAN 164221023 
- PUTU ARYASUTA TIRTA 164221035
- HADYAN ADIRA PERDANA 164221085
- ZHIDDAN ADITYA MAHARDIKA 164221086

- UTS Integrasi Aplikasi Komputer
- Supply Chain Management System
- PT Ikan Terbang Makmur Sejahtera Tbk

---

## 🙏 Acknowledgments

- Firebase for cloud infrastructure
- Chart.js for beautiful visualizations
- Flask community for excellent documentation
- Kelompok A, B, E, F untuk integrasi

[⬆ Back to Top](#-pt-ikan-terbang-makmur-sejahtera-tbk---distributor-module)

</div>
