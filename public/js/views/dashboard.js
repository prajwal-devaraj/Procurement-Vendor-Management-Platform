// Dashboard view — KPI cards + spend chart + top vendors

VIEW_RENDERERS.dashboard = async function (container) {
    const [summary, monthly, mismatch, bottlenecks] = await Promise.all([
        Api.summary(),
        Api.monthlySpend(),
        Api.get('/analytics/invoice-mismatch-rate'),
        Api.get('/analytics/approval-bottlenecks')
    ]);

    const kpis = [
        { label: 'Total Vendors',       value: summary.totalVendors,                            accent: 'rust'  },
        { label: 'Pending Approvals',   value: summary.pendingApprovals,                        accent: 'amber' },
        { label: 'Total Spend',         value: money(summary.totalProcurementSpend),             accent: 'blue'  },
        { label: 'Open POs',            value: summary.openPurchaseOrders,                      accent: 'blue'  },
        { label: 'Overdue Invoices',    value: summary.overdueInvoices,                         accent: 'red'   },
        { label: 'Avg. Approval Time',  value: `${summary.averageApprovalTimeDays}d`,           accent: 'green' },
    ];

    const maxSpend = Math.max(1, ...monthly.map(m => m.spend));

    container.innerHTML = `
        <div class="kpi-grid">
            ${kpis.map(k => `
                <div class="kpi-card accent-${k.accent}">
                    <p class="kpi-label">${esc(k.label)}</p>
                    <p class="kpi-value">${k.value}</p>
                </div>
            `).join('')}
        </div>

        <div class="two-col">
            <div class="panel">
                <div class="panel-header"><h3>Monthly Spend</h3></div>
                <div class="panel-body">
                    ${monthly.length === 0
                        ? `<p class="empty-state">No purchase orders yet.</p>`
                        : monthly.map(m => `
                            <div style="margin-bottom:12px;">
                                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                                    <span class="mono">${esc(m.month)}</span>
                                    <span>${money(m.spend)}</span>
                                </div>
                                <div class="spend-bar-track">
                                    <div class="spend-bar-fill" style="width:${(m.spend/maxSpend*100).toFixed(1)}%"></div>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>

            <div class="panel">
                <div class="panel-header"><h3>Top Vendors by Spend</h3></div>
                <div class="panel-body">
                    ${summary.topPerformingVendors.length === 0
                        ? `<p class="empty-state">No spend recorded yet.</p>`
                        : `<div class="stub-list">
                            ${summary.topPerformingVendors.map(v => `
                                <div class="stub s-rust">
                                    <div class="stub-main">
                                        <p class="stub-title">${esc(v.name)}</p>
                                        <p class="stub-sub">${v.rating ? `★ ${Number(v.rating).toFixed(1)}` : 'Unrated'}</p>
                                    </div>
                                    <strong>${money(v.totalSpend)}</strong>
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
            </div>
        </div>

        <div class="two-col">
            <div class="panel">
                <div class="panel-header"><h3>Approval Bottlenecks</h3></div>
                <div class="panel-body">
                    ${bottlenecks.length === 0
                        ? `<p class="empty-state">No pending approvals.</p>`
                        : `<table>
                            <thead><tr><th>Stage</th><th class="num">Pending</th><th class="num">Avg. wait</th></tr></thead>
                            <tbody>
                                ${bottlenecks.map(b => `
                                    <tr>
                                        <td>${esc(b.stage)}</td>
                                        <td class="num">${b.pendingCount}</td>
                                        <td class="num">${b.avgWaitDays}d</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>`
                    }
                </div>
            </div>

            <div class="panel">
                <div class="panel-header"><h3>Invoice Mismatch Rate</h3></div>
                <div class="panel-body">
                    <p class="kpi-value" style="margin-bottom:6px;">${mismatch.mismatchRate}%</p>
                    <p class="muted" style="font-size:12.5px;margin:0;">
                        ${mismatch.mismatchedInvoices} of ${mismatch.totalInvoices} invoices
                        flagged for amount mismatch against their PO.
                    </p>
                </div>
            </div>
        </div>
    `;
};
