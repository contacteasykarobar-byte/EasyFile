 import express from "express";
import pkg from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = pkg;

const app = express();
app.use(express.json());

const sessions = {};

// ================= SESSION START =================
async function startSession(userId) {
  const sessionPath = path.join(__dirname, "sessions", userId);

  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);


  const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  browser: ["Chrome", "Chrome", "110.0.0"],
  syncFullHistory: false,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: false,
  connectTimeoutMs: 60000,
  defaultQueryTimeoutMs: 0
});
  

  sessions[userId] = {
    sock,
    qr: null,
    connected: false
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      sessions[userId].qr = await QRCode.toDataURL(qr);
      console.log("QR generated for:", userId);
    }

    if (connection === "open") {
      sessions[userId].connected = true;
      console.log("Connected:", userId);
    }

    if (connection === "close") {
      sessions[userId].connected = false;

      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason !== DisconnectReason.loggedOut) {
        console.log("Reconnecting:", userId);
        startSession(userId);
      }
    }
  });
}

// ================= START =================
app.get("/start/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!sessions[userId]) {
    await startSession(userId);
  }

  setTimeout(() => {
    res.json({
      connected: sessions[userId]?.connected || false,
      qr: sessions[userId]?.qr || null
    });
  }, 2000);
});

// ================= STATUS =================
app.get("/status/:userId", (req, res) => {
  const { userId } = req.params;

  res.json({
    connected: sessions[userId]?.connected || false
  });
});

// ================= SEND MESSAGE =================
app.post("/send-message", async (req, res) => {
  try {
    const { userId, number, message } = req.body;

    if (!sessions[userId]?.connected) {
      return res.json({ error: "Not connected" });
    }

    await sessions[userId].sock.sendMessage(
      number + "@s.whatsapp.net",
      { text: message }
    );

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ error: "Send failed" });
  }
});

// ================= SEND PDF =================
app.post("/send-pdf", async (req, res) => {
  try {
    const { userId, number, fileUrl,filename,message} = req.body;

    if (!sessions[userId]?.connected) {
      return res.json({ error: "Not connected" });
    }

    await sessions[userId].sock.sendMessage(
      number + "@s.whatsapp.net",
      {
        document: { url: fileUrl },
        mimetype: "application/pdf",
        fileName: filename,
        caption:message
      }
    );

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ error: "PDF failed" });
  }
});


// ================= QR PAGE =================
app.get("/qr/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!sessions[userId]) {
    await startSession(userId);
  }

  let attempts = 0;

  const interval = setInterval(() => {
    const session = sessions[userId];

    // QR mil gaya
    if (session?.qr) {
      clearInterval(interval);

      return res.send(`
        <html>
          <head>
            <title>Scan QR</title>
          </head>
          <body style="text-align:center;font-family:sans-serif">
            <h2>Scan WhatsApp QR (${userId})</h2>
            <img src="${session.qr}" />
            <p>Open WhatsApp → Linked Devices → Scan</p>
          </body>
        </html>
      `);
    }

    // Already connected
    if (session?.connected) {
      clearInterval(interval);

      return res.send(`
        <html>
          <body style="text-align:center;font-family:sans-serif">
            <h2>✅ Connected (${userId})</h2>
          </body>
        </html>
      `);
    }

    attempts++;

    if (attempts > 15) {
      clearInterval(interval);
      return res.send("QR load failed, refresh page");
    }

  }, 1000);
});



app.get("/logout/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Step 1: Try WhatsApp logout (ignore error)
    if (sessions[userId]) {
      try {
        await sessions[userId].sock.logout();
      } catch (e) {
        console.log("⚠️ Already logged out from WhatsApp");
      }

      delete sessions[userId];
    }

    // Step 2: ALWAYS delete session folder
    const sessionPath = path.join(__dirname, "sessions", userId);

    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log("🗑️ Session folder deleted:", userId);
    }

    res.json({
      success: true,
      message: "Session destroyed (safe)"
    });

  } catch (err) {
    console.error(err);

    res.json({
      success: false,
      message: "Logout partially failed but cleaned"
    });
  }
});




// ================= SERVER =================
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});