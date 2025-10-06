/* ============================================
   MAIN APPLICATION - WITH ANALYTICS
   ============================================ */

let allShipmentsData = { aktif: [], history: [] };
let filteredAktifData = [];
let filteredSelesaiData = [];

// Analytics Charts
let revenueChartInstance = null;
let statusChartInstance = null;

// [REV] ---- helper global (pakai di mana-mana) ----
function normalizeDate(d) {
  if (!d) return null;
  if (typeof d === "object" && d !== null && "seconds" in d) {
    return new Date(d.seconds * 1000); // Firestore Timestamp
  }
  if (typeof d === "string") {
    const t = new Date(d);
    return isNaN(t) ? null : t;
  }
  if (d instanceof Date) return d;
  return null;
}

// ============ TAB SWITCHING ============
function switchTab(tabName) {
  document
    .querySelectorAll(".tab-item")
    .forEach((item) => item.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((content) => content.classList.remove("active"));

  const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
  const activeContent = document.getElementById(`tab-${tabName}`);

  if (activeTab) activeTab.classList.add("active");
  if (activeContent) activeContent.classList.add("active");

  if (tabName === "dashboard") loadDashboard();
  if (tabName === "kelola-pesanan") loadKelolaPesanan();
  if (tabName === "analytics") loadAnalytics();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab-item").forEach((item) => {
    item.addEventListener("click", () =>
      switchTab(item.getAttribute("data-tab"))
    );
  });

  setupSearchAndFilters();
  loadDashboard();
});

// ============ SEARCH & FILTER SETUP ============
function setupSearchAndFilters() {
  const searchAktif = document.getElementById("search-aktif");
  if (searchAktif) {
    searchAktif.addEventListener("input", (e) => {
      filterAktifData(
        e.target.value,
        document.getElementById("filter-status-aktif")?.value || ""
      );
    });
  }

  const filterStatusAktif = document.getElementById("filter-status-aktif");
  if (filterStatusAktif) {
    filterStatusAktif.addEventListener("change", (e) => {
      filterAktifData(
        document.getElementById("search-aktif")?.value || "",
        e.target.value
      );
    });
  }

  const searchSelesai = document.getElementById("search-selesai");
  if (searchSelesai) {
    searchSelesai.addEventListener("input", (e) => {
      filterSelesaiData(e.target.value);
    });
  }
}

function filterAktifData(searchText, statusFilter) {
  let filtered = [...allShipmentsData.aktif];

  if (searchText.trim()) {
    const search = searchText.toLowerCase();
    filtered = filtered.filter((order) => {
      return (
        (order.no_resi || "").toLowerCase().includes(search) ||
        (order.buyer || "").toLowerCase().includes(search) ||
        (order.item_name || "").toLowerCase().includes(search) ||
        (order.route_origin || "").toLowerCase().includes(search) ||
        (order.route_dest || "").toLowerCase().includes(search)
      );
    });
  }

  if (statusFilter.trim()) {
    filtered = filtered.filter((order) => {
      return (order.status || "") === statusFilter;
    });
  }

  filteredAktifData = filtered;
  updateAktifTable(filtered);
}

function filterSelesaiData(searchText) {
  let filtered = [...allShipmentsData.history];

  if (searchText.trim()) {
    const search = searchText.toLowerCase();
    filtered = filtered.filter((order) => {
      return (
        (order.no_resi || "").toLowerCase().includes(search) ||
        (order.buyer || "").toLowerCase().includes(search) ||
        (order.item_name || "").toLowerCase().includes(search) ||
        (order.route_origin || "").toLowerCase().includes(search) ||
        (order.route_dest || "").toLowerCase().includes(search)
      );
    });
  }

  filteredSelesaiData = filtered;
  updateSelesaiTable(filtered);
}

// ============ DASHBOARD ============
async function loadDashboard() {
  try {
    const result = await API.getShipments();
    if (!result.success) throw new Error(result.error);

    const aktif = result.data.aktif || [];
    const history = result.data.history || [];

    allShipmentsData = { aktif, history };

    const stats = API.calculateStats(aktif, history);
    ChartManager.animateStats(stats);
    ChartManager.updateStatChanges(stats);

    const allShipments = [...aktif, ...history];
    const months = API.groupByMonth(allShipments, 6);
    ChartManager.initShipmentChart(months);

    updateRecentOrdersTable(aktif.slice(0, 10));
  } catch (error) {
    console.error("Error loading dashboard:", error);
    utils.showToast("Gagal memuat dashboard", "error");
  }
}

function updateRecentOrdersTable(orders) {
  const tbody = document.getElementById("recent-orders-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">
            <div class="empty-state"><i class="fas fa-inbox"></i><h3>Tidak ada pesanan terbaru</h3></div>
        </td></tr>`;
    return;
  }

  orders.forEach((order) => {
    const statusClass = utils.getStatusClass(order.status);
    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td><strong>${order.no_resi || "-"}</strong></td>
            <td>${order.buyer || "-"}</td>
            <td>${order.route_origin || "-"} → ${order.route_dest || "-"}</td>
            <td><span class="status-badge ${statusClass}">${
      order.status || "-"
    }</span></td>
            <td>${utils.formatDate(order.tanggal_pembelian)}</td>
            <td><strong>${utils.formatCurrency(order.price || 0)}</strong></td>
        `;
    tbody.appendChild(tr);
  });
}

// ============ KELOLA PESANAN ============
document.querySelectorAll(".sub-tab-item").forEach((item) => {
  item.addEventListener("click", () => {
    const targetTab = item.getAttribute("data-subtab");
    document
      .querySelectorAll(".sub-tab-item")
      .forEach((btn) => btn.classList.remove("active"));
    item.classList.add("active");
    document
      .querySelectorAll(".sub-tab-content")
      .forEach((content) => content.classList.remove("active"));
    document.getElementById(`subtab-${targetTab}`).classList.add("active");
  });
});

async function loadKelolaPesanan() {
  try {
    const result = await API.getShipments();
    if (!result.success) throw new Error(result.error);

    allShipmentsData = {
      aktif: result.data.aktif || [],
      history: result.data.history || [],
    };
    filteredAktifData = [...allShipmentsData.aktif];
    filteredSelesaiData = [...allShipmentsData.history];

    populateStatusFilter();
    updateAktifTable(filteredAktifData);
    updateSelesaiTable(filteredSelesaiData);
  } catch (error) {
    utils.showToast("Gagal memuat data pesanan", "error");
  }
}

function populateStatusFilter() {
  const filterSelect = document.getElementById("filter-status-aktif");
  if (!filterSelect) return;

  filterSelect.innerHTML = '<option value="">Semua Status</option>';

  utils.STATUS_LIST.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    filterSelect.appendChild(option);
  });
}

function updateAktifTable(orders) {
  const tbody = document.getElementById("table-aktif-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center">
            <div class="empty-state"><i class="fas fa-box-open"></i><h3>Tidak ada pesanan ditemukan</h3></div>
        </td></tr>`;
    return;
  }

  orders.forEach((order, index) => {
    const tr = document.createElement("tr");
    const statusClass = utils.getStatusClass(order.status);

    const fullOrder = allShipmentsData.aktif.find(
      (o) => o.doc_id === order.doc_id
    );

    let itemsDisplay = "";
    let qtyDisplay = 0;

    if (
      fullOrder &&
      fullOrder.barang_dipesan &&
      Array.isArray(fullOrder.barang_dipesan) &&
      fullOrder.barang_dipesan.length > 0
    ) {
      itemsDisplay = fullOrder.barang_dipesan
        .map(
          (item) =>
            `${item.nama_barang} <span style="color: #64748b;">(${item.kuantitas})</span>`
        )
        .join("<br>");
      qtyDisplay =
        fullOrder.total_kuantitas ||
        fullOrder.barang_dipesan.reduce(
          (sum, item) => sum + (parseInt(item.kuantitas) || 0),
          0
        );
    } else {
      itemsDisplay = order.item_name || "-";
      qtyDisplay = order.qty || 0;
    }

    // [REV] ===== ETA DISPLAY (versi robust, pakai helper global) =====
    const rawEtaText =
      fullOrder?.eta_text ??
      order.eta_text ??
      fullOrder?.eta ??
      order.eta ??
      fullOrder?.estimasi_tiba ??
      order.estimasi_tiba ??
      null;

    const rawEtaDate =
      fullOrder?.eta_delivery_date ??
      order.eta_delivery_date ??
      fullOrder?.eta_date ??
      order.eta_date ??
      null;

    const rawEtaDays = fullOrder?.eta_days ?? order.eta_days ?? null;

    const etaDate = normalizeDate(rawEtaDate);
    const etaText = rawEtaText;
    const etaDays = rawEtaDays;

    let etaDisplay = "-";
    // Prioritaskan hari saja
    if (etaDays != null && etaDays !== "" && etaDays !== "null") {
      const d = Number(etaDays);
      etaDisplay = d === 1 ? "1 hari" : `${d} hari`;
    } else if (etaText) {
      // pakai teks (mis. "2–3 hari", "Besok")
      etaDisplay = etaText;
    } else if (etaDate) {
      // terakhir, kalau benar2 butuh fallback
      etaDisplay = utils.formatDate(etaDate);
    }

    // [REV] ===== END ETA DISPLAY =====

    tr.innerHTML = `
            <td>${index + 1}</td>
            <td><strong>${order.no_resi || "-"}</strong></td>
            <td>${order.buyer || "-"}</td>
            <td style="max-width: 200px;">${itemsDisplay}</td>
            <td><strong>${qtyDisplay}</strong></td>
            <td>${order.route_origin || "-"} → ${order.route_dest || "-"}</td>
            <td><strong>${utils.formatCurrency(order.price || 0)}</strong></td>
            <td><span style="color: #059669; font-weight: 600;"><i class="fas fa-clock"></i> ${etaDisplay}</span></td>
            <td><span class="status-badge ${statusClass}">${
      order.status || "-"
    }</span></td>
            <td style="white-space: nowrap;">
                <button class="btn btn-warning btn-sm" onclick="openEditStatusModal('${
                  order.doc_id
                }', '${order.status}')" title="Edit Status">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('${
                  order.doc_id
                }')" title="Hapus">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    tbody.appendChild(tr);
  });
}

function updateSelesaiTable(orders) {
  const tbody = document.getElementById("table-selesai-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">
            <div class="empty-state"><i class="fas fa-history"></i><h3>Tidak ada histori ditemukan</h3></div>
        </td></tr>`;
    return;
  }

  orders.forEach((order, index) => {
    const tr = document.createElement("tr");

    const fullOrder = allShipmentsData.history.find(
      (o) => o.doc_id === order.doc_id
    );

    let itemsDisplay = "";
    let qtyDisplay = 0;

    if (
      fullOrder &&
      fullOrder.barang_dipesan &&
      Array.isArray(fullOrder.barang_dipesan) &&
      fullOrder.barang_dipesan.length > 0
    ) {
      itemsDisplay = fullOrder.barang_dipesan
        .map(
          (item) =>
            `${item.nama_barang} <span style="color: #64748b;">(${item.kuantitas})</span>`
        )
        .join("<br>");
      qtyDisplay =
        fullOrder.total_kuantitas ||
        fullOrder.barang_dipesan.reduce(
          (sum, item) => sum + (parseInt(item.kuantitas) || 0),
          0
        );
    } else {
      itemsDisplay = order.item_name || "-";
      qtyDisplay = order.qty || 0;
    }

    // [REV] ===== ETA DISPLAY UNTUK HISTORI (pakai helper global) =====
    const rawEtaText =
      fullOrder?.eta_text ??
      order.eta_text ??
      fullOrder?.eta ??
      order.eta ??
      fullOrder?.estimasi_tiba ??
      order.estimasi_tiba ??
      null;

    const rawEtaDate =
      fullOrder?.eta_delivery_date ??
      order.eta_delivery_date ??
      fullOrder?.eta_date ??
      order.eta_date ??
      null;

    const rawEtaDays = fullOrder?.eta_days ?? order.eta_days ?? null;

    const etaDateSelesai = normalizeDate(rawEtaDate);
    const etaTextSelesai = rawEtaText;
    const etaDaysSelesai = rawEtaDays;

    let etaDisplaySelesai = "-";
    if (etaTextSelesai && etaDateSelesai) {
      etaDisplaySelesai = `${etaTextSelesai} (${utils.formatDate(
        etaDateSelesai
      )})`;
    } else if (etaDaysSelesai != null && etaDaysSelesai !== "") {
      const d = Number(etaDaysSelesai);
      etaDisplaySelesai = d === 1 ? "1 hari" : `${d} hari`;
    } else if (etaTextSelesai) {
      etaDisplaySelesai = etaTextSelesai;
    }
    // [REV] ===== END ETA DISPLAY =====

    tr.innerHTML = `
            <td>${index + 1}</td>
            <td><strong>${order.no_resi || "-"}</strong></td>
            <td>${order.buyer || "-"}</td>
            <td style="max-width: 200px;">${itemsDisplay}</td>
            <td><strong>${qtyDisplay}</strong></td>
            <td>${order.route_origin || "-"} → ${order.route_dest || "-"}</td>
            <td><strong>${utils.formatCurrency(order.price || 0)}</strong></td>
            <td><span style="color: #059669; font-weight: 600;"><i class="fas fa-clock"></i> ${etaDisplaySelesai}</span></td>
            <td>${utils.formatDate(order.tanggal_pembelian)}</td>
        `;
    tbody.appendChild(tr);
  });
}

// ============ ANALYTICS ============
async function loadAnalytics() {
  try {
    const result = await API.getShipments();
    if (!result.success) throw new Error(result.error);

    const aktif = result.data.aktif || [];
    const history = result.data.history || [];
    const allShipments = [...aktif, ...history];

    // Calculate analytics data
    const analytics = calculateAnalytics(aktif, history);

    // Update key metrics
    updateKeyMetrics(analytics);

    // Update charts
    updateRevenueChart(allShipments);
    updateStatusChart(aktif, history);

    // Update routes
    updateTopRoutes(allShipments);

    // Update monthly summary
    updateMonthlySummary(allShipments, history);
  } catch (error) {
    console.error("Error loading analytics:", error);
    utils.showToast("Gagal memuat analytics", "error");
  }
}

function calculateAnalytics(aktif, history) {
  const allShipments = [...aktif, ...history];

  // Total Revenue
  const totalRevenue = allShipments.reduce(
    (sum, item) => sum + (item.price || 0),
    0
  );

  // Revenue Growth
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const thisMonthRevenue = allShipments
    .filter((item) => {
      const dateStr = item.tanggal_pembelian || item.created_at;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
    })
    .reduce((sum, item) => sum + (item.price || 0), 0);

  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

  const lastMonthRevenue = allShipments
    .filter((item) => {
      const dateStr = item.tanggal_pembelian || item.created_at;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return (
        date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear
      );
    })
    .reduce((sum, item) => sum + (item.price || 0), 0);

  const revenueGrowth =
    lastMonthRevenue > 0
      ? Math.round(
          ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
        )
      : thisMonthRevenue > 0
      ? 100
      : 0;

  // Average Delivery Time
  const shipmentsWithEta = allShipments.filter((item) => item.eta_days);
  const avgDelivery =
    shipmentsWithEta.length > 0
      ? Math.round(
          shipmentsWithEta.reduce(
            (sum, item) => sum + (item.eta_days || 0),
            0
          ) / shipmentsWithEta.length
        )
      : 0;

  // Success Rate
  const successRate =
    allShipments.length > 0
      ? Math.round((history.length / allShipments.length) * 100)
      : 0;

  // Active Routes
  const routesSet = new Set();
  allShipments.forEach((item) => {
    if (item.route_origin && item.route_dest) {
      routesSet.add(`${item.route_origin}-${item.route_dest}`);
    }
  });

  return {
    totalRevenue,
    revenueGrowth,
    avgDelivery,
    successRate,
    activeRoutes: routesSet.size,
  };
}

function updateKeyMetrics(analytics) {
  // Total Revenue
  const revenueEl = document.getElementById("total-revenue");
  if (revenueEl) {
    animateValue(revenueEl, 0, analytics.totalRevenue, 1500, true);
  }

  const revenueTrend = document.getElementById("revenue-trend");
  if (revenueTrend) {
    const arrow = analytics.revenueGrowth >= 0 ? "up" : "down";
    const color = analytics.revenueGrowth >= 0 ? "#10B981" : "#EF4444";
    revenueTrend.innerHTML = `
      <i class="fas fa-arrow-${arrow}" style="color: ${color}"></i>
      <span style="color: ${color}">${Math.abs(
      analytics.revenueGrowth
    )}% dari bulan lalu</span>
    `;
  }

  // Avg Delivery Time
  const avgDeliveryEl = document.getElementById("avg-delivery");
  if (avgDeliveryEl) {
    avgDeliveryEl.textContent = `${analytics.avgDelivery} hari`;
  }

  const deliveryTrend = document.getElementById("delivery-trend");
  if (deliveryTrend) {
    deliveryTrend.innerHTML = `
      <i class="fas fa-info-circle"></i>
      <span>Rata-rata estimasi</span>
    `;
  }

  // Success Rate
  const successRateEl = document.getElementById("success-rate");
  if (successRateEl) {
    animateValue(successRateEl, 0, analytics.successRate, 1500, false, "%");
  }

  const successTrend = document.getElementById("success-trend");
  if (successTrend) {
    const isGood = analytics.successRate >= 80;
    const icon = isGood ? "check-circle" : "exclamation-circle";
    const color = isGood ? "#10B981" : "#F59E0B";
    successTrend.innerHTML = `
      <i class="fas fa-${icon}" style="color: ${color}"></i>
      <span style="color: ${color}">${
      isGood ? "Performa baik" : "Perlu ditingkatkan"
    }</span>
    `;
  }

  // Active Routes
  const activeRoutesEl = document.getElementById("active-routes");
  if (activeRoutesEl) {
    animateValue(activeRoutesEl, 0, analytics.activeRoutes, 1000);
  }

  const routesTrend = document.getElementById("routes-trend");
  if (routesTrend) {
    routesTrend.innerHTML = `
      <i class="fas fa-route"></i>
      <span>Rute aktif</span>
    `;
  }
}

function animateValue(
  element,
  start,
  end,
  duration,
  isCurrency = false,
  suffix = ""
) {
  if (!element) return;

  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if (
      (increment > 0 && current >= end) ||
      (increment < 0 && current <= end)
    ) {
      current = end;
      clearInterval(timer);
    }

    if (isCurrency) {
      element.textContent = `Rp ${Math.round(current).toLocaleString("id-ID")}`;
    } else {
      element.textContent = Math.round(current) + suffix;
    }
  }, 16);
}

function updateRevenueChart(shipments) {
  const ctx = document.getElementById("revenueChart");
  if (!ctx) return;

  const months = API.groupByMonth(shipments, 6);

  // Calculate revenue per month
  const revenueData = months.map((month) => {
    const monthShipments = shipments.filter((item) => {
      const dateStr = item.tanggal_pembelian || item.created_at;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return (
        date.getMonth() === month.month && date.getFullYear() === month.year
      );
    });
    return monthShipments.reduce((sum, item) => sum + (item.price || 0), 0);
  });

  if (revenueChartInstance) {
    revenueChartInstance.destroy();
  }

  revenueChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: "Revenue (Rp)",
          data: revenueData,
          borderColor: "#007BFF",
          backgroundColor: "rgba(0, 123, 255, 0.1)",
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#007BFF",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) =>
              `Rp ${context.parsed.y.toLocaleString("id-ID")}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `Rp ${(value / 1000).toFixed(0)}k`,
          },
        },
      },
    },
  });
}

function updateStatusChart(aktif, history) {
  const ctx = document.getElementById("statusChart");
  if (!ctx) return;

  const statusCounts = {
    "Dalam Proses": 0,
    "Dalam Pengiriman": 0,
    Selesai: history.length,
  };

  aktif.forEach((item) => {
    const status = item.status || "";
    if (status === "Pesanan anda sedang kami proses") {
      statusCounts["Dalam Proses"]++;
    } else {
      statusCounts["Dalam Pengiriman"]++;
    }
  });

  if (statusChartInstance) {
    statusChartInstance.destroy();
  }

  statusChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(statusCounts),
      datasets: [
        {
          data: Object.values(statusCounts),
          backgroundColor: ["#F59E0B", "#3B82F6", "#10B981"],
          borderWidth: 3,
          borderColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 15,
            font: { size: 13, weight: "600" },
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage =
                total > 0 ? Math.round((value / total) * 100) : 0;
              return `${label}: ${value} (${percentage}%)`;
            },
          },
        },
      },
    },
  });
}

function updateTopRoutes(shipments) {
  const routesEl = document.getElementById("top-routes");
  if (!routesEl) return;

  const routeCounts = {};
  shipments.forEach((item) => {
    const route = `${item.route_origin || "-"} → ${item.route_dest || "-"}`;
    routeCounts[route] = (routeCounts[route] || 0) + 1;
  });

  const sortedRoutes = Object.entries(routeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sortedRoutes.length === 0) {
    routesEl.innerHTML =
      '<div class="empty-state"><i class="fas fa-map"></i><p>Belum ada rute</p></div>';
    return;
  }

  routesEl.innerHTML = sortedRoutes
    .map(
      ([route, count]) => `
        <div class="route-item">
            <div class="route-info">
                <div class="route-icon"><i class="fas fa-route"></i></div>
                <div class="route-text">${route}</div>
            </div>
            <div class="route-count">${count}</div>
        </div>
    `
    )
    .join("");
}

function updateMonthlySummary(allShipments, history) {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const thisMonthShipments = allShipments.filter((item) => {
    const dateStr = item.tanggal_pembelian || item.created_at;
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
  });

  const thisMonthCompleted = history.filter((item) => {
    const dateStr = item.tanggal_pembelian || item.created_at;
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
  });

  const monthlyTotal = thisMonthShipments.length;
  const monthlyRevenue = thisMonthShipments.reduce(
    (sum, item) => sum + (item.price || 0),
    0
  );
  const monthlyCompleted = thisMonthCompleted.length;
  const monthlyCompletionRate =
    monthlyTotal > 0 ? Math.round((monthlyCompleted / monthlyTotal) * 100) : 0;

  const totalEl = document.getElementById("monthly-total");
  const revenueEl = document.getElementById("monthly-revenue");
  const completedEl = document.getElementById("monthly-completed");
  const rateEl = document.getElementById("monthly-completion-rate");

  if (totalEl) animateValue(totalEl, 0, monthlyTotal, 1000);
  if (revenueEl) animateValue(revenueEl, 0, monthlyRevenue, 1500, true);
  if (completedEl) animateValue(completedEl, 0, monthlyCompleted, 1000);
  if (rateEl) animateValue(rateEl, 0, monthlyCompletionRate, 1000, false, "%");
}

// ============ FORMS ============
document
  .getElementById("form-tambah-pesanan")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const shipmentData = {
      id_pembeli: formData.get("id_pembeli"),
      nama_barang: formData.get("nama_barang"),
      kuantitas: parseInt(formData.get("kuantitas")),
      asal_pengirim: formData.get("asal_pengirim"),
      tujuan: formData.get("tujuan"),
    };

    try {
      const result = await API.createShipment(shipmentData);
      if (!result.success) throw new Error(result.error);

      utils.showToast("Pesanan berhasil ditambahkan!", "success");
      utils.closeModal("modalTambahPesanan");
      e.target.reset();
      loadDashboard();
      loadKelolaPesanan();
    } catch (error) {
      utils.showToast(error.message, "error");
    }
  });

window.openEditStatusModal = function (docId, currentStatus) {
  document.getElementById("edit-doc-id").value = docId;
  const select = document.getElementById("edit-status");
  select.innerHTML = "";
  utils.STATUS_LIST.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    if (status === currentStatus) option.selected = true;
    select.appendChild(option);
  });
  utils.openModal("modalEditStatus");
};

document
  .getElementById("form-edit-status")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const docId = document.getElementById("edit-doc-id").value;
    const newStatus = document.getElementById("edit-status").value;

    try {
      const result = await API.updateStatus(docId, newStatus);
      if (!result.success) throw new Error(result.error);
      utils.showToast("Status berhasil diupdate!", "success");
      utils.closeModal("modalEditStatus");
      loadDashboard();
      loadKelolaPesanan();
    } catch (error) {
      utils.showToast(error.message, "error");
    }
  });

window.confirmDelete = async function (docId) {
  if (!confirm("Yakin ingin memindahkan pesanan ini ke histori?")) return;
  try {
    const result = await API.updateStatus(docId, "Pesanan Selesai");
    if (!result.success) throw new Error(result.error);
    utils.showToast("Pesanan dipindahkan ke histori!", "success");
    loadDashboard();
    loadKelolaPesanan();
  } catch (error) {
    utils.showToast(error.message, "error");
  }
};

// Export
window.switchTab = switchTab;
window.loadDashboard = loadDashboard;
window.loadKelolaPesanan = loadKelolaPesanan;
window.loadAnalytics = loadAnalytics;
