// public/js/views/orders.js

VIEW_RENDERERS.orders = async function (container, filters = {}) {
  const canManage = ['ProcurementAdmin', 'SystemAdmin'].includes(State.user.role);

  if (canManage) {
    document.getElementById('topbarActions').innerHTML = `<button class="btn btn-accent" id="addPOBtn">+ Generate PO</button>`;
    document.getElementById('addPOBtn').addEventListener('click', () => openPOForm());
  }

  const qs = new URLSearchParams(filters).toString();
  const [orders, vendors] = await Promise.all([Api.listPOs(qs ? `?${qs}` : ''), Api.listVendors()]);
  const vendorName = (id) => (vendors.find(v => v.id === id) || {}).name || id;

  container.innerHTML = `
    <div class="filter-bar">
      <select id="filterStatus">
        <option value="">All statuses</option>
        ${['Created', 'SentToVendor', 'Acknowledged', 'PartiallyDelivered', 'Completed', 'Cancelled'].map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="panel">
      ${orders.length === 0 ? `<div class="empty-state">No purchase orders yet. Generate one from a Finance-approved purchase request.</div>` : `
        <table>
          <thead><tr><th>PO Number</th><th>Vendor</th><th class="num">Items</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${orders.map(po => `
              <tr>
                <td class="mono">${esc(po.poNumber)}</td>
                <td>${esc(vendorName(po.vendorId))}</td>
                <td class="num">${po.items.length}</td>
                <td class="num">${money(po.totalAmount)}</td>
                <td>${tag(po.status)}</td>
                <td><div class="row-actions">
                  <a class="btn btn-sm btn-ghost" href="${API_BASE}/purchaseOrders/${po.id}/pdf" target="_blank" rel="noopener" data-po-pdf="${po.id}">PDF</a>
                  ${canManage ? poActionButtons(po) : ''}
                </div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  document.getElementById('filterStatus').addEventListener('change', () => {
    const status = document.getElementById('filterStatus').value;
    VIEW_RENDERERS.orders(document.getElementById('viewContainer'), status ? { status } : {});
  });

  // PDF requires the Authorization header, so fetch as a blob rather than relying on the bare <a href>.
  container.querySelectorAll('[data-po-pdf]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const poId = link.dataset.poPdf;
      try {
        const res = await fetch(`${API_BASE}/purchaseOrders/${poId}/pdf`, { headers: { Authorization: `Bearer ${State.token}` } });
        if (!res.ok) throw new Error('Failed to generate PDF');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${poId}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-po-action]').forEach(btn => {
    btn.addEventListener('click', () => handlePOAction(btn.dataset.poAction, btn.dataset.poId));
  });
};

function poActionButtons(po) {
  const flow = { Created: 'SentToVendor', SentToVendor: 'Acknowledged', Acknowledged: 'PartiallyDelivered', PartiallyDelivered: 'Completed' };
  const next = flow[po.status];
  const buttons = [];
  if (next) buttons.push(`<button class="btn btn-sm btn-success" data-po-action="${next}" data-po-id="${po.id}">Mark ${next}</button>`);
  if (!['Completed', 'Cancelled'].includes(po.status)) buttons.push(`<button class="btn btn-sm btn-danger" data-po-action="Cancelled" data-po-id="${po.id}">Cancel</button>`);
  return buttons.join('');
}

async function handlePOAction(status, poId) {
  try {
    await Api.setPOStatus(poId, status);
    toast(`Purchase order marked ${status}`, 'success');
    navigateTo('orders');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openPOForm(prefillRequestId) {
  const [approvedRequests, activeVendors] = await Promise.all([
    Api.listPRs('?status=FinanceApproved'),
    Api.listVendors('?status=Active')
  ]);

  if (approvedRequests.length === 0) {
    openModal(`<h3>Generate Purchase Order</h3><p class="modal-sub">No Finance-approved purchase requests are available yet. A request must clear Manager and Finance approval before a PO can be generated.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`);
    return;
  }
  if (activeVendors.length === 0) {
    openModal(`<h3>Generate Purchase Order</h3><p class="modal-sub">No Active vendors are available yet. Approve a vendor first under Vendor Management.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`);
    return;
  }

  openModal(`
    <h3>Generate Purchase Order</h3>
    <p class="modal-sub">Converts a Finance-approved purchase request into a purchase order assigned to a vendor.</p>
    <form id="poForm">
      <div class="form-grid">
        <div class="field full">
          <label>Purchase Request</label>
          <select id="poRequest" required>
            ${approvedRequests.map(pr => `<option value="${pr.id}" ${pr.id === prefillRequestId ? 'selected' : ''}>${esc(pr.requestNumber)} — ${esc(pr.department)} — ${money(pr.totalEstimatedCost)}</option>`).join('')}
          </select>
        </div>
        <div class="field full">
          <label>Vendor</label>
          <select id="poVendor" required>
            ${activeVendors.map(v => `<option value="${v.id}">${esc(v.name)} (${esc(v.category)})</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="modal-error" id="poFormError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-accent">Generate PO</button>
      </div>
    </form>
  `);

  document.getElementById('poForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('poFormError');
    try {
      await Api.createPO({
        requestId: document.getElementById('poRequest').value,
        vendorId: document.getElementById('poVendor').value
      });
      closeModal();
      toast('Purchase order generated', 'success');
      navigateTo('orders');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
