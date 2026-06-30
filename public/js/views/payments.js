// public/js/views/payments.js

VIEW_RENDERERS.payments = async function (container, filters = {}) {
  const canPay = ['Finance', 'SystemAdmin'].includes(State.user.role);

  const qs = new URLSearchParams(filters).toString();
  const [payments, vendors] = await Promise.all([Api.listPayments(qs ? `?${qs}` : ''), Api.listVendors()]);
  const vendorName = (id) => (vendors.find(v => v.id === id) || {}).name || id;

  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="filter-bar">
      <select id="filterStatus">
        <option value="">All statuses</option>
        ${['Unpaid', 'Overdue', 'Paid'].map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="panel">
      ${payments.length === 0 ? `<div class="empty-state">No payments tracked yet — they're created automatically when Finance approves an invoice.</div>` : `
        <table>
          <thead><tr><th>Vendor</th><th class="num">Amount</th><th>Due Date</th><th>Status</th><th>Method / Ref</th><th></th></tr></thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${esc(vendorName(p.vendorId))}</td>
                <td class="num">${money(p.amount)}</td>
                <td class="${p.dueDate < today && p.paymentStatus !== 'Paid' ? '' : ''}">${shortDate(p.dueDate)}</td>
                <td>${tag(p.paymentStatus)}</td>
                <td class="muted" style="font-size:12px;">${p.paymentMethod ? esc(p.paymentMethod) + (p.transactionReference ? ' · ' + esc(p.transactionReference) : '') : '—'}</td>
                <td>${canPay && p.paymentStatus !== 'Paid' ? `<button class="btn btn-sm btn-success" data-pay-id="${p.id}">Mark Paid</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  document.getElementById('filterStatus').addEventListener('change', () => {
    const status = document.getElementById('filterStatus').value;
    VIEW_RENDERERS.payments(document.getElementById('viewContainer'), status ? { status } : {});
  });

  container.querySelectorAll('[data-pay-id]').forEach(btn => {
    btn.addEventListener('click', () => openPayForm(btn.dataset.payId));
  });
};

function openPayForm(paymentId) {
  openModal(`
    <h3>Record Payment</h3>
    <p class="modal-sub">Marks this invoice as paid and closes out the payment record.</p>
    <form id="payForm">
      <div class="form-grid">
        <div class="field">
          <label>Payment Method</label>
          <select id="payMethod">
            <option>Bank Transfer</option>
            <option>Wire Transfer</option>
            <option>ACH</option>
            <option>Check</option>
            <option>Credit Card</option>
          </select>
        </div>
        <div class="field">
          <label>Transaction Reference <span class="optional">(optional)</span></label>
          <input type="text" id="payRef" placeholder="TXN-00123">
        </div>
      </div>
      <p class="modal-error" id="payFormError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-accent">Mark Paid</button>
      </div>
    </form>
  `);

  document.getElementById('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('payFormError');
    try {
      await Api.payPayment(paymentId, {
        paymentMethod: document.getElementById('payMethod').value,
        transactionReference: document.getElementById('payRef').value.trim() || undefined
      });
      closeModal();
      toast('Payment recorded', 'success');
      navigateTo('payments');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
