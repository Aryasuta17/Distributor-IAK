import os
import secrets
import json
import time
import hmac
import hashlib
import requests
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, request, jsonify, render_template, redirect, url_for
import firebase_admin
from firebase_admin import credentials, firestore
import os
from functools import wraps
from flask import session, redirect, url_for, render_template, request, jsonify
import pandas as pd

SERVICE_ACCOUNT_PATH = "DistributorD.json"
PROJECT_ID = "distributoriak-2025"

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred, {"projectId": PROJECT_ID})
db = firestore.client()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "secret-dev")


ROUTE_TABLE = {
    ("malang", "surabaya"):   {
        "price_base": 25000, "eta_days": 1, "distributor_id": 2, "distributor_name": "PT Ikan Terbang Makmur Sejaht era TBK",
        "per_kg_factor": 0.7, "included_kg": 1
    },
    ("malang", "banyuwangi"): {
        "price_base": 40000, "eta_days": 2, "distributor_id": 2, "distributor_name": "PT Ikan Terbang Makmur Sejahtera TBK",
        "per_kg_factor": 0.7, "included_kg": 1
    },
    ("gresik", "surabaya"):   {
        "price_base": 20000, "eta_days": 1, "distributor_id": 2, "distributor_name": "PT Ikan Terbang Makmur Sejahtera TBK",
        "per_kg_factor": 0.7, "included_kg": 1
    },
    ("gresik", "banyuwangi"): {
        "price_base": 45000, "eta_days": 3, "distributor_id": 2, "distributor_name": "PT Ikan Terbang Makmur Sejahtera TBK",
        "per_kg_factor": 0.7, "included_kg": 1
    },
}

STATUS_LIST = [
    "Pesanan anda sedang kami proses",
    "Kurir berangkat mengambil paket",
    "Kurir mengirim paket",
    "Paket telah sampai di Gudang Sortir",
    "Paket Keluar dari Gudang Sortir",
    "Kurir menuju ke lokasi anda",
    "Paket telah sampai di lokasi anda",
    "Pesanan Selesai",
]

COL_QUOTES    = "tb_quote"
COL_SHIPMENTS = "tb_pengiriman"
COL_HISTORY   = "tb_histori"

WEBHOOKS_COL  = "webhook_subscribers"  
DLQ_COL       = "webhook_deadletter"

POST_TIMEOUT_SECS = 5
MAX_RETRIES = 3
BACKOFF_BASE = 0.7  

EVENT_STATUS_UPDATED = "shipment.status.updated"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def today_ymd() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def add_days_ymd(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

def gen_resi() -> str:
    ts = datetime.now().strftime("%Y%m%d")
    rand = secrets.token_hex(3).upper()
    return f"RESI-{ts}-{rand[:6]}"

def get_route_from_firestore(origin: str, destination: str):
    o = (origin or "").strip().lower()
    d = (destination or "").strip().lower()
    doc = db.collection("routes").document(f"{o}_{d}").get()
    if doc.exists:
        return doc.to_dict()
    q = db.collection("routes").where("origin", "==", o).where("destination", "==", d).get()
    return q[0].to_dict() if q else None

def route_info(asal: str, tujuan: str):
    fs = get_route_from_firestore(asal, tujuan)
    if fs:
        return {
            "price_base":       int(fs.get("price_base")),
            "eta_days":         int(fs.get("eta_days", 1)),
            "distributor_id":   int(fs.get("distributor_id", 2)),
            "distributor_name": str(fs.get("distributor_name", "PT Ikan Terbang Makmur Sejahtera TBK")),
            "per_kg_factor":    float(fs.get("per_kg_factor", 0.7)),
            "included_kg":      int(fs.get("included_kg", 1)),
        }
    key = ((asal or "").strip().lower(), (tujuan or "").strip().lower())
    return ROUTE_TABLE.get(key)

def eta_text(days: int) -> str:
    return "1 hari" if days == 1 else f"{days} hari"

def calc_price(price_base: int, qty_kg: int, per_kg_factor: float = 0.7, included_kg: int = 1) -> int:
    if qty_kg <= 0:
        return 0
    extra_kg = max(qty_kg - included_kg, 0)
    extra_cost = extra_kg * per_kg_factor * price_base
    return int(round(price_base + extra_cost))

def _first_non_empty(*vals):
    for v in vals:
        if v not in (None, "", []):
            return v
    return None

def _date_to_ymd_or_same(x):
    if isinstance(x, dict) and "seconds" in x:
        dt = datetime.fromtimestamp(int(x["seconds"]))
        return dt.strftime("%Y-%m-%d")

    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d")

    if isinstance(x, str):
        try:
            dt = datetime.fromisoformat(x.replace("Z", "+00:00")) if ("T" in x or "Z" in x or "+" in x) else datetime.strptime(x, "%Y-%m-%d")
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return x
    return None

def _normalize_doc(d: dict) -> dict:
    items = d.get("barang_dipesan") or []
    first_name = (items[0].get("nama_barang") if items else None) or d.get("nama_barang") or "-"
    qty = d.get("total_kuantitas") or d.get("kuantitas") or 0

    eta_text = _first_non_empty(
        d.get("eta_text"),
        d.get("eta"),
        d.get("estimasi_tiba"),
    )
    eta_days = _first_non_empty(
        d.get("eta_days"),
    )
    eta_date_raw = _first_non_empty(
        d.get("eta_delivery_date"),
        d.get("eta_date"),
    )
    eta_delivery_date = _date_to_ymd_or_same(eta_date_raw)

    normalized = {
        "doc_id": d.get("doc_id"),
        "no_resi": d.get("no_resi"),
        "buyer": d.get("id_pembeli") or d.get("nama_supplier") or (d.get("id_retail") and f"RETAIL-{d.get('id_retail')}") or "-",
        "item_name": first_name,
        "qty": qty,
        "route_origin": d.get("asal_pengirim") or d.get("asal_supplier") or "-",
        "route_dest": d.get("tujuan") or d.get("tujuan_retail") or "-",
        "price": d.get("harga_pengiriman") or d.get("biaya_pengiriman") or 0,
        "status": d.get("status") or "-",
        "tanggal_pembelian": d.get("tanggal_pembelian") or "-",
        "created_at": d.get("created_at") or "-",

        "eta_text": eta_text,
        "eta_days": eta_days,
        "eta_delivery_date": eta_delivery_date,
    }

    if items and len(items) > 0:
        normalized["barang_dipesan"] = items
        normalized["total_kuantitas"] = qty

    return normalized

def _hmac_signature(secret: str, body_bytes: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256)
    return mac.hexdigest()

def _load_active_subscribers(event_name: str):
    docs = db.collection(WEBHOOKS_COL).where("is_active", "==", True).stream()
    subs = []
    for d in docs:
        obj = d.to_dict()
        if event_name in (obj.get("events") or []):
            obj["id"] = d.id
            subs.append(obj)
    return subs

def _dispatch_one(url: str, secret: str, event: dict):
    body = json.dumps(event, ensure_ascii=False).encode("utf-8")
    sig  = _hmac_signature(secret or "", body)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "distributor-webhook/1.0",
        "X-Event-Type": event["type"],
        "X-Event-Id": event["id"],
        "X-Signature": sig,
    }
    try:
        r = requests.post(url, data=body, headers=headers, timeout=POST_TIMEOUT_SECS)
        ok = (200 <= r.status_code < 300)
        return ok, f"{r.status_code} {r.text[:200]}"
    except Exception as e:
        return False, str(e)

def _enqueue_dlq(sub_id: str, url: str, event: dict, last_err: str):
    db.collection(DLQ_COL).add({
        "subscriber_id": sub_id,
        "target_url": url,
        "event": event,
        "last_error": last_err,
        "created_at": now_iso(),
        "retryable": True,
    })

def _build_status_event(doc_after: dict, old_status: str, new_status: str) -> dict:

    if new_status == "Pesanan anda sedang kami proses":
        status_now = "CREATED"
    elif new_status == "Pesanan Selesai":
        status_now = "DELIVERED"
    else:
        status_now = "ON_DELIVERY"

    items = []
    raw_items = doc_after.get("barang_dipesan")
    if isinstance(raw_items, list) and len(raw_items) > 0:

        for it in raw_items:
            items.append({
                "id_barang": (str(it.get("id_barang", "")).strip() or None),
                "nama_barang": str(it.get("nama_barang", "")).strip(),
                "kuantitas": int(it.get("kuantitas", 0) or 0),
            })
    else:

        if doc_after.get("nama_barang"):
            items.append({
                "id_barang": None,
                "nama_barang": str(doc_after.get("nama_barang")).strip(),
                "kuantitas": int(doc_after.get("kuantitas", 0) or 0),
            })

    total_kuantitas = (
        doc_after.get("total_kuantitas")
        or doc_after.get("kuantitas")
        or sum((it.get("kuantitas") or 0) for it in items)
        or 0
    )

    biaya_pengiriman = (
        doc_after.get("biaya_pengiriman")
        or doc_after.get("harga_pengiriman")
        or 0
    )

    route = {
        "origin": doc_after.get("asal_pengirim") or doc_after.get("asal_supplier"),
        "destination": doc_after.get("tujuan") or doc_after.get("tujuan_retail"),
    }

    order_info = {
        "id_order": doc_after.get("id_order"),
        "id_retail": doc_after.get("id_retail"),
        "supplier": doc_after.get("nama_supplier"),
        "distributor": doc_after.get("nama_distributor") or doc_after.get("distributor_name"),
    }

    return {
        "id": f"evt_{secrets.token_hex(8)}",
        "type": EVENT_STATUS_UPDATED,
        "created_at": now_iso(),
        "version": 1,
        "data": {
            "no_resi": doc_after.get("no_resi"),
            "doc_id": doc_after.get("doc_id"),
            "old_status": old_status,
            "new_status": new_status,
            "status_now": status_now,
            "route": route,
            "order": order_info,                
            "items": items,                     
            "total_kuantitas": int(total_kuantitas),
            "biaya_pengiriman": int(biaya_pengiriman),
            "updated_at": now_iso(),
        }
    }

def _notify_status_change(doc_after: dict, old_status: str, new_status: str):
    subs = _load_active_subscribers(EVENT_STATUS_UPDATED)
    if not subs:
        return
    event = _build_status_event(doc_after, old_status, new_status)
    for sub in subs:
        url = sub.get("url"); secret = sub.get("secret","")
        success = False; last_err = ""
        for i in range(MAX_RETRIES):
            ok, info = _dispatch_one(url, secret, event)
            if ok:
                success = True
                break
            last_err = info
            time.sleep((BACKOFF_BASE * (2 ** i)) + (0.05 * i))
        if not success:
            _enqueue_dlq(sub_id=sub["id"], url=url, event=event, last_err=last_err)

@app.route("/api/biaya", methods=["POST"])
def quote_price():
    data = request.get_json(force=True) or {}
    asal = (data.get("asal_pengirim") or "").strip()
    tujuan = (data.get("tujuan") or "").strip()
    if "kuantitas" not in data:
        return jsonify({"status":"error","message":"kuantitas wajib."}), 400
    try:
        kuantitas = int(data.get("kuantitas"))
    except Exception:
        return jsonify({"status":"error","message":"kuantitas harus angka."}), 400

    if not asal or not tujuan:
        return jsonify({"status": "error", "message": "asal_pengirim dan tujuan wajib."}), 400

    info = route_info(asal, tujuan)
    if not info or info.get("price_base") is None:
        return jsonify({"status": "error", "message": "Rute tidak terdaftar."}), 404

    price_base    = int(info["price_base"])
    per_kg_factor = float(info.get("per_kg_factor", 0.7))
    included_kg   = int(info.get("included_kg", 1))
    total_price   = calc_price(price_base, kuantitas, per_kg_factor, included_kg)

    eta_days_val     = int(info.get("eta_days", 1))
    distributor_id   = int(info.get("distributor_id", 2))
    distributor_name = str(info.get("distributor_name", "PT Ikan Terbang Makmur Sejahtera TBK"))
    eta_txt  = eta_text(eta_days_val)
    eta_date = add_days_ymd(eta_days_val)

    quote_id = f"Q-{secrets.token_hex(6)}".upper()
    payload = {
        "quote_id": quote_id,
        "asal_pengirim": asal,
        "tujuan": tujuan,
        "kuantitas": kuantitas,
        "currency": "IDR",
        "harga_dasar": price_base,
        "per_kg_factor": per_kg_factor,
        "included_kg": included_kg,
        "harga_pengiriman": total_price,
        "distributor_id": distributor_id,
        "distributor_name": distributor_name,
        "id_distributor": distributor_id,
        "nama_distributor": distributor_name,
        "eta_days": eta_days_val,
        "eta_text": eta_txt,
        "eta_delivery_date": eta_date,
        "generated_at": now_iso(),
        "valid_until": today_ymd(),
    }
    db.collection(COL_QUOTES).document(quote_id).set(payload)
    resp = dict(payload); resp["status"] = "success"
    return jsonify(resp), 200

@app.route("/api/pengiriman", methods=["POST"])
def api_pengiriman():
    data = request.get_json(force=True) or {}

    missing = []
    for fld in ["id_order", "id_retail", "nama_supplier", "asal_supplier", "tujuan_retail", "barang_dipesan"]:
        if fld not in data or data[fld] in (None, "", []):
            pass
    missing = []
    for fld in ["id_order", "id_retail", "nama_supplier", "asal_supplier", "tujuan_retail", "barang_dipesan"]:
        if fld not in data or data[fld] in (None, "", []):
            missing.append(fld)
    if missing:
        return jsonify({"status": "error", "message": f"Field wajib hilang: {', '.join(missing)}"}), 400

    try:
        id_order = int(data["id_order"])
        id_retail = int(data["id_retail"])
    except Exception:
        return jsonify({"status": "error", "message": "id_order dan id_retail harus angka."}), 400

    nama_supplier = str(data["nama_supplier"]).strip()
    nama_distributor_in = str(data.get("nama_distributor", "")).strip()
    asal = str(data["asal_supplier"]).strip()
    tujuan = str(data["tujuan_retail"]).strip()

    items_in = data.get("barang_dipesan") or []
    if not isinstance(items_in, list) or len(items_in) == 0:
        return jsonify({"status": "error", "message": "barang_dipesan harus list dan tidak kosong."}), 400

    items = []
    total_kuantitas = 0
    for it in items_in:
        try:
            iid = str(it.get("id_barang", "")).strip()
            nm  = str(it.get("nama_barang", "")).strip()
            qty = int(it.get("kuantitas", 0))
        except Exception:
            return jsonify({"status": "error", "message": "kuantitas item harus angka."}), 400
        if not iid or not nm or qty <= 0:
            return jsonify({"status": "error", "message": "Setiap item wajib id_barang, nama_barang, kuantitas > 0."}), 400
        total_kuantitas += qty
        items.append({"id_barang": iid, "nama_barang": nm, "kuantitas": qty})

    info = route_info(asal, tujuan)
    if not info or info.get("price_base") is None:
        return jsonify({"status": "error", "message": "Rute tidak terdaftar."}), 404

    price_base    = int(info["price_base"])
    per_kg_factor = float(info.get("per_kg_factor", 0.7))
    included_kg   = int(info.get("included_kg", 1))
    total_price   = calc_price(price_base, total_kuantitas, per_kg_factor, included_kg)

    eta_days_val     = int(info.get("eta_days", 1))
    distributor_id   = int(info.get("distributor_id", 2))
    distributor_name = nama_distributor_in if nama_distributor_in else str(info.get("distributor_name", "PT Ikan Terbang Makmur Sejahtera TBK"))

    eta_txt  = eta_text(eta_days_val)
    eta_date = add_days_ymd(eta_days_val)

    no_resi = gen_resi()
    doc_id = f"PG-{secrets.token_hex(5)}".upper()

    doc = {
        "doc_id": doc_id,
        "no_resi": no_resi,
        "biaya_pengiriman": total_price,
        "status": STATUS_LIST[0],
        "id_order": id_order,
        "id_retail": id_retail,
        "nama_supplier": nama_supplier,
        "nama_distributor": distributor_name,
        "asal_supplier": asal,
        "tujuan_retail": tujuan,
        "barang_dipesan": items,
        "total_kuantitas": total_kuantitas,
        "currency": "IDR",
        "harga_dasar": price_base,
        "per_kg_factor": per_kg_factor,
        "included_kg": included_kg,
        "distributor_id": distributor_id,
        "eta_days": eta_days_val,
        "eta_text": eta_txt,
        "eta_delivery_date": eta_date,
        "tanggal_pembelian": today_ymd(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    db.collection(COL_SHIPMENTS).document(doc_id).set(doc)

    return jsonify({
        "status": "success",
        "id_pengiriman": doc_id,
        "no_resi": no_resi,
        "biaya_pengiriman": total_price,
        "status_pengiriman": doc["status"],
        "currency": "IDR",
        "eta_days": eta_days_val,
        "eta_text": eta_txt,
        "eta_delivery_date": eta_date
    }), 201

@app.route("/shipments", methods=["POST"])
def create_shipment():
    data = request.get_json(force=True) or {}
    id_pembeli = (data.get("id_pembeli") or "").strip()
    nama_barang = (data.get("nama_barang") or "").strip()
    if "kuantitas" not in data:
        return jsonify({"status":"error","message":"kuantitas wajib."}), 400
    try:
        kuantitas = int(data.get("kuantitas"))
    except Exception:
        return jsonify({"status":"error","message":"kuantitas harus angka."}), 400
    asal = (data.get("asal_pengirim") or "").strip()
    tujuan = (data.get("tujuan") or "").strip()

    if not id_pembeli or not nama_barang or not asal or not tujuan:
        return jsonify({"status": "error", "message": "id_pembeli, nama_barang, asal_pengirim, tujuan wajib."}), 400

    info = route_info(asal, tujuan)
    if not info or info.get("price_base") is None:
        return jsonify({"status": "error", "message": "Rute tidak terdaftar."}), 404

    price_base    = int(info["price_base"])
    per_kg_factor = float(info.get("per_kg_factor", 0.7))
    included_kg   = int(info.get("included_kg", 1))
    total_price   = calc_price(price_base, kuantitas, per_kg_factor, included_kg)

    eta_days_val     = int(info.get("eta_days", 1))
    distributor_id   = int(info.get("distributor_id", 2))
    distributor_name = str(info.get("distributor_name", "PT Ikan Terbang Makmur Sejahtera TBK"))
    eta_txt  = eta_text(eta_days_val)
    eta_date = add_days_ymd(eta_days_val)

    no_resi = gen_resi()
    doc_id = f"PG-{secrets.token_hex(5)}".upper()
    doc = {
        "doc_id": doc_id,
        "no_resi": no_resi,
        "id_pembeli": id_pembeli,
        "nama_barang": nama_barang,
        "kuantitas": kuantitas,
        "asal_pengirim": asal,
        "tujuan": tujuan,
        "currency": "IDR",
        "harga_dasar": price_base,
        "per_kg_factor": per_kg_factor,
        "included_kg": included_kg,
        "harga_pengiriman": total_price,
        "distributor_id": distributor_id,
        "distributor_name": distributor_name,
        "eta_days": eta_days_val,
        "eta_text": eta_txt,
        "eta_delivery_date": eta_date,
        "status": STATUS_LIST[0],
        "tanggal_pembelian": today_ymd(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    db.collection(COL_SHIPMENTS).document(doc_id).set(doc)

    return jsonify({
        "status": "success",
        "no_resi": no_resi,
        "currency": "IDR",
        "harga_pengiriman": total_price,
        "harga_dasar": price_base,
        "per_kg_factor": per_kg_factor,
        "included_kg": included_kg,
        "distributor_id": distributor_id,
        "distributor_name": distributor_name,
        "eta_days": eta_days_val,
        "eta_text": eta_txt,
        "eta_delivery_date": eta_date,
        "status_pengiriman": doc["status"],
        "tanggal_pembelian": doc["tanggal_pembelian"],
    }), 201

@app.route("/status", methods=["GET"])
def get_status():
    no_resi = (request.args.get("no_resi") or "").strip()
    if not no_resi:
        return jsonify({"status": "error", "message": "no_resi wajib."}), 400

    aktif = db.collection(COL_SHIPMENTS).where("no_resi", "==", no_resi).get()
    if aktif:
        d = aktif[0].to_dict()
        return jsonify({
            "status": "success",
            "no_resi": d["no_resi"],
            "status_pengiriman": d["status"],
            "asal": d.get("asal_pengirim") or d.get("asal_supplier"),
            "tujuan": d.get("tujuan") or d.get("tujuan_retail"),
            "currency": d.get("currency", "IDR"),
            "harga_pengiriman": d.get("harga_pengiriman") or d.get("biaya_pengiriman"),
            "harga_dasar": d.get("harga_dasar"),
            "per_kg_factor": d.get("per_kg_factor"),
            "included_kg": d.get("included_kg"),
            "distributor_id": d.get("distributor_id"),
            "distributor_name": d.get("distributor_name") or d.get("nama_distributor"),
            "eta_days": d.get("eta_days"),
            "eta_text": d.get("eta_text"),
            "eta_delivery_date": d.get("eta_delivery_date"),
            "tanggal_pembelian": d.get("tanggal_pembelian"),
        }), 200

    arsip = db.collection(COL_HISTORY).where("no_resi", "==", no_resi).get()
    if arsip:
        d = arsip[0].to_dict()
        return jsonify({
            "status": "success",
            "no_resi": d["no_resi"],
            "status_pengiriman": d["status"],
            "asal": d.get("asal_pengirim") or d.get("asal_supplier"),
            "tujuan": d.get("tujuan") or d.get("tujuan_retail"),
            "currency": d.get("currency", "IDR"),
            "harga_pengiriman": d.get("harga_pengiriman") or d.get("biaya_pengiriman"),
            "harga_dasar": d.get("harga_dasar"),
            "per_kg_factor": d.get("per_kg_factor"),
            "included_kg": d.get("included_kg"),
            "distributor_id": d.get("distributor_id"),
            "distributor_name": d.get("distributor_name") or d.get("nama_distributor"),
            "eta_days": d.get("eta_days"),
            "eta_text": d.get("eta_text"),
            "eta_delivery_date": d.get("eta_delivery_date"),
            "tanggal_pembelian": d.get("tanggal_pembelian"),
        }), 200

    return jsonify({"status": "error", "message": "Nomor resi tidak ditemukan."}), 404

@app.route("/", methods=["GET", "POST"])
def index():
    nomor_resi = None
    status_text = None
    error = None

    if request.method == "POST":
        nomor_resi = (request.form.get("nomor_resi") or "").strip()
        if not nomor_resi:
            error = "Nomor resi wajib diisi."
        else:
            aktif = db.collection(COL_SHIPMENTS).where("no_resi", "==", nomor_resi).get()
            if aktif:
                status_text = aktif[0].to_dict().get("status")
            else:
                arsip = db.collection(COL_HISTORY).where("no_resi", "==", nomor_resi).get()
                if arsip:
                    status_text = arsip[0].to_dict().get("status")
                else:
                    error = "Nomor resi tidak ditemukan."

    return render_template("index.html", nomor_resi=nomor_resi, status=status_text, error=error)

def get_all_routes():
    docs = db.collection("routes").stream()
    return [d.to_dict() for d in docs]

def upsert_route_doc(origin, destination, price_base, eta_days, distributor_id, distributor_name, per_kg_factor, included_kg):
    doc = {
        "origin": origin,
        "destination": destination,
        "price_base": price_base,
        "eta_days": eta_days,
        "distributor_id": distributor_id,
        "distributor_name": distributor_name,
        "per_kg_factor": per_kg_factor,
        "included_kg": included_kg,
        "updated_at": now_iso(),
    }
    db.collection("routes").document(f"{origin}_{destination}").set(doc) 
    return doc

def delete_route_doc(origin, destination):
    db.collection("routes").document(f"{origin}_{destination}").delete()

@app.route("/admin", methods=["GET"])
def admin_page():
    aktif_docs = db.collection(COL_SHIPMENTS).order_by("created_at").stream()
    aktif = [d.to_dict() for d in aktif_docs]

    history_docs = db.collection(COL_HISTORY).order_by("created_at").stream()
    history = [d.to_dict() for d in history_docs]

    try:
        routes = get_all_routes()
    except Exception:
        routes = []

    return render_template("admin.html",
                            aktif=aktif,
                            history=history,
                            status_list=STATUS_LIST,
                            routes=routes)

@app.route("/status/update", methods=["POST"])
def update_status():
    doc_id = (request.form.get("doc_id") or "").strip()
    new_status = (request.form.get("status") or "").strip()

    if not doc_id or not new_status:
        return jsonify({"status": "error", "message": "doc_id dan status wajib."}), 400
    if new_status not in STATUS_LIST:
        return jsonify({"status": "error", "message": "status tidak valid."}), 400

    ref = db.collection(COL_SHIPMENTS).document(doc_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({"status": "error", "message": "Dokumen tidak ditemukan."}), 404

    before = snap.to_dict()
    old_status = before.get("status")

    ref.update({"status": new_status, "updated_at": now_iso()})
    after = ref.get().to_dict()

    try:
        _notify_status_change(after, old_status=old_status, new_status=new_status)
    except Exception as e:
        print("[WEBHOOK ERROR]", e)

    try:
        event = _build_status_event(after, old_status=old_status, new_status=new_status)
        _direct_broadcast_async(event)
    except Exception as e:
        app.logger.exception(f"[DIRECT BROADCAST ERROR] {e}")

    if new_status == "Pesanan Selesai":
        db.collection(COL_HISTORY).document(doc_id).set(after)
        ref.delete()

    return redirect(url_for("admin_page"))

@app.route("/admin/routes/upsert", methods=["POST"])
def admin_upsert_route():
    origin = (request.form.get("origin") or "").strip().lower()
    destination = (request.form.get("destination") or "").strip().lower()
    if not origin or not destination:
        return jsonify({"status":"error","message":"origin & destination wajib."}), 400

    def _to_int(v, default=None):
        try: return int(v)
        except: return default
    def _to_float(v, default=None):
        try: return float(v)
        except: return default

    price_base = _to_int(request.form.get("price_base"))
    eta_days = _to_int(request.form.get("eta_days"), 1)
    distributor_id = _to_int(request.form.get("distributor_id"), 2)
    distributor_name = (request.form.get("distributor_name") or "PT Ikan Terbang Makmur Sejahtera TBK").strip()
    per_kg_factor = _to_float(request.form.get("per_kg_factor"), 0.7)
    included_kg = _to_int(request.form.get("included_kg"), 1)

    if price_base is None:
        return jsonify({"status":"error","message":"price_base wajib (integer)."}), 400

    upsert_route_doc(origin, destination, price_base, eta_days, distributor_id, distributor_name, per_kg_factor, included_kg)
    return redirect(url_for("admin_page"))

@app.route("/admin/routes/delete", methods=["POST"])
def admin_delete_route():
    origin = (request.form.get("origin") or "").strip().lower()
    destination = (request.form.get("destination") or "").strip().lower()
    if not origin or not destination:
        return jsonify({"status":"error","message":"origin & destination wajib."}), 400
    delete_route_doc(origin, destination)
    return redirect(url_for("admin_page"))

@app.route("/api/shipments", methods=["GET"])
def api_shipments():
    aktif = [_normalize_doc(x.to_dict())
                for x in db.collection("tb_pengiriman").order_by("created_at").stream()]
    history = [_normalize_doc(x.to_dict())
                for x in db.collection("tb_histori").order_by("created_at").stream()]
    aktif.sort(key=lambda x: x["created_at"], reverse=True)
    history.sort(key=lambda x: x["created_at"], reverse=True)
    return jsonify({"aktif": aktif, "history": history}), 200

@app.route("/webhooks/subscribe", methods=["POST"])
def webhooks_subscribe():
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    events = data.get("events") or []
    secret = (data.get("secret") or "").strip()

    if not url or not events:
        return jsonify({"status":"error","message":"url & events wajib"}), 400
    if EVENT_STATUS_UPDATED not in events:
        return jsonify({"status":"error","message":f"events harus mengandung '{EVENT_STATUS_UPDATED}'"}), 400

    doc = {
        "url": url,
        "events": list(set(events)),
        "secret": secret or secrets.token_hex(16),
        "is_active": True,
        "created_at": now_iso(),
    }
    ref = db.collection(WEBHOOKS_COL).add(doc)[1]
    d = ref.get().to_dict(); d["id"] = ref.id
    return jsonify({"status":"success","subscriber":d}), 201

@app.route("/webhooks/unsubscribe", methods=["POST"])
def webhooks_unsubscribe():
    data = request.get_json(force=True) or {}
    sub_id = (data.get("id") or "").strip()
    url    = (data.get("url") or "").strip()
    if not sub_id and not url:
        return jsonify({"status":"error","message":"butuh id atau url"}), 400

    if sub_id:
        db.collection(WEBHOOKS_COL).document(sub_id).update({"is_active": False, "updated_at": now_iso()})
        return jsonify({"status":"success"}), 200

    snaps = db.collection(WEBHOOKS_COL).where("url","==",url).get()
    for s in snaps:
        db.collection(WEBHOOKS_COL).document(s.id).update({"is_active": False, "updated_at": now_iso()})
    return jsonify({"status":"success"}), 200

# CONFIG_COLLECTION = "sys_config"
# CONFIG_DOC_BROADCAST = "broadcast"

RETAIL_ENDPOINTS = {
    1: "http://192.168.100.112:5000/api/distributor-events",
    2: "https://2eb51f88395a.ngrok-free.app/api/distributor-events"
}

POST_TIMEOUT_SECS = 5
MAX_RETRIES = 3
BACKOFF_BASE = 0.7

def _direct_post_one(url, event):
    """Kirim 1 event ke 1 URL."""
    body = json.dumps(event, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "distributor-direct/1.0",
        "X-Event-Type": event["type"],
        "X-Event-Id": event["id"],
    }
    try:
        r = requests.post(url, data=body, headers=headers, timeout=POST_TIMEOUT_SECS)
        return (200 <= r.status_code < 300), f"{r.status_code} {r.text[:200]}"
    except Exception as e:
        return False, str(e)

def _direct_broadcast(event: dict):
    data = event.get("data", {})
    no_resi = data.get("no_resi", "?")
    new_status = data.get("new_status", "?")
    status_now = data.get("status_now", "?")

    doc_id = data.get("doc_id")
    doc = db.collection(COL_SHIPMENTS).document(doc_id).get()
    if not doc.exists:
        app.logger.warning(f"[Direct] doc_id {doc_id} tidak ditemukan di Firestore.")
        return

    shipment = doc.to_dict()
    id_retail = shipment.get("id_retail")

    target_url = RETAIL_ENDPOINTS.get(id_retail)
    if not target_url:
        app.logger.warning(f"[Direct] id_retail={id_retail} belum terdaftar di RETAIL_ENDPOINTS.")
        return

    success = False
    last_err = ""
    for i in range(MAX_RETRIES):
        ok, info = _direct_post_one(target_url, event)
        if ok:
            success = True
            app.logger.info(
                f"[Direct ✅] Sent → {target_url} | id_retail={id_retail} | Resi: {no_resi} | Status: {new_status} | Category: {status_now}"
            )
            break
        last_err = info
        time.sleep((BACKOFF_BASE * (2 ** i)) + (0.05 * i))
    if not success:
        app.logger.error(f"[Direct ❌] Failed POST {target_url}: {last_err}")


def _direct_broadcast_async(event):
    th = threading.Thread(target=_direct_broadcast, args=(event,), daemon=True)
    th.start()

@app.route("/api/broadcast-test", methods=["POST"])
def api_broadcast_test():

    data = request.get_json(force=True) or {}
    no_resi = (data.get("no_resi") or "").strip()
    if not no_resi:
        return jsonify({"status": "error", "message": "no_resi wajib"}), 400

    aktif = db.collection(COL_SHIPMENTS).where("no_resi", "==", no_resi).limit(1).get()
    if not aktif:
        return jsonify({"status": "error", "message": "resi tidak ditemukan di aktif"}), 404

    d = aktif[0].to_dict()
    event = _build_status_event(d, old_status=d.get("status"), new_status=d.get("status"))

    id_retail = d.get("id_retail")
    target_url = RETAIL_ENDPOINTS.get(id_retail)

    if not target_url:
        return jsonify({"status": "error", "message": f"id_retail {id_retail} tidak memiliki endpoint terdaftar."}), 404

    _direct_broadcast_async(event)

    return jsonify({
        "status": "success",
        "broadcasted": True,
        "id_retail": id_retail,
        "target_url": target_url,
        "no_resi": no_resi,
        "status_now": event["data"].get("status_now"),
        "event_type": event.get("type")
    }), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "time": now_iso(),
        "retail_endpoints": RETAIL_ENDPOINTS  
    }), 200

EXCEL_PATH = os.path.join(os.path.dirname(__file__), "auth.xlsx")
_auth_cache = {"mtime": None, "rows": [], "name_col": None, "pass_col": None}

def _ensure_excel():
    if not os.path.exists(EXCEL_PATH):
        df = pd.DataFrame(columns=["name", "password", "email", "password_hash"])
        df.to_excel(EXCEL_PATH, index=False, engine="openpyxl")

def _load_rows():
    _ensure_excel()
    try:
        mtime = os.path.getmtime(EXCEL_PATH)
    except FileNotFoundError:
        return []

    if _auth_cache["mtime"] != mtime:
        df = pd.read_excel(EXCEL_PATH, engine="openpyxl", dtype=str).fillna("")
        if df.empty:
            _auth_cache.update({"mtime": mtime, "rows": [], "name_col": None, "pass_col": None})
            return []

        cols = {c.lower().strip(): c for c in df.columns}
        name_key = next((cols[k] for k in ("name", "nama", "username") if k in cols), df.columns[0])
        pass_key = next(
            (cols[k] for k in ("password", "pass", "pwd", "kata sandi", "kata_sandi") if k in cols),
            (df.columns[1] if len(df.columns) > 1 else df.columns[0])
        )

        rows = []
        for _, r in df.iterrows():
            nm = str(r.get(name_key, "")).strip().lower()
            pw = str(r.get(pass_key, "")).strip()
            if nm and pw:
                rows.append((nm, pw))

        _auth_cache.update({"mtime": mtime, "rows": rows, "name_col": name_key, "pass_col": pass_key})

    return _auth_cache["rows"]

def verify_excel_credentials(name: str, password: str) -> bool:
    n = (name or "").strip().lower()
    p = (password or "").strip()
    return any(n == nm and p == pw for nm, pw in _load_rows())

def admin_required(fn):
    @wraps(fn)
    def _wrap(*args, **kwargs):
        if not session.get("is_admin"):
            return redirect(url_for("login_page"))
        return fn(*args, **kwargs)
    return _wrap

@app.route("/login", methods=["GET"])
def login_page():
    if session.get("is_admin"):
        return redirect(url_for("admin_page"))
    return render_template("login.html")  

def _do_session_login(data):
    name = (data.get("name") or "").strip()
    password = (data.get("password") or "").strip()
    if not name or not password:
        return jsonify({"status": "error", "message": "Nama dan password wajib."}), 400
    if verify_excel_credentials(name, password):
        session["is_admin"] = True
        session["admin_name"] = name
        session["admin_email"] = ""  
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Nama atau password salah."}), 401

@app.route("/session-login", methods=["POST"])
@app.route("/session-login-excel", methods=["POST"])
def session_login_excel():
    data = request.get_json(silent=True) or request.form or {}
    return _do_session_login(data)

@app.route("/logout", methods=["POST","GET"])
def logout():
    session.clear()
    return redirect(url_for("login_page"))

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def today_ymd() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def add_days_ymd(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

def gen_resi() -> str:
    ts = datetime.now().strftime("%Y%m%d")
    rand = secrets.token_hex(3).upper()
    return f"RESI-{ts}-{rand[:6]}"

def get_route_from_firestore(origin: str, destination: str):
    o = (origin or "").strip().lower()
    d = (destination or "").strip().lower()
    doc = db.collection("routes").document(f"{o}_{d}").get()
    if doc.exists:
        return doc.to_dict()
    q = db.collection("routes").where("origin", "==", o).where("destination", "==", d).get()
    return q[0].to_dict() if q else None

def route_info(asal: str, tujuan: str):
    fs = get_route_from_firestore(asal, tujuan)
    if fs:
        return {
            "price_base":       int(fs.get("price_base")),
            "eta_days":         int(fs.get("eta_days", 1)),
            "distributor_id":   int(fs.get("distributor_id", 2)),
            "distributor_name": str(fs.get("distributor_name", "PT Ikan Terbang Makmur Sejahtera TBK")),
            "per_kg_factor":    float(fs.get("per_kg_factor", 0.7)),
            "included_kg":      int(fs.get("included_kg", 1)),
        }
    key = ((asal or "").strip().lower(), (tujuan or "").strip().lower())
    return ROUTE_TABLE.get(key)

def eta_text(days: int) -> str:
    return "1 hari" if days == 1 else f"{days} hari"

def calc_price(price_base: int, qty_kg: int, per_kg_factor: float = 0.7, included_kg: int = 1) -> int:

    if qty_kg <= 0:
        return 0
    extra_kg = max(qty_kg - included_kg, 0)
    extra_cost = extra_kg * per_kg_factor * price_base
    return int(round(price_base + extra_cost))

def _normalize_doc(d: dict) -> dict:
    items = d.get("barang_dipesan") or []
    first_name = (items[0].get("nama_barang") if items else None) or d.get("nama_barang") or "-"
    qty = d.get("total_kuantitas") or d.get("kuantitas") or 0

    eta_text = _first_non_empty(
        d.get("eta_text"),
        d.get("eta"),
        d.get("estimasi_tiba"),
    )
    eta_days = _first_non_empty(
        d.get("eta_days"),
    )
    eta_date_raw = _first_non_empty(
        d.get("eta_delivery_date"),
        d.get("eta_date"),
    )
    eta_delivery_date = _date_to_ymd_or_same(eta_date_raw)

    normalized = {
        "doc_id": d.get("doc_id"),
        "no_resi": d.get("no_resi"),
        "buyer": d.get("id_pembeli") or d.get("nama_supplier") or (d.get("id_retail") and f"RETAIL-{d.get('id_retail')}") or "-",
        "item_name": first_name,
        "qty": qty,
        "route_origin": d.get("asal_pengirim") or d.get("asal_supplier") or "-",
        "route_dest": d.get("tujuan") or d.get("tujuan_retail") or "-",
        "price": d.get("harga_pengiriman") or d.get("biaya_pengiriman") or 0,
        "status": d.get("status") or "-",
        "tanggal_pembelian": d.get("tanggal_pembelian") or "-",
        "created_at": d.get("created_at") or "-",

        "eta_text": eta_text,
        "eta_days": eta_days,
        "eta_delivery_date": eta_delivery_date,
    }

    if items and len(items) > 0:
        normalized["barang_dipesan"] = items
        normalized["total_kuantitas"] = qty

    return normalized

def _hmac_signature(secret: str, body_bytes: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256)
    return mac.hexdigest()

def _load_active_subscribers(event_name: str):
    docs = db.collection(WEBHOOKS_COL).where("is_active", "==", True).stream()
    subs = []
    for d in docs:
        obj = d.to_dict()
        if event_name in (obj.get("events") or []):
            obj["id"] = d.id
            subs.append(obj)
    return subs

def _dispatch_one(url: str, secret: str, event: dict):
    body = json.dumps(event, ensure_ascii=False).encode("utf-8")
    sig  = _hmac_signature(secret or "", body)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "distributor-webhook/1.0",
        "X-Event-Type": event["type"],
        "X-Event-Id": event["id"],
        "X-Signature": sig,
    }
    try:
        r = requests.post(url, data=body, headers=headers, timeout=POST_TIMEOUT_SECS)
        ok = (200 <= r.status_code < 300)
        return ok, f"{r.status_code} {r.text[:200]}"
    except Exception as e:
        return False, str(e)

def _enqueue_dlq(sub_id: str, url: str, event: dict, last_err: str):
    db.collection(DLQ_COL).add({
        "subscriber_id": sub_id,
        "target_url": url,
        "event": event,
        "last_error": last_err,
        "created_at": now_iso(),
        "retryable": True,
    })

def _build_status_event(doc_after: dict, old_status: str, new_status: str) -> dict:
    return {
        "id": f"evt_{secrets.token_hex(8)}",
        "type": EVENT_STATUS_UPDATED,
        "created_at": now_iso(),
        "version": 1,
        "data": {
            "no_resi": doc_after.get("no_resi"),
            "doc_id": doc_after.get("doc_id"),
            "old_status": old_status,
            "new_status": new_status,
            "route": {
                "origin": doc_after.get("asal_pengirim") or doc_after.get("asal_supplier"),
                "destination": doc_after.get("tujuan") or doc_after.get("tujuan_retail"),
            },
            "updated_at": now_iso(),
        }
    }

def _notify_status_change(doc_after: dict, old_status: str, new_status: str):
    subs = _load_active_subscribers(EVENT_STATUS_UPDATED)
    if not subs:
        return
    event = _build_status_event(doc_after, old_status, new_status)
    for sub in subs:
        url = sub.get("url"); secret = sub.get("secret","")
        success = False; last_err = ""
        for i in range(MAX_RETRIES):
            ok, info = _dispatch_one(url, secret, event)
            if ok:
                success = True
                break
            last_err = info
            time.sleep((BACKOFF_BASE * (2 ** i)) + (0.05 * i))
        if not success:
            _enqueue_dlq(sub_id=sub["id"], url=url, event=event, last_err=last_err)


def _date_to_ymd_or_same(x):

    if isinstance(x, dict) and "seconds" in x:
        dt = datetime.fromtimestamp(int(x["seconds"]))
        return dt.strftime("%Y-%m-%d")
    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d")
    if isinstance(x, str):
        try:
            dt = datetime.fromisoformat(x.replace("Z", "+00:00")) if ("T" in x or "Z" in x or "+" in x) else datetime.strptime(x, "%Y-%m-%d")
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return x
    return None

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.logger.info(f"[Startup] Retail endpoints: {json.dumps(RETAIL_ENDPOINTS, indent=2)}")
    app.run(host="0.0.0.0", port=port, debug=True)