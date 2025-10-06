PT IKAN TERBANG MAKMUR SEJAHTERA Tbk — Distributor & SCM Integration (Flask + Firebase)

Repositori ini berisi layanan Distributor untuk tugas mata kuliah Integrasi Aplikasi Korporasi (SCM). Sistem menyediakan API penghitungan ongkos kirim, pembuatan pengiriman (single/multi-item), pelacakan resi, webhook bertanda tangan HMAC dengan retry + dead-letter queue, direct broadcast ke retail endpoint, serta Admin Dashboard (Flask + Firestore).
Frontend publik disertai laman pelacakan resi.

Daftar Isi

Ringkasan Fitur

Arsitektur

Struktur Direktori

Prasyarat & Instalasi

Konfigurasi Lingkungan

Menjalankan Aplikasi

Model Data & Koleksi Firestore

Aturan Tarif & ETA

API Reference

Admin Dashboard

Keamanan & Validasi

Alur Uji Cepat (cURL)

Keterbatasan Dikenal

Deployment Singkat (Opsional)

FAQ

Lisensi

Ringkasan Fitur

API Tarif & Pengiriman

Hitung biaya (POST /api/biaya)

Buat pengiriman multi-item (POST /api/pengiriman)

Buat pengiriman single-item (POST /shipments)

Cek status resi (GET /status)

Daftar pengiriman aktif & histori (GET /api/shipments)

Reliabilitas Integrasi

Webhook HMAC-SHA256 + exponential backoff (3x) + Dead Letter Queue

Direct broadcast ke Retail Endpoint berdasarkan id_retail

Admin Dashboard

Login berbasis Excel (auth.xlsx) untuk demonstrasi

Ubah status pesanan (memicu pengiriman event)

CRUD rute (basis tarif, ETA, faktor kg, inklusif kg)

Analytics: grafik, status distribution, top routes

Frontend Publik

Landing + form pelacakan resi (/)

Konektivitas Data

Firestore collections: tb_pengiriman, tb_histori, tb_quote, routes, webhook_subscribers, webhook_deadletter

Catatan akademik: Mekanisme login admin via Excel adalah demonstrasi, tidak untuk produksi.
