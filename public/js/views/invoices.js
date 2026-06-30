// public/js/views/invoices.js

VIEW_RENDERERS.invoices = async function (container, filters = {}) {
  const canSubmit = ['Vendor', 'ProcurementAdmin', 'Finance', 'SystemAdmin'].includes(State.user.role);
  const canDecide = ['Finance', 'SystemAdmin'].includes(State.user.role);

  if (canSubmit) {
    document.getElementById('topbarActions').innerHTML = `<button class="btn btn-accent" id="addInvoiceBtn">+ Submit Invoice</button>`;
    document.getElementById('addInvoiceBtn').addEventListener('click', openInvoiceForm);
  }

  const qs = new URLSearchParams(filters).toString();
  const [invoices, vendors] = await Promise.all([Api.listInvoices(qs ? `?${qs}` : ''), Api.listVendors()]);
  const vendorName = (id) => (vendors.find(v => v.id === id) || {}).name || id;

  container.innerHTML = `
    <div class="filter-bar">
      <select id="filterStatus">
        <option value="">All statuses</option>
        ${['Received', 'Matched', 'MismatchFound', 'Approved', 'Paid', 'Rejected'].map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="panel">
      ${invoices.length === 0 ? `<div class="empty-state">No invoices submitted yet.</div>` : `
        <table>
          <thead><tr><th>Invoice</th><th>Vendor</th><th class="num">Amount</th><th>Status</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td class="mono">${esc(inv.invoiceNumber)}</td>
                <td>${esc(vendorName(inv.vendorId))}</td>
                <td class="num">${money(Number(inv.amount) + Number(inv.taxAmount))}</td>
                <td>${tag(inv.status)}</td>
                <td><span class="muted" style="font-size:12px;">${esc(inv.mismatchReason || '—')}</span></td>
                <td><div class="row-actions">${canDecide ? invoiceActionButtons(inv) : ''}</div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  document.getElementById('filterStatus').addEventListener('change', () => {
    const status = document.getElementById('filterStatus').value;
    VIEW_RENDERERS.invoices(document.getElementById('viewContainer'), status ? { status } : {});
  });

  container.querySelectorAll('[data-inv-action]').forEach(btn => {
    btn.addEventListener('click', () => handleInvoiceAction(btn.dataset.invAction, btn.dataset.invId));
  });
};

function invoiceActionButtons(inv) {
  if (!['Matched', 'MismatchFound'].includes(inv.status)) return '';
  return `
    <button class="btn btn-sm btn-success" data-inv-action="approve" data-inv-id="${inv.id}">Approve</button>
    <button class="btn btn-sm btn-danger" data-inv-action="reject" data-inv-id="${inv.id}">Reject</button>
  `;
}

async function handleInvoiceAction(action, invId) {
  try {
    if (action === 'approve') {
      await Api.approveInvoice(invId);
      toast('Invoice approved — payment record created', 'success');
    } else if (action === 'reject') {
      await Api.rejectInvoice(invId);
      toast('Invoice rejected', 'success');
    }
    navigateTo('invoices');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openInvoiceForm() {
  const openPOs = await Api.listPOs();
  const eligible = openPOs.filter(po => !['Cancelled'].includes(po.status));

  if (eligible.length === 0) {
    openModal(`<h3>Submit Invoice</h3><p class="modal-sub">No purchase orders are available to invoice against yet.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`);
    return;
  }

  openModal(`
    <h3>Submit Invoice</h3>
    <p class="modal-sub">The invoice total is automatically matched against the purchase order total. A difference greater than 2% is flagged as a mismatch for Finance review.</p>
    <form id="invoiceForm">
      <div class="form-grid">
        <div class="field full">
          <label>Purchase Order</label>
          <select id="invPO" required>
            ${eligible.map(po => `<option value="${po.id}" data-total="${po.totalAmount}">${esc(po.poNumber)} — ${money(po.totalAmount)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Invoice Amount</label>
          <input type="number" id="invAmount" required min="0" step="0.01">
        </div>
        <div class="field">
          <label>Tax Amount <span class="optional">(optional)</span></label>
          <input type="number" id="invTax" min="0" step="0.01" value="0">
        </div>
        <div class="field full">
          <label>Due Date <span class="optional">(optional, defaults to 30 days)</span></label>
          <input type="date" id="invDue">
        </div>
      </div>
      <p class="modal-error" id="invoiceFormError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-accent">Submit Invoice</button>
      </div>
    </form>
  `);

  // Convenience: prefill invoice amount with the PO total when a PO is selected
  const poSelect = document.getElementById('invPO');
  const amountInput = document.getElementById('invAmount');
  function prefill() {
    const opt = poSelect.options[poSelect.selectedIndex];
    amountInput.value = opt.dataset.total;
  }
  poSelect.addEventListener('change', prefill);
  prefill();

  document.getElementById('invoiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('invoiceFormError');
    try {
      await Api.createInvoice({
        poId: document.getElementById('invPO').value,
        amount: Number(document.getElementById('invAmount').value),
        taxAmount: Number(document.getElementById('invTax').value || 0),
        dueDate: document.getElementById('invDue').value || undefined
      });
      closeModal();
      toast('Invoice submitted', 'success');
      navigateTo('invoices');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
