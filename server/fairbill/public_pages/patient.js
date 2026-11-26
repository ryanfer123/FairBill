(() => {
    const $ = id => document.getElementById(id);
    const notice = text => { $('patient-status').textContent = text; };
    let token = null, epoch = 0, email = '', current = null, next = null, busy = false;

    function reset(message = '') {
        token = null;
        epoch++;
        email = '';
        current = null;
        next = null;
        $('email-form').reset();
        $('code-form').reset();
        $('upload-bill').reset();
        for (const id of ['case-list', 'case-documents', 'case-findings']) $(id).replaceChildren();
        $('code-form').hidden = true;
        $('email-form').hidden = false;
        $('bill-review').hidden = true;
        $('case-library').hidden = true;
        $('login').hidden = false;
        notice(message);
        $('patient-email').focus();
    }

    async function auth(path, data, accessToken) {
        const headers = { apikey: authKey, 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
        const response = await fetch(authOrigin + '/auth/v1/' + path, {
            method: 'POST', headers, body: JSON.stringify(data), credentials: 'omit',
            redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error(path === 'verify'
            ? 'That code is invalid or expired. Request another code.'
            : 'Sign-in could not be completed. Please try again.');
        return response;
    }

    async function api(path, { method = 'GET', data, pdf = false } = {}) {
        if (!token) throw new Error('Sign in first.');
        const ownEpoch = epoch;
        const headers = { Authorization: 'Bearer ' + token };
        const multipart = data instanceof FormData;
        if (data !== undefined && !multipart) headers['Content-Type'] = 'application/json';
        if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
        const response = await fetch('/v1' + path, {
            method, headers, body: data === undefined ? undefined : multipart ? data : JSON.stringify(data),
            credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        if (ownEpoch !== epoch) throw new Error('This session changed.');
        if (response.status === 401) {
            reset('Your session expired. Sign in again.');
            throw new Error('Your session expired. Sign in again.');
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || 'FairBill could not complete this request.');
        }
        if (pdf) {
            if (response.headers.get('content-type') !== 'application/pdf') throw new Error('The PDF could not be read.');
            return response.blob();
        }
        return response.json();
    }

    function run(action) {
        if (busy) return;
        busy = true;
        notice('Working…');
        for (const button of document.querySelectorAll('button')) button.disabled = true;
        void action().catch(error => notice(error.message)).finally(() => {
            busy = false;
            for (const button of document.querySelectorAll('button')) button.disabled = false;
        });
    }

    function element(name, text) {
        const node = document.createElement(name);
        if (text != null) node.textContent = text;
        return node;
    }

    const casePath = id => '/cases/' + encodeURIComponent(id);
    const rupees = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR',
    }).format(value / 100);

    async function library(append = false) {
        const page = await api('/cases?limit=20' + (append && next ? '&after=' + encodeURIComponent(next) : ''));
        const list = $('case-list');
        if (!append) list.replaceChildren();
        for (const item of page.cases) {
            const row = element('li');
            const label = 'Hospital bill · ' + item.id.slice(-6).toUpperCase();
            const button = element('button', label);
            button.type = 'button';
            button.onclick = () => run(async () => showCase(await api(casePath(item.id))));
            row.append(button);
            list.append(row);
        }
        next = page.next_after;
        $('more-cases').hidden = !next;
        $('login').hidden = $('bill-review').hidden = true;
        $('case-library').hidden = false;
        $('library-title').focus();
        notice(list.children.length ? 'Cases loaded.' : 'No cases yet.');
    }

    function rowField(parent, label, value, numeric = false) {
        const wrapper = element('label', label);
        const input = element('input');
        input.value = value ?? '';
        input.required = true;
        if (numeric) input.inputMode = 'decimal';
        wrapper.append(input);
        parent.append(wrapper);
        return input;
    }

    function amount(text) {
        const [whole, fraction = ''] = text.trim().replace(/,/g, '').split('.');
        if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text.trim().replace(/,/g, ''))) {
            throw new Error('Enter line amounts in rupees, with up to two decimal places.');
        }
        return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    }

    function editableLines(documentCard, doc) {
        const form = element('form');
        const edits = doc.rows.map((row, index) => {
            const field = element('fieldset');
            field.append(element('legend', 'Line ' + (index + 1)));
            const name = rowField(field, 'Description', row.description);
            const units = row.type === 'charge' ? rowField(field, 'Quantity', row.units, true) : null;
            const price = rowField(field, 'Line amount (₹)', row.amount == null ? '' : (row.amount / 100).toFixed(2), true);
            form.append(field);
            return { row, name, units, price };
        });
        if (!edits.length) {
            documentCard.append(element('p', 'FairBill couldn’t extract bill lines. Try uploading a clearer itemised bill.'));
            return;
        }
        const button = element('button', 'Confirm document lines');
        button.type = 'submit';
        form.append(button);
        form.onsubmit = event => {
            event.preventDefault();
            run(async () => {
                const rows = edits.map(({ row, name, units, price }) => {
                    if (units && !/^[1-9]\d{0,3}$/.test(units.value.trim())) throw new Error('Enter each quantity as a whole number.');
                    return { ...row, description: name.value.trim(), units: units ? Number(units.value) : row.units, amount: amount(price.value) };
                });
                showCase(await api(casePath(current.id) + '/documents/' + encodeURIComponent(doc.id) + '/confirm', {
                    method: 'POST', data: { revision: current.revision, rows },
                }));
                notice('Document lines confirmed.');
            });
        };
        documentCard.append(form);
    }

    function showCase(value) {
        current = value;
        $('login').hidden = $('case-library').hidden = true;
        $('bill-review').hidden = false;
        const docs = $('case-documents');
        const findings = $('case-findings');
        docs.replaceChildren();
        findings.replaceChildren();
        for (const doc of value.documents) {
            const card = element('section');
            card.append(element('h3', doc.kind === 'invoice' ? 'Itemised bill' : 'Supporting document'));
            const source = element('details');
            source.append(element('summary', 'View extracted source text'), element('pre', doc.pages.join('\n\n')));
            card.append(source);
            if (doc.kind === 'invoice' && !doc.confirmed) editableLines(card, doc);
            else if (doc.confirmed) {
                const list = element('ul');
                for (const row of doc.rows) list.append(element('li', row.description + ' · ' + rupees(row.amount)));
                card.append(list);
            }
            docs.append(card);
        }
        const reviewed = value.investigated_revision === value.revision;
        $('investigate').hidden = !value.documents.some(doc => doc.kind === 'invoice' && doc.confirmed) || value.documents.some(doc => !doc.confirmed);
        $('export-packet').hidden = !reviewed;
        if (reviewed) {
            findings.append(element('h3', 'Evidence and findings'), element('p', 'Invoice total ' + rupees(value.scenario?.billed)));
            for (const item of value.findings) {
                const card = element('article');
                card.append(element('h4', item.title), element('p', item.explanation));
                const sources = element('ul');
                for (const source of item.evidence) {
                    sources.append(element('li', 'Page ' + source.page + ', line ' + source.line + ' · ' + source.quote));
                }
                card.append(sources);
                findings.append(card);
            }
        }
        $('review-title').focus();
        notice(reviewed ? 'Case review loaded.' : 'Review your bill lines.');
    }

    $('email-form').onsubmit = event => {
        event.preventDefault();
        run(async () => {
            email = $('patient-email').value.trim();
            await auth('otp', { email, create_user: true });
            $('email-form').hidden = true;
            $('code-form').hidden = false;
            $('patient-code').focus();
            notice('Enter the code from your FairBill email.');
        });
    };
    $('use-other-email').onclick = () => reset();
    $('code-form').onsubmit = event => {
        event.preventDefault();
        run(async () => {
            const response = await auth('verify', { email, token: $('patient-code').value.trim(), type: 'email' });
            const signedIn = await response.json();
            if (typeof signedIn.access_token !== 'string' || !signedIn.access_token) throw new Error('No session was returned.');
            token = signedIn.access_token;
            epoch++;
            $('code-form').reset();
            await library();
        });
    };
    $('sign-out').onclick = () => run(async () => {
        const old = token;
        reset('Signed out on this browser.');
        if (old) await auth('logout?scope=local', {}, old).catch(() => undefined);
    });
    $('more-cases').onclick = () => run(() => library(true));
    $('case-back').onclick = () => run(() => library());
    $('new-case').onclick = () => run(async () => showCase(await api('/cases', { method: 'POST', data: { sample: false } })));
    $('upload-bill').onsubmit = event => {
        event.preventDefault();
        run(async () => {
            const file = $('bill-file').files[0];
            if (!file) throw new Error('Choose an itemised bill.');
            if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file up to 10 MB.');
            const data = new FormData();
            data.append('file', file);
            data.append('kind', 'invoice');
            data.append('revision', String(current.revision));
            const updated = await api(casePath(current.id) + '/documents/file', { method: 'POST', data });
            $('upload-bill').reset();
            showCase(updated);
        });
    };
    $('investigate').onclick = () => run(async () => {
        showCase(await api(casePath(current.id) + '/investigate', { method: 'POST', data: { revision: current.revision } }));
    });
    $('export-packet').onclick = () => run(async () => {
        const blob = await api(casePath(current.id) + '/packet?revision=' + current.revision, { pdf: true });
        const url = URL.createObjectURL(blob);
        const link = element('a');
        link.href = url;
        link.download = 'FairBill-evidence.pdf';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        notice('The PDF was handed to your browser for download.');
    });
})();
