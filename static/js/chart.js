/* ============================================
   CHART CONFIGURATIONS
   Chart.js setup and rendering
   ============================================ */

const ChartManager = {
    shipmentChart: null,
    
    // Initialize shipment chart
    initShipmentChart(months) {
        const ctx = document.getElementById('shipmentChart');
        if (!ctx) return;
        
        // Destroy existing chart if any
        if (this.shipmentChart) {
            this.shipmentChart.destroy();
        }
        
        // Get chart type from selector (default: bar)
        const chartTypeSelector = document.getElementById('chart-type');
        const chartType = chartTypeSelector ? chartTypeSelector.value : 'bar';
        
        // Prepare data
        const labels = months.map(m => m.label);
        const data = months.map(m => m.count);
        
        // Chart configuration
        const config = {
            type: chartType,
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pengiriman',
                    data: data,
                    backgroundColor: chartType === 'line' 
                        ? 'rgba(20, 184, 166, 0.1)'
                        : 'rgba(20, 184, 166, 0.8)',
                    borderColor: 'rgba(20, 184, 166, 1)',
                    borderWidth: 2,
                    borderRadius: chartType === 'bar' ? 8 : 0,
                    tension: 0.4,
                    fill: chartType === 'line',
                    pointBackgroundColor: 'rgba(20, 184, 166, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: chartType === 'line' ? 4 : 0,
                    pointHoverRadius: chartType === 'line' ? 6 : 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        padding: 12,
                        titleFont: {
                            size: 14,
                            weight: 'bold'
                        },
                        bodyFont: {
                            size: 13
                        },
                        borderColor: 'rgba(20, 184, 166, 0.5)',
                        borderWidth: 1,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return `Total: ${context.parsed.y} pengiriman`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            font: {
                                size: 12
                            },
                            color: '#6B7280'
                        },
                        grid: {
                            color: 'rgba(229, 231, 235, 0.5)',
                            drawBorder: false
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 12,
                                weight: '600'
                            },
                            color: '#6B7280'
                        },
                        grid: {
                            display: false,
                            drawBorder: false
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        };
        
        // Create chart
        this.shipmentChart = new Chart(ctx, config);
        
        // Add event listener for chart type change
        if (chartTypeSelector) {
            chartTypeSelector.addEventListener('change', () => {
                this.initShipmentChart(months);
            });
        }
    },
    
    // Update chart data
    updateShipmentChart(months) {
        if (!this.shipmentChart) {
            this.initShipmentChart(months);
            return;
        }
        
        this.shipmentChart.data.labels = months.map(m => m.label);
        this.shipmentChart.data.datasets[0].data = months.map(m => m.count);
        this.shipmentChart.update('active');
    },
    
    // Animate numbers (count up effect)
    animateValue(element, start, end, duration = 1000) {
        if (!element) return;
        
        const range = end - start;
        const increment = range / (duration / 16);
        let current = start;
        
        const timer = setInterval(() => {
            current += increment;
            if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
                current = end;
                clearInterval(timer);
            }
            element.textContent = Math.round(current);
        }, 16);
    },
    
    // Animate all stat values
    animateStats(stats) {
        const elements = {
            total: document.getElementById('stat-total'),
            proses: document.getElementById('stat-proses'),
            kirim: document.getElementById('stat-kirim'),
            selesai: document.getElementById('stat-selesai')
        };
        
        if (elements.total) this.animateValue(elements.total, 0, stats.total);
        if (elements.proses) this.animateValue(elements.proses, 0, stats.proses);
        if (elements.kirim) this.animateValue(elements.kirim, 0, stats.kirim);
        if (elements.selesai) this.animateValue(elements.selesai, 0, stats.selesai);
    },
    
    // Update stat change indicators
    updateStatChanges(stats) {
        const changeTotal = document.getElementById('stat-change-total');
        const changeProses = document.getElementById('stat-change-proses');
        const changeKirim = document.getElementById('stat-change-kirim');
        const changeSelesai = document.getElementById('stat-change-selesai');
        
        if (changeTotal) {
            const arrow = stats.growth >= 0 ? 'up' : 'down';
            const color = stats.growth >= 0 ? '#10B981' : '#EF4444';
            changeTotal.innerHTML = `
                <i class="fas fa-arrow-${arrow}" style="color: ${color}"></i> 
                ${Math.abs(stats.growth)}% dari minggu lalu
            `;
            changeTotal.style.color = color;
        }
        
        if (changeProses) {
            changeProses.innerHTML = `
                <i class="fas fa-circle"></i> ${stats.proses} pesanan diproses
            `;
            changeProses.style.color = '#F59E0B';
        }
        
        if (changeKirim) {
            changeKirim.innerHTML = `
                <i class="fas fa-circle"></i> ${stats.kirim} dalam perjalanan
            `;
            changeKirim.style.color = '#3B82F6';
        }
        
        if (changeSelesai) {
            changeSelesai.innerHTML = `
                <i class="fas fa-check"></i> ${stats.completionRate}% completion rate
            `;
            changeSelesai.style.color = '#10B981';
        }
    },
    
    // Create simple progress bar
    createProgressBar(percentage, color = '#14B8A6') {
        return `
            <div style="width: 100%; height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden;">
                <div style="width: ${percentage}%; height: 100%; background: ${color}; transition: width 1s ease;"></div>
            </div>
        `;
    }
};

// Export ChartManager
window.ChartManager = ChartManager;