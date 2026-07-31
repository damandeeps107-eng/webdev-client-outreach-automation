// WebDev Client Outreach Application JS Engine
const socket = io();

let loadedLeads = [];
let mediaAttachmentPath = null;
let currentTemplates = [];
let campaignChart = null;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initTabNavigation();
  initChart();
  fetchInitialState();
  fetchTemplates();

  socket.on('wa:status', updateWaStatusUI);
  socket.on('wa:qr', updateQrUI);
  socket.on('campaign:update', updateCampaignUI);
  socket.on('campaign:log', appendLiveLog);
});

async function fetchInitialState() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateWaStatusUI(data.waState);
    if (data.activeCampaign) updateCampaignUI(data.activeCampaign);
  } catch (err) {
    console.error('Failed status fetch:', err);
  }
}

function initTabNavigation() {
  const tabs = document.querySelectorAll('.nav-item');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = `tab-${tab.getAttribute('data-tab')}`;
      const targetPage = document.getElementById(targetId);
      if (targetPage) targetPage.classList.add('active');

      lucide.createIcons();
    });
  });
}

function updateWaStatusUI(waState) {
  const badge = document.getElementById('connectionBadge');
  const icon = document.getElementById('connIcon');
  const text = document.getElementById('connText');
  const modeText = document.getElementById('modeText');

  modeText.innerText = waState.isDemoMode ? 'Demo Simulation Active' : 'Live WhatsApp Engine';

  if (waState.status === 'connected') {
    badge.className = 'connection-status connected';
    text.innerText = `Connected (${waState.userPhone || 'Active'})`;
    icon.setAttribute('data-lucide', 'wifi');
  } else if (waState.status === 'connecting') {
    badge.className = 'connection-status';
    text.innerText = 'Connecting...';
    icon.setAttribute('data-lucide', 'loader-2');
  } else if (waState.status === 'demo') {
    badge.className = 'connection-status connected';
    text.innerText = 'Demo Ready';
    icon.setAttribute('data-lucide', 'check-circle');
  } else {
    badge.className = 'connection-status disconnected';
    text.innerText = 'Disconnected';
    icon.setAttribute('data-lucide', 'wifi-off');
  }
  lucide.createIcons();
}

function updateQrUI(data) {
  const qrContainer = document.getElementById('qrContainer');
  if (data.qrUrl) {
    qrContainer.innerHTML = `<img src="${data.qrUrl}" alt="WhatsApp QR Code" style="width:240px;height:240px;" />`;
  }
}

async function toggleDemoMode() {
  const res = await fetch('/api/toggle-demo', { method: 'POST' });
  const data = await res.json();
  alert(`Switched mode! Demo mode: ${data.isDemoMode ? 'ENABLED' : 'DISABLED'}`);
}

function openQrModal() {
  document.getElementById('qrModal').classList.add('active');
  fetch('/api/connect-wa', { method: 'POST' });
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('active');
}

function loadSampleLeads() {
  loadedLeads = [
    { BusinessName: 'Apex Fitness Gym', ContactName: 'Rahul Verma', Phone: '919876543210', FormattedPhone: '919876543210', Niche: 'Fitness & Gym', CurrentSite: 'No Website', OfferPrice: '4999' },
    { BusinessName: 'Urban Bite Cafe', ContactName: 'Priya Sharma', Phone: '919812345678', FormattedPhone: '919812345678', Niche: 'Restaurant & Cafe', CurrentSite: 'Outdated Site', OfferPrice: '5999' },
    { BusinessName: 'Luxe Salon & Spa', ContactName: 'Sneha Kapoor', Phone: '919988776655', FormattedPhone: '919988776655', Niche: 'Beauty & Salon', CurrentSite: 'No Website', OfferPrice: '3999' },
    { BusinessName: 'Nexora Real Estate', ContactName: 'Vikram Singh', Phone: '919711223344', FormattedPhone: '919711223344', Niche: 'Real Estate', CurrentSite: 'Slow Mobile Site', OfferPrice: '7999' },
    { BusinessName: 'FitLife Diagnostics', ContactName: 'Dr. Amit Patel', Phone: '919899001122', FormattedPhone: '919899001122', Niche: 'Healthcare Clinic', CurrentSite: 'No Website', OfferPrice: '6999' },
    { BusinessName: 'Grand Hotel & Suites', ContactName: 'Rohan Mehta', Phone: '919654321098', FormattedPhone: '919654321098', Niche: 'Hospitality', CurrentSite: 'Outdated Site', OfferPrice: '8999' },
    { BusinessName: 'Elite Law Associates', ContactName: 'Ananya Roy', Phone: '919543210987', FormattedPhone: '919543210987', Niche: 'Legal Services', CurrentSite: 'No Website', OfferPrice: '5999' }
  ];

  renderLeadsTable();
  updateMetrics();
  alert('Loaded 7 sample business leads for Web Developer Outreach!');
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload-leads', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      loadedLeads = data.contacts;
      renderLeadsTable();
      updateMetrics();
      alert(`Imported ${data.count} business leads!`);
    } else {
      alert('Upload failed: ' + data.error);
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  }
}

function renderLeadsTable() {
  const tbody = document.getElementById('leadsTbody');
  const search = document.getElementById('leadSearch').value.toLowerCase();
  
  const filtered = loadedLeads.filter(c => {
    const biz = (c.BusinessName || '').toLowerCase();
    const contact = (c.ContactName || '').toLowerCase();
    const phone = (c.FormattedPhone || c.Phone || '').toLowerCase();
    const niche = (c.Niche || '').toLowerCase();
    return biz.includes(search) || contact.includes(search) || phone.includes(search) || niche.includes(search);
  });

  document.getElementById('leadCountBadge').innerText = filtered.length;
  document.getElementById('leadsPillCount').innerText = filtered.length;

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center empty-table">
          <i data-lucide="file-warning"></i>
          <p>No business leads matching search.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = filtered.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${c.BusinessName}</strong></td>
      <td>${c.ContactName || 'Owner'}</td>
      <td><code>${c.FormattedPhone || c.Phone}</code></td>
      <td><span class="chip">${c.Niche || 'Business'}</span></td>
      <td><span style="font-size:0.8rem;color:var(--text-muted);">${c.CurrentSite || 'No Site'}</span></td>
      <td><strong>₹${c.OfferPrice || '4999'}</strong></td>
      <td><button class="btn btn-sm btn-secondary" onclick="removeLead(${i})">Remove</button></td>
    </tr>
  `).join('');

  lucide.createIcons();
}

function removeLead(index) {
  loadedLeads.splice(index, 1);
  renderLeadsTable();
  updateMetrics();
}

async function fetchTemplates() {
  try {
    const res = await fetch('/api/templates');
    currentTemplates = await res.json();

    const grid = document.getElementById('templatesGrid');
    grid.innerHTML = currentTemplates.map(t => `
      <div class="template-card">
        <div>
          <span class="template-category">${t.category}</span>
          <h4 class="template-title">${t.name}</h4>
          <div class="template-body">${t.template}</div>
        </div>
        <button class="btn btn-sm btn-primary btn-block" onclick="useTemplate('${t.id}')">
          Use Pitch Template
        </button>
      </div>
    `).join('');

    if (currentTemplates.length) useTemplate(currentTemplates[0].id);
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function useTemplate(templateId) {
  const t = currentTemplates.find(x => x.id === templateId);
  if (!t) return;

  document.getElementById('messageTemplateInput').value = t.template;
  updateLivePreview();
  document.querySelector('[data-tab="composer"]').click();
}

function insertVariable(varName) {
  const textarea = document.getElementById('messageTemplateInput');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;

  textarea.value = text.substring(0, start) + varName + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + varName.length;

  updateLivePreview();
}

function updateLivePreview() {
  const text = document.getElementById('messageTemplateInput').value;
  const previewBox = document.getElementById('previewText');

  if (!text.trim()) {
    previewBox.innerText = 'Your personalized website pitch message preview will appear here in real-time...';
    return;
  }

  let parsed = text.replace(/\{\{([^{}]+)\}\}/g, (m, choices) => choices.split('|')[0]);
  parsed = parsed.replace(/\{BusinessName\}/gi, 'Apex Fitness Gym')
                 .replace(/\{ContactName\}/gi, 'Rahul Verma')
                 .replace(/\{Niche\}/gi, 'Fitness & Gym')
                 .replace(/\{CurrentSite\}/gi, 'No Website')
                 .replace(/\{OfferPrice\}/gi, '4999');

  previewBox.innerText = parsed;
}

async function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('media', file);

  try {
    const res = await fetch('/api/upload-media', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      mediaAttachmentPath = data.filePath;
      document.getElementById('mediaFileName').innerText = `Attached: ${data.fileName}`;
    }
  } catch (err) {
    alert('Media upload error: ' + err.message);
  }
}

async function launchCampaign() {
  if (!loadedLeads.length) {
    alert('Please load or upload business leads first!');
    document.querySelector('[data-tab="leads"]').click();
    return;
  }

  const template = document.getElementById('messageTemplateInput').value;
  if (!template.trim()) {
    alert('Please compose or select a sales pitch template!');
    return;
  }

  const name = document.getElementById('campNameInput').value;

  try {
    const res = await fetch('/api/start-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName: name,
        template,
        contacts: loadedLeads,
        minDelay: 5,
        maxDelay: 12,
        mediaPath: mediaAttachmentPath
      })
    });

    const data = await res.json();
    if (data.success) {
      alert('🚀 Outreach Campaign Started! Monitoring live progress.');
      document.querySelector('[data-tab="dashboard"]').click();
    } else {
      alert('Error launching outreach: ' + data.error);
    }
  } catch (err) {
    alert('Launch error: ' + err.message);
  }
}

async function pauseCampaign() { await fetch('/api/pause-campaign', { method: 'POST' }); }
async function resumeCampaign() { await fetch('/api/resume-campaign', { method: 'POST' }); }
async function cancelCampaign() {
  if (confirm('Stop running campaign?')) await fetch('/api/cancel-campaign', { method: 'POST' });
}

function updateCampaignUI(campaign) {
  if (!campaign || !campaign.total) return;

  document.getElementById('campaignTitle').innerText = `${campaign.name} (${campaign.status.toUpperCase()})`;

  const total = campaign.total || 0;
  const sent = campaign.sent || 0;
  const failed = campaign.failed || 0;
  const processed = sent + failed;
  const remaining = campaign.remaining || 0;

  document.getElementById('statTotalLeads').innerText = total;
  document.getElementById('statSent').innerText = sent;
  document.getElementById('statFailed').innerText = failed;
  document.getElementById('statRemaining').innerText = remaining;

  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const successRate = processed > 0 ? Math.round((sent / processed) * 100) : 100;

  document.getElementById('progressText').innerText = `${processed} / ${total} Pitches Delivered`;
  document.getElementById('progressPercent').innerText = `${percent}%`;
  document.getElementById('progressBarFill').style.width = `${percent}%`;
  document.getElementById('statSuccessPercent').innerText = `${successRate}% Success`;

  const pauseBtn = document.getElementById('pauseCampBtn');
  const resumeBtn = document.getElementById('resumeCampBtn');
  const cancelBtn = document.getElementById('cancelCampBtn');

  if (campaign.status === 'running') {
    pauseBtn.style.display = 'inline-flex';
    resumeBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-flex';
  } else if (campaign.status === 'paused') {
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'inline-flex';
    cancelBtn.style.display = 'inline-flex';
  } else {
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
  }

  if (campaignChart) {
    campaignChart.data.datasets[0].data = [sent, failed, remaining];
    campaignChart.update();
  }
}

function appendLiveLog(log) {
  const container = document.getElementById('dashboardLiveLogs');
  if (container.querySelector('.empty-stream')) container.innerHTML = '';

  const div = document.createElement('div');
  div.className = `stream-item ${log.status}`;
  div.innerHTML = `
    <div>
      <strong>${log.businessName}</strong> <code>${log.phone}</code>
      <br><small style="color:var(--text-dim);">${log.messageSnippet}</small>
    </div>
    <div style="text-align:right;">
      <span class="live-indicator" style="${log.status === 'FAILED' ? 'color:var(--accent-rose);' : ''}">${log.status}</span>
      <br><small style="font-size:0.7rem;color:var(--text-dim);">${log.timestamp}</small>
    </div>
  `;

  container.prepend(div);

  const logsTbody = document.getElementById('logsTableBody');
  if (logsTbody.querySelector('.empty-table')) logsTbody.innerHTML = '';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${log.timestamp}</td>
    <td>${log.businessName}</td>
    <td><code>${log.phone}</code></td>
    <td><span class="chip">${log.status}</span></td>
    <td><small>${log.messageSnippet}</small></td>
  `;
  logsTbody.prepend(tr);
}

function updateMetrics() {
  document.getElementById('statTotalLeads').innerText = loadedLeads.length;
}

function initChart() {
  const ctx = document.getElementById('campaignChart');
  if (!ctx) return;

  campaignChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Sent', 'Failed', 'Remaining'],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ['#10b981', '#f43f5e', '#8b5cf6'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
    }
  });
}
