// js/components/clinicalFindings.js
// Renders clinical rules engine findings, risk badges, evidence attribution, and confidence scores.

export function renderClinicalFindings(containerId, assessment) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!assessment || !assessment.findings || assessment.findings.length === 0) {
        container.innerHTML = `
            <div class="clinical-findings-empty">
                <i class="fas fa-check-circle" style="color: #1a7a3a;"></i>
                <span>No clinical safety warnings triggered for this configuration.</span>
            </div>
        `;
        return;
    }

    const severityColors = {
        LOW: 'var(--success-color, #1a7a3a)',
        MODERATE: 'var(--warning-color, #d97706)',
        HIGH: 'var(--danger-color, #dc2626)',
        CRITICAL: 'var(--critical-color, #991b1b)',
        Minor: 'var(--success-color, #1a7a3a)',
        Moderate: 'var(--warning-color, #d97706)',
        Major: 'var(--danger-color, #dc2626)',
        Contraindicated: 'var(--critical-color, #991b1b)'
    };

    const findingsHtml = assessment.findings.map(f => {
        const color = severityColors[f.severity] || '#666';
        return `
            <div class="clinical-finding-card" style="border-left: 4px solid ${color};">
                <div class="finding-header">
                    <span class="rule-type-badge"><i class="fas fa-shield-alt"></i> ${f.ruleType} Rule</span>
                    <span class="severity-badge" style="background-color: ${color}; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${f.severity}</span>
                </div>
                <div class="finding-body">
                    <p class="finding-text"><strong>Finding:</strong> ${f.finding}</p>
                    <p class="recommendation-text"><strong>Recommendation:</strong> ${f.recommendation}</p>
                </div>
                <div class="finding-footer" style="font-size: 0.8rem; color: #555; margin-top: 8px; display: flex; justify-content: space-between;">
                    <span><i class="fas fa-book"></i> Source: <strong>${f.evidence.sourceName}</strong> (Tier ${f.evidence.evidenceTier})</span>
                    <span><i class="fas fa-chart-line"></i> Confidence: <strong>${f.confidenceScore}%</strong></span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="clinical-findings-wrapper">
            <div class="card-title small" style="margin-bottom: 12px;">
                <i class="fas fa-stethoscope"></i> Clinical Safety Findings &amp; Decision Support
                <span class="severity-pill" style="background: ${severityColors[assessment.overallClinicalSeverity] || '#333'}; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; float: right;">
                    Overall: ${assessment.overallClinicalSeverity}
                </span>
            </div>
            <div class="findings-list">
                ${findingsHtml}
            </div>
        </div>
    `;
}
