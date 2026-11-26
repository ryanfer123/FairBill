(() => {
    const token = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    const button = document.getElementById('download-report');
    const status = document.getElementById('report-status');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        status.textContent = 'This report link is unavailable.';
        return;
    }
    button.hidden = false;
    button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Checking this report link…';
        try {
            const response = await fetch('/v1/shared-report', {
                headers: { Authorization: 'Bearer ' + token },
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
                referrerPolicy: 'no-referrer',
            });
            if (response.status === 404) {
                status.textContent = 'This report link is unavailable.';
                return;
            }
            if (!response.ok || response.headers.get('content-type') !== 'application/pdf') {
                throw new Error('Download unavailable');
            }
            const url = URL.createObjectURL(await response.blob());
            const download = document.createElement('a');
            download.href = url;
            download.download = 'FairBill-evidence.pdf';
            document.body.appendChild(download);
            download.click();
            download.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            status.textContent = 'The PDF was handed to your browser for download.';
        } catch {
            status.textContent = 'The PDF couldn’t be downloaded. Please try again.';
        } finally {
            button.disabled = false;
        }
    });
})();
