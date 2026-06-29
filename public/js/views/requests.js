// public/js/views/requests.js

VIEW_RENDERERS.requests = async function (container, filters = {}) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-accent" id="addPRBtn">+ New Request</button>`;
  document.getElementById('addPRBtn').addEventListener('click', openPRForm);

  const qs = new URLSearchParams(filters).toString();
  const requests = await Api.listPRs(qs ? `?${qs}` : '');

  container.innerHTML = `
    <div class="filter-bar">
      <select id="filterStatus">
        <option value="">All statuses</option>
        ${['Draft', 'Submitted', 'ManagerApproved', 'FinanceApproved', 'Rejected', 'ConvertedToPO'].map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="panel">
      ${requests.length === 0 ? `<div class="empty-state">No purchase requests yet. Create one to start the approval chain.</div>` : `
        <table>
          <thead><tr><th>Request</th><th>Department</th><th>Approval Chain</th><th class="num">Est. Cost</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${requests.map(pr => `
              <tr>
                <td><strong>${esc(pr.requestNumber)}</strong><br><span class="muted">${esc((pr.justification || '').slice(0, 40))}${(pr.justification || '').length > 40 ? '…' : ''}</span></td>
                <td>${esc(pr.department)}</td>
                <td>${renderChain(pr.status)}</td>
                <td class="num">${money(pr.totalEstimatedCost)}</td>
                <td>${tag(pr.status)}</td>
                <td><div class="row-actions">${prActionButtons(pr)}</div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  document.getElementById('filterStatus').addEventListener('change', () => {
    const status = document.getElementById('filterStatus').value;
    VIEW_RENDERERS.requests(document.getElementById('viewContainer'), status ? { status } : {});
  });

  container.querySelectorAll('[data-pr-action]').forEach(btn => {
    btn.addEventListener('click', () => handlePRAction(btn.dataset.prAction, btn.dataset.prId));
  });
};

function renderChain(status) {
  const stages = ['Submitted', 'ManagerApproved', 'FinanceApproved', 'ConvertedToPO'];
  const labels = ['Sub', 'Mgr', 'Fin', 'PO'];
  const idx = status === 'Draft' ? -1 : status === 'Rejected' ? -2 : stages.indexOf(status);

  return `<div class="chain">` + stages.map((s, i) => {
    let dotClass = 'pending';
    if (status === 'Rejected') {
      dotClass = i === 0 ? 'rejected' : '';
    } else if (idx >= i) {
      dotClass = 'done';
    } else if (status === 'Draft') {
      dotClass = '';
    }
    const lineClass = (idx >= i && status !== 'Rejected') ? 'done' : '';
    return `
      <div class="chain-step">
        <div class="chain-wrap">
          <div class="chain-dot ${dotClass}">${dotClass === 'done' ? '✓' : (dotClass === 'rejected' ? '✕' : i + 1)}</div>
          <div class="chain-label">${labels[i]}</div>
        </div>
        ${i < stages.length - 1 ? `<div class="chain-line ${lineClass}"></div>` : ''}
      </div>
    `;
  }).join('') + `</div>`;
}

function prActionButtons(pr) {
  const role = State.user.role;
  const buttons = [];

  if (pr.status === 'Draft' && pr.requesterId === State.user.id) {
    buttons.push(`<button class="btn btn-sm btn-accent" data-pr-action="submit" data-pr-id="${pr.id}">Submit</button>`);
  }
  if (pr.status === 'Submitted' && (role === 'Manager' || role === 'SystemAdmin')) {
    buttons.push(`<button class="btn btn-sm btn-success" data-pr-action="approve" data-pr-id="${pr.id}">Approve</button>`);
    buttons.push(`<button class="btn btn-sm btn-danger" data-pr-action="reject" data-pr-id="${pr.id}">Reject</button>`);
  }
  if (pr.status === 'ManagerApproved' && (role === 'Finance' || role === 'SystemAdmin')) {
    buttons.push(`<button class="btn btn-sm btn-success" data-pr-action="approve" data-pr-id="${pr.id}">Approve</button>`);
    buttons.push(`<button class="btn btn-sm btn-danger" data-pr-action="reject" data-pr-id="${pr.id}">Reject</button>`);
  }
  if (pr.status === 'FinanceApproved' && (role === 'ProcurementAdmin' || role === 'SystemAdmin')) {
    buttons.push(`<button class="btn btn-sm btn-ghost" data-pr-action="makePO" data-pr-id="${pr.id}">Generate PO</button>`);
  }
  return buttons.join('');
}

async function handlePRAction(action, prId) {
  try {
    if (action === 'submit') {
      await Api.submitPR(prId);
      toast('Request submitted for approval', 'success');
    } else if (action === 'approve') {
      await Api.approvePR(prId);
      toast('Request approved', 'success');
    } else if (action === 'reject') {
      const comment = prompt('Reason for rejection (optional):') || '';
      await Api.rejectPR(prId, comment);
      toast('Request rejected', 'success');
    } else if (action === 'makePO') {
      navigateTo('orders');
      setTimeout(() => openPOForm(prId), 50);
      return;
    }
    navigateTo('requests');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openPRForm() {
  openModal(`
    <h3>New Purchase Request</h3>
    <p class="modal-sub">Add one or more line items. The request starts as a Draft until you submit it.</p>
    <form id="prForm">
      <div class="form-grid">
        <div class="field">
          <label>Department</label>
          <input type="text" id="prDept" required placeholder="Engineering" value="${esc(State.user.department || '')}">
        </div>
        <div class="field">
          <label>Justification <span class="optional">(optional)</span></label>
          <input type="text" id="prJustification" placeholder="Why is this needed?">
        </div>
      </div>

      <div class="section-eyebrow" style="margin-top:16px;">Line Items</div>
      <div class="line-items" id="lineItems"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="addLineItem" style="margin-top:8px;">+ Add item</button>

      <p class="modal-error" id="prFormError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-accent">Create Request</button>
      </div>
    </form>
  `);

  function addLineItemRow() {
    const row = document.createElement('div');
    row.className = 'line-item-row';
    row.innerHTML = `
      <input type="text" placeholder="Item name" class="li-name" required>
      <input type="number" placeholder="Qty" class="li-qty" min="1" step="1" required>
      <input type="number" placeholder="Est. cost / unit" class="li-cost" min="0" step="0.01" required>
      <button type="button" class="line-item-remove">×</button>
    `;
    row.querySelector('.line-item-remove').addEventListener('click', () => row.remove());
    document.getElementById('lineItems').appendChild(row);
  }
  addLineItemRow();
  document.getElementById('addLineItem').addEventListener('click', addLineItemRow);

  document.getElementById('prForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('prFormError');
    const rows = document.querySelectorAll('#lineItems .line-item-row');
    const items = Array.from(rows).map(row => ({
      itemName: row.querySelector('.li-name').value.trim(),
      quantity: Number(row.querySelector('.li-qty').value),
      estimatedCost: Number(row.querySelector('.li-cost').value)
    }));

    if (items.length === 0) { errEl.textContent = 'Add at least one line item.'; return; }

    try {
      await Api.createPR({
        department: document.getElementById('prDept').value.trim(),
        justification: document.getElementById('prJustification').value.trim() || undefined,
        items
      });
      closeModal();
      toast('Purchase request created as Draft', 'success');
      navigateTo('requests');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
