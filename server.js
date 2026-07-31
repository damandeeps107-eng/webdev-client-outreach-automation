const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure upload directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage });

// System State
let waState = {
  status: 'disconnected', // 'disconnected', 'connecting', 'connected', 'demo'
  userPhone: null,
  qrCodeUrl: null,
  isDemoMode: true
};

let activeCampaign = {
  id: null,
  status: 'idle',
  total: 0,
  sent: 0,
  failed: 0,
  remaining: 0,
  logs: [],
  contacts: [],
  settings: {}
};

// Baileys Integration
let makeWASocket, useMultiFileAuthState, DisconnectReason;
let sock = null;

try {
  const baileys = require('@whiskeysockets/baileys');
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
} catch (e) {
  console.log('Baileys ready in dynamic mode.');
}

async function initWhatsAppSession() {
  if (!makeWASocket) return;

  try {
    const authDir = path.join(__dirname, 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    waState.status = 'connecting';
    io.emit('wa:status', waState);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['WebDev Outreach', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waState.qrCodeUrl = await QRCode.toDataURL(qr);
        waState.status = 'connecting';
        waState.isDemoMode = false;
        io.emit('wa:status', waState);
        io.emit('wa:qr', { qrUrl: waState.qrCodeUrl });
      }

      if (connection === 'open') {
        waState.status = 'connected';
        waState.qrCodeUrl = null;
        waState.userPhone = sock.user ? sock.user.id.split(':')[0] : 'Connected Dev';
        waState.isDemoMode = false;
        io.emit('wa:status', waState);
        console.log('WhatsApp connected for WebDev Outreach!');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        
        waState.status = 'disconnected';
        waState.qrCodeUrl = null;
        waState.userPhone = null;
        io.emit('wa:status', waState);

        if (isLoggedOut) {
          console.log('Session logged out or device removed. Clearing auth cache...');
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
        } else {
          setTimeout(initWhatsAppSession, 3000);
        }
      }
    });
  } catch (error) {
    console.error('Error starting Baileys WA session:', error.message);
  }
}

// Helpers
function parseSpintax(text) {
  if (!text) return '';
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, choices) => {
    const options = choices.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

function formatPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
}

function personalizeMessage(template, contactRow) {
  let msg = parseSpintax(template);
  Object.keys(contactRow).forEach(key => {
    const regex = new RegExp(`\\{${key}\\}`, 'gi');
    msg = msg.replace(regex, contactRow[key] || '');
  });
  return msg;
}

// REST APIs
app.get('/api/status', (req, res) => {
  res.json({ waState, activeCampaign });
});

app.post('/api/connect-wa', async (req, res) => {
  if (makeWASocket) {
    initWhatsAppSession();
    return res.json({ success: true, message: 'Initializing WhatsApp QR connection...' });
  } else {
    waState.status = 'demo';
    waState.isDemoMode = true;
    io.emit('wa:status', waState);
    return res.json({ success: true, message: 'Switched to Demo Simulation Mode.' });
  }
});

app.post('/api/reset-session', (req, res) => {
  if (sock) {
    try { sock.end(); } catch (e) {}
    sock = null;
  }
  const authDir = path.join(__dirname, 'auth_info_baileys');
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  waState.status = 'disconnected';
  waState.qrCodeUrl = null;
  waState.userPhone = null;
  io.emit('wa:status', waState);

  setTimeout(() => {
    initWhatsAppSession();
  }, 1000);

  res.json({ success: true, message: 'Session reset. Generating fresh QR code...' });
});

app.post('/api/toggle-demo', (req, res) => {
  waState.isDemoMode = req.body.demo !== undefined ? req.body.demo : !waState.isDemoMode;
  if (waState.isDemoMode) {
    waState.status = 'demo';
  } else if (sock) {
    waState.status = 'connected';
  } else {
    waState.status = 'disconnected';
  }
  io.emit('wa:status', waState);
  res.json({ success: true, isDemoMode: waState.isDemoMode });
});

// Upload CSV / Excel Leads
app.post('/api/upload-leads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const contacts = [];

  try {
    if (ext === '.csv') {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          const normalized = {};
          Object.keys(data).forEach(k => normalized[k.trim()] = data[k] ? data[k].trim() : '');

          const phoneKey = Object.keys(normalized).find(k => /phone|mobile|contact|whatsapp/i.test(k)) || Object.keys(normalized)[2] || 'Phone';
          const nameKey = Object.keys(normalized).find(k => /business|company|client|name/i.test(k)) || Object.keys(normalized)[0] || 'BusinessName';

          normalized.FormattedPhone = formatPhoneNumber(normalized[phoneKey]);
          normalized.BusinessName = normalized[nameKey] || 'Valued Business';
          contacts.push(normalized);
        })
        .on('end', () => {
          fs.unlinkSync(filePath);
          res.json({ success: true, count: contacts.length, contacts });
        });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      sheetData.forEach(data => {
        const normalized = {};
        Object.keys(data).forEach(k => normalized[k.trim()] = String(data[k] || '').trim());

        const phoneKey = Object.keys(normalized).find(k => /phone|mobile|contact|whatsapp/i.test(k)) || Object.keys(normalized)[2] || 'Phone';
        const nameKey = Object.keys(normalized).find(k => /business|company|client|name/i.test(k)) || Object.keys(normalized)[0] || 'BusinessName';

        normalized.FormattedPhone = formatPhoneNumber(normalized[phoneKey]);
        normalized.BusinessName = normalized[nameKey] || 'Valued Business';
        contacts.push(normalized);
      });

      fs.unlinkSync(filePath);
      res.json({ success: true, count: contacts.length, contacts });
    } else {
      fs.unlinkSync(filePath);
      res.status(400).json({ error: 'Unsupported file format.' });
    }
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: error.message });
  }
});

// Upload Attachment Media
app.post('/api/upload-media', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media uploaded' });
  const mediaUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    fileName: req.file.originalname,
    filePath: req.file.path,
    mediaUrl
  });
});

// Web Developer Pre-built Cold Outreach Templates
app.get('/api/templates', (req, res) => {
  res.json([
    {
      id: 'new_website_pitch',
      name: '🌐 New Website Pitch (High Conversion)',
      category: 'Cold Lead Pitch',
      template: '{{Hi|Hello|Hey}}!\n\nI noticed *{BusinessName}* in *{City}* doesn\'t have an official modern website yet to capture Google & WhatsApp customers.\n\nWe build modern, fast-loading, mobile-friendly websites for *{Niche}* businesses starting at flat *₹{OfferPrice}*.\n\nIncludes:\n✅ Google Maps SEO & WhatsApp Direct Chat\n✅ Fast Loading & Mobile Responsive\n✅ Free Domain & SSL Certificate\n\nReply *DEMO* and I will send a free sample layout preview for your business!'
    },
    {
      id: 'website_redesign',
      name: '🎨 Website Redesign & Modernization',
      category: 'Redesign Pitch',
      template: '{{Greetings|Hi|Hello}} {ContactName}!\n\nI checked your current website (*{CurrentSite}*). While it has great business potential, it looks a bit outdated and slow on mobile phones.\n\nWe can revamp *{BusinessName}* with a sleek modern dark-theme layout, fast speed, and 2x higher lead conversion.\n\nWould you be open to seeing a free 3D design preview of your new website?'
    },
    {
      id: 'free_mockup_offer',
      name: '🚀 Free Custom UI Design Mockup Offer',
      category: 'Lead Magnet',
      template: 'Hi {ContactName},\n\nHope business is going great at *{BusinessName}*!\n\nI\'m a professional Web Developer specializing in {Niche} websites. To showcase our quality, I\'m designing *3 FREE website homepage mockups* this week.\n\nReply YES if you\'d like a free mockup preview for your business — zero commitment!'
    },
    {
      id: 'ecommerce_store',
      name: '🛒 E-commerce Online Store Setup',
      category: 'E-commerce Pitch',
      template: 'Hello {ContactName},\n\nStart accepting direct WhatsApp orders & online payments for *{BusinessName}*!\n\nWe build automated online store websites with payment gateway integration, product catalogs, and order management.\n\nInterested in boosting your online sales? Reply *STORE* for details!'
    }
  ]);
});

// Campaign Queue
let campaignTimer = null;

app.post('/api/start-campaign', (req, res) => {
  const { campaignName, template, contacts, minDelay = 5, maxDelay = 12, mediaPath } = req.body;

  if (!contacts || !contacts.length) return res.status(400).json({ error: 'Leads list is empty.' });
  if (!template) return res.status(400).json({ error: 'Message template is empty.' });

  activeCampaign = {
    id: `DEV_OUTREACH_${Date.now()}`,
    name: campaignName || 'WebDev Client Acquisition Campaign',
    template,
    contacts,
    minDelay: parseInt(minDelay),
    maxDelay: parseInt(maxDelay),
    mediaPath,
    status: 'running',
    total: contacts.length,
    sent: 0,
    failed: 0,
    remaining: contacts.length,
    startTime: new Date(),
    logs: []
  };

  io.emit('campaign:update', activeCampaign);
  res.json({ success: true, message: 'WebDev Outreach campaign launched!', campaignId: activeCampaign.id });

  processCampaignQueue();
});

app.post('/api/pause-campaign', (req, res) => {
  if (activeCampaign.status === 'running') {
    activeCampaign.status = 'paused';
    if (campaignTimer) clearTimeout(campaignTimer);
    io.emit('campaign:update', activeCampaign);
    res.json({ success: true });
  }
});

app.post('/api/resume-campaign', (req, res) => {
  if (activeCampaign.status === 'paused') {
    activeCampaign.status = 'running';
    io.emit('campaign:update', activeCampaign);
    processCampaignQueue();
    res.json({ success: true });
  }
});

app.post('/api/cancel-campaign', (req, res) => {
  activeCampaign.status = 'cancelled';
  if (campaignTimer) clearTimeout(campaignTimer);
  io.emit('campaign:update', activeCampaign);
  res.json({ success: true });
});

async function processCampaignQueue() {
  if (activeCampaign.status !== 'running') return;

  const currentIndex = activeCampaign.sent + activeCampaign.failed;
  if (currentIndex >= activeCampaign.total) {
    activeCampaign.status = 'completed';
    activeCampaign.endTime = new Date();
    io.emit('campaign:update', activeCampaign);
    io.emit('campaign:completed', activeCampaign);
    return;
  }

  const contact = activeCampaign.contacts[currentIndex];
  const phone = contact.FormattedPhone || formatPhoneNumber(contact.Phone);
  const personalizedText = personalizeMessage(activeCampaign.template, contact);

  let success = false;
  let errorMsg = null;

  if (!waState.isDemoMode && sock && waState.status === 'connected') {
    try {
      const jid = `${phone}@s.whatsapp.net`;
      if (activeCampaign.mediaPath && fs.existsSync(activeCampaign.mediaPath)) {
        await sock.sendMessage(jid, {
          image: { url: activeCampaign.mediaPath },
          caption: personalizedText
        });
      } else {
        await sock.sendMessage(jid, { text: personalizedText });
      }
      success = true;
    } catch (err) {
      success = false;
      errorMsg = err.message || 'WhatsApp message send failed';
    }
  } else {
    await new Promise(r => setTimeout(r, 600));
    success = Math.random() > 0.05;
    if (!success) errorMsg = 'Simulated timeout';
  }

  if (success) activeCampaign.sent++;
  else activeCampaign.failed++;
  activeCampaign.remaining = activeCampaign.total - (activeCampaign.sent + activeCampaign.failed);

  const logEntry = {
    id: Date.now(),
    businessName: contact.BusinessName || contact.ContactName || 'Lead',
    phone,
    timestamp: new Date().toLocaleTimeString(),
    status: success ? 'SENT' : 'FAILED',
    messageSnippet: personalizedText.substring(0, 80) + '...',
    error: errorMsg
  };

  activeCampaign.logs.unshift(logEntry);
  io.emit('campaign:log', logEntry);
  io.emit('campaign:update', activeCampaign);

  const delaySec = Math.floor(Math.random() * (activeCampaign.maxDelay - activeCampaign.minDelay + 1)) + activeCampaign.minDelay;
  
  if (activeCampaign.status === 'running') {
    campaignTimer = setTimeout(processCampaignQueue, delaySec * 1000);
  }
}

io.on('connection', (socket) => {
  socket.emit('wa:status', waState);
  socket.emit('campaign:update', activeCampaign);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 WEB DEVELOPER CLIENT OUTREACH & AUTOMATION HUB`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
