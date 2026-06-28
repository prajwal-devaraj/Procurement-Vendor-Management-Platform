// public/js/api.js
// Thin wrapper around fetch. Adds the JWT header automatically and normalises
// errors so every caller just gets thrown Error objects.

const API_BASE = '/api';

const Api = (() => {
    async function request(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (State.token) headers['Authorization'] = `Bearer ${State.token}`;

        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });

        if (res.status === 204) return null;

        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await res.json() : await res.text();

        if (!res.ok) {
            throw new Error((data && data.error) ? data.error : `Request failed (${res.status})`);
        }
        return data;
    }

    return {
        get:   (path)        => request('GET',    path),
        post:  (path, body)  => request('POST',   path, body),
        patch: (path, body)  => request('PATCH',  path, body),
        del:   (path)        => request('DELETE', path),

        login:    (email, pw) => request('POST', '/auth/login',    { email, password: pw }),
        register: (payload)   => request('POST', '/auth/register', payload),

        listVendors:    (qs = '') => request('GET', `/vendors${qs}`),
        getVendor:      (id)      => request('GET', `/vendors/${id}`),
        createVendor:   (data)    => request('POST', '/vendors', data),
        setVendorStatus:(id, s)   => request('PATCH', `/vendors/${id}/status`, { status: s }),
        rateVendor:     (id, d)   => request('POST', `/vendors/${id}/ratings`, d),

        listPRs:   (qs = '') => request('GET', `/purchaseRequests${qs}`),
        getPR:     (id)      => request('GET', `/purchaseRequests/${id}`),
        createPR:  (data)    => request('POST', '/purchaseRequests', data),
        submitPR:  (id)      => request('PATCH', `/purchaseRequests/${id}/submit`),
        approvePR: (id, c)   => request('POST', `/purchaseRequests/${id}/approve`, { comment: c }),
        rejectPR:  (id, c)   => request('POST', `/purchaseRequests/${id}/reject`,  { comment: c }),

        listPOs:    (qs = '') => request('GET', `/purchaseOrders${qs}`),
        getPO:      (id)      => request('GET', `/purchaseOrders/${id}`),
        createPO:   (data)    => request('POST', '/purchaseOrders', data),
        setPOStatus:(id, s)   => request('PATCH', `/purchaseOrders/${id}/status`, { status: s }),

        listInvoices:    (qs = '') => request('GET', `/invoices${qs}`),
        createInvoice:   (data)    => request('POST', '/invoices', data),
        approveInvoice:  (id)      => request('PATCH', `/invoices/${id}/approve`),
        rejectInvoice:   (id)      => request('PATCH', `/invoices/${id}/reject`),

        listPayments: (qs = '') => request('GET', `/payments${qs}`),
        payPayment:   (id, d)   => request('PATCH', `/payments/${id}/pay`, d),

        summary:      () => request('GET', '/analytics/summary'),
        vendorPerf:   () => request('GET', '/analytics/vendor-performance'),
        monthlySpend: () => request('GET', '/analytics/monthly-spend'),

        auditLogs: (qs = '') => request('GET', `/auditLogs${qs}`),
        users:     ()        => request('GET', '/users'),
        me:        ()        => request('GET', '/me'),
    };
})();
