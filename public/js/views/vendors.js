// public/js/views/vendors.js

const VENDOR_CATEGORIES = ['Office Equipment', 'IT Hardware', 'Software & Licensing', 'Logistics', 'Raw Materials', 'Professional Services', 'Facilities', 'Marketing'];

VIEW_RENDERERS.vendors = async function (container, filters = {}) {
  const canManage = ['ProcurementAdmin', 'SystemAdmin'].includes(State.user.role);

  if (canManage) {
    document.getElementById('topbarActions').innerHTML = `<button class="btn btn-accent" id="addVendorBtn">+ Add Vendor</button>`;
    document.getElementById('addVendorBtn').addEventListener('click', openVendorForm);
  }

  const qs = new URLSearchParams(filters).toString();
  const vendors = await Api.listVendors(qs ? `?${qs}` : '');
  State.cache.vendors = vendors;

  container.innerHTML = `
    <div class="filter-bar">
      <select id="filterStatus">
        <option value="">All statuses</option>
        ${['Active', 'Pending', 'Rejected', 'Blocked'].map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select id="filterCategory">
        <option value="">All categories</option>
        ${VENDOR_CATEGORIES.map(c => `<option value="${c}" ${filters.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <input type="text" id="filterSearch" placeholder="Search by name…" value="${esc(filters.search || '')}">
    </div>

    <div class="panel">
      ${vendors.length === 0 ? `<div class="empty-state">No vendors match these filters yet.</div>` : `
        <table>
          <thead>
            <tr>
              <th>Vendor</th><th>Category</th><th>Country</th><th>Status</th>
              <th class="num">Risk</th><th class="num">Rating</th>${canManage ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${vendors.map(v => `
              <tr>
                <td><strong>${esc(v.name)}</strong><br><span class="mono muted">${esc(v.contactEmail)}</span></td>
                <td>${esc(v.category)}</td>
                <td>${esc(v.country || '—')}</td>
                <td>${tag(v.status)}</td>
                <td class="num">${Number(v.riskScore).toFixed(0)}</td>
                <td class="num">${v.rating ? '★ ' + Number(v.rating).toFixed(1) : '—'}</td>
                ${canManage ? `<td><div class="row-actions">${vendorActionButtons(v)}</div></td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  document.getElementById('filterStatus').addEventListener('change', applyVendorFilters);
  document.getElementById('filterCategory').addEventListener('change', applyVendorFilters);
  document.getElementById('filterSearch').addEventListener('input', debounce(applyVendorFilters, 350));

  if (canManage) {
    container.querySelectorAll('[data-vendor-action]').forEach(btn => {
      btn.addEventListener('click', () => handleVendorAction(btn.dataset.vendorAction, btn.dataset.vendorId));
    });
  }
};

function vendorActionButtons(v) {
  const buttons = [];
  if (v.status !== 'Active') buttons.push(`<button class="btn btn-sm btn-success" data-vendor-action="Active" data-vendor-id="${v.id}">Approve</button>`);
  if (v.status !== 'Rejected') buttons.push(`<button class="btn btn-sm btn-danger" data-vendor-action="Rejected" data-vendor-id="${v.id}">Reject</button>`);
  if (v.status !== 'Blocked') buttons.push(`<button class="btn btn-sm btn-ghost" data-vendor-action="Blocked" data-vendor-id="${v.id}">Block</button>`);
  return buttons.join('');
}

async function handleVendorAction(status, vendorId) {
  try {
    await Api.setVendorStatus(vendorId, status);
    toast(`Vendor status updated to ${status}`, 'success');
    navigateTo('vendors');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function applyVendorFilters() {
  const filters = {
    status: document.getElementById('filterStatus').value,
    category: document.getElementById('filterCategory').value,
    search: document.getElementById('filterSearch').value
  };
  Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });
  VIEW_RENDERERS.vendors(document.getElementById('viewContainer'), filters);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function openVendorForm() {
  openModal(`
    <h3>Add Vendor</h3>
    <p class="modal-sub">New vendors start in Pending status and require approval before they can receive purchase orders.</p>
    <form id="vendorForm">
      <div class="form-grid">
        <div class="field full">
          <label>Vendor Name</label>
          <input type="text" id="vName" required placeholder="Acme Supplies Inc.">
        </div>
        <div class="field">
          <label>Category</label>
          <select id="vCategory" required>
            ${VENDOR_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Country</label>
          <input type="text" id="vCountry" placeholder="USA">
        </div>
        <div class="field">
          <label>Contact Email</label>
          <input type="email" id="vEmail" required placeholder="contact@vendor.com">
        </div>
        <div class="field">
          <label>Phone</label>
          <input type="text" id="vPhone" placeholder="+1 555 000 0000">
        </div>
        <div class="field full">
          <label>Tax ID</label>
          <input type="text" id="vTaxId" placeholder="EIN / VAT number">
        </div>
      </div>
      <p class="modal-error" id="vendorFormError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-accent">Create Vendor</button>
      </div>
    </form>
  `);

  document.getElementById('vendorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('vendorFormError');
    try {
      await Api.createVendor({
        name: document.getElementById('vName').value.trim(),
        category: document.getElementById('vCategory').value,
        contactEmail: document.getElementById('vEmail').value.trim(),
        phone: document.getElementById('vPhone').value.trim() || undefined,
        country: document.getElementById('vCountry').value.trim() || undefined,
        taxId: document.getElementById('vTaxId').value.trim() || undefined
      });
      closeModal();
      toast('Vendor created', 'success');
      navigateTo('vendors');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
