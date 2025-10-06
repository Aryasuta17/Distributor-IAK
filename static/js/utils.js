/* ============================================
   UTILITY FUNCTIONS
   Helper functions for common tasks
   ============================================ */

// STATUS LIST - Must match backend
const STATUS_LIST = [
    "Pesanan anda sedang kami proses",
    "Kurir berangkat mengambil paket",
    "Kurir mengirim paket",
    "Paket telah sampai di Gudang Sortir",
    "Paket Keluar dari Gudang Sortir",
    "Kurir menuju ke lokasi anda",
    "Paket telah sampai di lokasi anda",
    "Pesanan Selesai"
];

// Format currency (Indonesian Rupiah)
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

// Format date (Indonesian locale)
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    return new Intl.DateTimeFormat('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }).format(date);
}

// Format datetime
function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    return new Intl.DateTimeFormat('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

// Capitalize first letter
function capitalize(str) {
    if (!str || typeof str !== 'string') return '-';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Get status badge class
function getStatusClass(status) {
    if (!status) return 'status-proses';
    
    if (status === "Pesanan Selesai") {
        return 'status-selesai';
    } else if (status === "Pesanan anda sedang kami proses") {
        return 'status-proses';
    } else {
        return 'status-kirim';
    }
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Open modal
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal(e.target.id);
    }
});

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
            closeModal(activeModal.id);
        }
    }
});

// Show loading state
function showLoading(element) {
    if (!element) return;
    element.innerHTML = `
        <div class="loading-state">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Memuat data...</p>
        </div>
    `;
}

// Show empty state
function showEmptyState(element, message = 'Tidak ada data') {
    if (!element) return;
    element.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <h3>${message}</h3>
        </div>
    `;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Get month name (Indonesian)
function getMonthName(monthIndex) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[monthIndex] || '';
}

// Get short month name (Indonesian)
function getShortMonthName(monthIndex) {
    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
        'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
    ];
    return months[monthIndex] || '';
}

// Parse date safely
function parseDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

// Count items by status
function countByStatus(items, targetStatus) {
    return items.filter(item => item.status === targetStatus).length;
}

// Calculate growth percentage
function calculateGrowth(current, previous) {
    if (previous === 0) {
        return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 100);
}

// Generate random color
function getRandomColor(index) {
    const colors = [
        'rgba(20, 184, 166, 0.8)',
        'rgba(59, 130, 246, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(168, 85, 247, 0.8)',
        'rgba(236, 72, 153, 0.8)',
        'rgba(20, 184, 166, 0.6)'
    ];
    return colors[index % colors.length];
}

// Validate form data
function validateFormData(formData, requiredFields) {
    const errors = [];
    
    requiredFields.forEach(field => {
        const value = formData.get(field);
        if (!value || value.trim() === '') {
            errors.push(`${field} wajib diisi`);
        }
    });
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// Handle API error
function handleApiError(error) {
    console.error('API Error:', error);
    
    if (error.message) {
        showToast(error.message, 'error');
    } else {
        showToast('Terjadi kesalahan. Silakan coba lagi.', 'error');
    }
}

// Copy to clipboard
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Berhasil disalin ke clipboard', 'success');
        }).catch(() => {
            showToast('Gagal menyalin ke clipboard', 'error');
        });
    } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('Berhasil disalin ke clipboard', 'success');
        } catch (err) {
            showToast('Gagal menyalin ke clipboard', 'error');
        }
        document.body.removeChild(textarea);
    }
}

// Export for use in other files
window.utils = {
    STATUS_LIST,
    formatCurrency,
    formatDate,
    formatDateTime,
    capitalize,
    getStatusClass,
    showToast,
    openModal,
    closeModal,
    showLoading,
    showEmptyState,
    debounce,
    getMonthName,
    getShortMonthName,
    parseDate,
    countByStatus,
    calculateGrowth,
    getRandomColor,
    validateFormData,
    handleApiError,
    copyToClipboard
};