// public/js/views/audit.js

VIEW_RENDERERS.audit = async function (container) {
  if (!['SystemAdmin', 'ProcurementAdmin'].includes(State.user.role)) {
    container.innerHTML = `<div class="panel"><div class="panel-body"><p class="empty-state">Audit logs are visible to Procurement Admins and System Admins only.</p></div></div>`;
    return;
  }

  const logs = await Api.auditLogs('?limit=200');

  container.innerHTML = `
    <div class="panel">
      ${logs.length === 0 ? `<div class="empty-state">No audit events recorded yet.</div>` : `
        <table>
          <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td class="mono" title="${esc(l.createdAt)}">${relTime(l.createdAt)}</td>
                <td><span class="tag tag-grey">${esc(l.action)}</span></td>
                <td class="mono">${esc(l.entityType)}<br><span class="muted">${esc((l.entityId || '').slice(0, 24))}…</span></td>
                <td class="muted" style="font-size:12px;max-width:320px;">${esc(formatDetails(l.details))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
};

function formatDetails(details) {
  if (!details) return '—';
  try {
    const obj = JSON.parse(details);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
  } catch {
    return details;
  }
}
