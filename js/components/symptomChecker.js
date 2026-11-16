import { showToast } from '../utils/helpers.js';

const BACKEND = 'http://127.0.0.1:8000';

export function initSymptomChecker() {
    const submitBtn = document.getElementById('symptomSubmitBtn');
    const symptomInput = document.getElementById('symptomInput');
    const durationInput = document.getElementById('durationInput');
    const severityInput = document.getElementById('severityInput');

    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
        const symptomsText = symptomInput.value.trim();
        if (!symptomsText) {
            showToast('Please enter at least one symptom', 'error');
            return;
        }

        const symptoms = symptomsText.split(',').map(s => s.trim()).filter(Boolean);
        const duration_days = parseInt(durationInput.value, 10) || 1;
        const severity = severityInput.value;

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

            const token = localStorage.getItem('mediguide_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const res = await fetch(`${BACKEND}/api/symptom-check`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ symptoms, duration_days, severity }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to submit symptom report');
            }

            const data = await res.json();
            showToast(data.message, 'success');
            symptomInput.value = '';
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit Report';
        }
    });
}
