/* ============================================
   API SERVICE - SIMPLIFIED (Backend Already Normalizes)
   ============================================ */

const API = {
    baseURL: '',

    // GET all shipments
    async getShipments() {
        try {
            const response = await fetch(`${this.baseURL}/api/shipments`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return { success: true, data: data };
        } catch (error) {
            console.error('Error fetching shipments:', error);
            return { success: false, error: error.message };
        }
    },

    // GET status by resi
    async getStatusByResi(resiNumber) {
        try {
            const response = await fetch(`${this.baseURL}/status?no_resi=${encodeURIComponent(resiNumber)}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Nomor resi tidak ditemukan');
            }
            const data = await response.json();
            return { success: true, data: data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // POST create shipment
    async createShipment(shipmentData) {
        try {
            const response = await fetch(`${this.baseURL}/shipments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(shipmentData)
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Gagal membuat pesanan');
            }
            const data = await response.json();
            return { success: true, data: data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // POST update status
    async updateStatus(docId, newStatus) {
        try {
            const formData = new FormData();
            formData.append('doc_id', docId);
            formData.append('status', newStatus);
            
            const response = await fetch(`${this.baseURL}/status/update`, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) throw new Error('Gagal mengupdate status');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Helper: Group by month
    groupByMonth(shipments, monthsBack = 6) {
        const now = new Date();
        const months = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        
        for (let i = monthsBack - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                year: d.getFullYear(),
                month: d.getMonth(),
                label: monthNames[d.getMonth()],
                count: 0
            });
        }
        
        shipments.forEach(item => {
            const dateStr = item.tanggal_pembelian || item.created_at;
            if (!dateStr) return;
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return;
            
            const month = months.find(m => m.month === date.getMonth() && m.year === date.getFullYear());
            if (month) month.count++;
        });
        
        return months;
    },

    // Helper: Calculate stats
    calculateStats(aktif, history) {
        const total = aktif.length + history.length;
        
        // Count exact status dari backend
        const proses = aktif.filter(x => x.status === "Pesanan anda sedang kami proses").length;
        const kirim = aktif.filter(x => {
            const s = x.status || '';
            return s.includes('Kurir') || s.includes('Gudang') || s.includes('lokasi');
        }).length;
        const selesai = history.length;
        
        // Growth calculation
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const allShipments = [...aktif, ...history];
        
        const thisWeek = allShipments.filter(item => {
            const dateStr = item.tanggal_pembelian || item.created_at;
            if (!dateStr) return false;
            const date = new Date(dateStr);
            return date >= weekAgo;
        }).length;
        
        const lastWeek = allShipments.length - thisWeek;
        const growth = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);
        const completionRate = total > 0 ? Math.round((selesai / total) * 100) : 0;
        
        return { total, proses, kirim, selesai, growth, completionRate };
    }
};

window.API = API;