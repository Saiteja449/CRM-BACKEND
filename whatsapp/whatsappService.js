import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mime from "mime-types";

import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import WhatsAppSession from "../models/WhatsAppSession.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";
import Notification from "../models/Notification.js";

import { getIO } from "../socket/socket.js";
import { generateAIResponse } from "../ai/aiService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

let sock = null;
let connectionStatus = "disconnected";
let activeQR = "";
export const normalizePhone = (jid) => {
  if (!jid) return "";
  const clean = jid.split("@")[0];
  return clean.replace(/\D/g, "");
};
const updateSessionStatus = async (status, qr = "", phone = "", name = "") => {
  connectionStatus = status;
  activeQR = qr;

  try {
    let session = await WhatsAppSession.findOne();
    if (!session) {
      session = new WhatsAppSession();
    }
    session.status = status;
    session.qrCode = qr;
    if (phone) session.connectedPhone = phone;
    if (name) session.connectedName = name;
    await session.save();

    const io = getIO();
    if (io) {
      io.emit("whatsapp_status", {
        status,
        qrCode: qr,
        connectedPhone: phone || session.connectedPhone,
        connectedName: name || session.connectedName,
      });
    }
  } catch (err) {
    console.error("Failed to update WhatsAppSession in DB:", err);
  }
};
export const connectWhatsApp = async () => {
  try {
    const authFolder = path.join(__dirname, "..", "whatsapp_auth_info");
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    console.log("Initializing WhatsApp connection via Baileys...");
    updateSessionStatus("connecting");

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: "silent" }),
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(
        "Baileys connection.update event:",
        JSON.stringify({
          connection,
          qr: qr ? "[QR data present]" : undefined,
          lastDisconnect: lastDisconnect?.error?.message,
        }),
      );

      if (qr) {
        console.log("New WhatsApp QR code generated. Please scan.");
        updateSessionStatus("qr", qr);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`WhatsApp connection closed. Status code: ${statusCode}`);

        const shouldReconnect = statusCode !== 401;
        if (shouldReconnect) {
          console.log("Attempting to reconnect WhatsApp...");
          setTimeout(() => connectWhatsApp(), 3000);
        } else {
          console.log(
            "WhatsApp session logged out. Cleaning up credentials...",
          );
          logoutWhatsApp();
        }
      } else if (connection === "open") {
        const userJid = sock?.user?.id || "";
        const phone = normalizePhone(userJid);
        const name = sock?.user?.name || "WhatsApp Business Agent";

        console.log(
          `WhatsApp is fully connected. Active on: ${phone} (${name})`,
        );
        updateSessionStatus("connected", "", phone, name);
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
      try {
        console.log("=== messages.upsert event received ===");
        console.log("Event type:", m.type);
        console.log("Number of messages:", m.messages?.length);

        const messages = m.messages || [];
        const eventType = m.type;

        for (const msg of messages) {
          console.log("Message key:", JSON.stringify(msg.key));
          console.log("Message fromMe:", msg.key.fromMe);
          console.log("Message type:", Object.keys(msg.message || {}));
          console.log("Push name:", msg.pushName);

          if (!msg.key.fromMe && eventType === "notify") {
            console.log(
              `Processing incoming message from: ${msg.key.remoteJid}`,
            );
            await handleIncomingMessage(msg);
          } else {
            console.log(
              `Skipping message - fromMe: ${msg.key.fromMe}, type: ${eventType}`,
            );
          }
        }
      } catch (err) {
        console.error("Error in messages.upsert handler:", err);
      }
    });
  } catch (error) {
    console.error("Fatal error during WhatsApp initialization:", error);
    updateSessionStatus("disconnected");
  }
};

export const logoutWhatsApp = async () => {
  const authFolder = path.join(__dirname, "..", "whatsapp_auth_info");

  if (sock) {
    try {
      await sock.logout();
    } catch (e) {
      // Socket might be already closed
    }
    sock = null;
  }

  // Delete credentials folder
  if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
  }

  console.log("WhatsApp session terminated and auth files removed.");
  updateSessionStatus("disconnected", "", "", "");
};

const handleIncomingMessage = async (msg) => {
  try {
    const remoteJid = msg.key.remoteJid;
    const remoteJidAlt = msg.key.remoteJidAlt;

    const isIndividualChat =
      (remoteJid && remoteJid.endsWith("@s.whatsapp.net")) ||
      (remoteJid && remoteJid.endsWith("@lid"));

    if (!isIndividualChat) {
      console.log(`Skipping non-individual chat: ${remoteJid}`);
      return;
    }

    const phoneJid = remoteJidAlt || remoteJid;
    const phone = normalizePhone(phoneJid);
    const messageId = msg.key.id;
    const timestamp = new Date(
      (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
    );
    const pushName = msg.pushName || "WhatsApp User";

    console.log(
      `Processing message - Phone: ${phone}, Name: ${pushName}, JID: ${remoteJid}, AltJID: ${remoteJidAlt || "none"}`,
    );

    let messageType = "text";
    let textContent = "";
    let mediaUrl = "";

    const msgContent = msg.message;
    if (!msgContent) return;

    if (msgContent.conversation) {
      messageType = "text";
      textContent = msgContent.conversation || "";
    } else if (msgContent.extendedTextMessage) {
      messageType = "text";
      textContent = msgContent.extendedTextMessage.text || "";
    } else if (msgContent.imageMessage) {
      messageType = "image";
      textContent = msgContent.imageMessage.caption || "";
      mediaUrl = await downloadAndSaveMedia(msg, "image");
    } else if (msgContent.audioMessage) {
      messageType = "audio";
      textContent = "Voice message";
      mediaUrl = await downloadAndSaveMedia(msg, "audio");
    } else if (msgContent.documentMessage) {
      messageType = "document";
      textContent = msgContent.documentMessage.title || "Document";
      mediaUrl = await downloadAndSaveMedia(msg, "document");
    } else if (msgContent.locationMessage) {
      messageType = "location";
      const loc = msgContent.locationMessage;
      textContent = `Location Shared - Lat: ${loc.degreesLatitude}, Lng: ${loc.degreesLongitude}`;
    } else if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
      messageType = "contact";
      const contact = msgContent.contactMessage;
      textContent = `Contact Shared - Name: ${contact?.displayName || "Unknown"}`;
    } else {
      messageType = "text";
      textContent = "Unsupported message type";
    }

    textContent = textContent || "";
    console.log(
      `[DEBUG] Extracted content: ${messageType} - "${textContent.substring(0, 30)}..."`,
    );

    console.log(`[DEBUG] Finding lead in DB for phone: ${phone}`);
    let lead = await Lead.findOne({
      $or: [{ phone: phone }, { phone: new RegExp(phone.slice(-10) + "$") }],
    });

    let isNewLead = false;

    if (!lead) {
      console.log(`[DEBUG] Lead not found, creating new lead for ${pushName}`);
      isNewLead = true;
      lead = new Lead({
        name: pushName,
        phone: phone,
        source: "WhatsApp",
        service: "General Enquiry", // Satisfies MongoDB required field
        status: "New",
        joinedAt: new Date(),
        notes: `Discovered via WhatsApp message: "${textContent.substring(0, 100)}"`,
      });

      // Round-robin assignment logic for sales agents
      console.log(`[DEBUG] Assigning lead via round-robin...`);
      const representatives = await User.find({ role: "sales person" }).sort({
        _id: 1,
      });
      if (representatives && representatives.length > 0) {
        let state = await AssignmentState.findOne({ key: "leadAssignment" });
        if (!state) {
          state = await AssignmentState.create({
            key: "leadAssignment",
            lastAssignedIndex: -1,
          });
        }

        let nextIndex = state.lastAssignedIndex + 1;
        if (nextIndex >= representatives.length) {
          nextIndex = 0;
        }

        lead.assignedTo = representatives[nextIndex].name;
        state.lastAssignedIndex = nextIndex;
        await state.save();
      }

      await lead.save();

      // Create Lead Notification
      const assignedAgent = await User.findOne({ name: lead.assignedTo });
      const targetUsers = assignedAgent ? [assignedAgent._id] : [];
      await Notification.create({
        title: "New WhatsApp Lead Capture",
        message: `New WhatsApp lead captured from ${lead.name} (${lead.phone}) and assigned to ${lead.assignedTo}.`,
        type: "new_lead",
        targetRoles: ["sales manager"],
        targetUsers: targetUsers,
      });
    } else {
      // Update existing lead timestamps and latest message
      await Lead.findByIdAndUpdate(lead._id, {
        $set: { lastMessage: textContent, lastActivity: timestamp },
      });
    }

    // 3. Create message record
    const messageRecord = await Message.create({
      messageId,
      leadId: lead._id,
      sender: phone,
      direction: "incoming",
      messageType,
      text: textContent,
      mediaUrl,
      timestamp,
      aiGenerated: false,
      delivered: true,
      read: false,
      status: "received",
    });

    // 4. Update Conversation session meta
    let conversation = await Conversation.findOne({ leadId: lead._id });
    if (!conversation) {
      conversation = new Conversation({
        leadId: lead._id,
      });
    }
    conversation.unreadCount += 1;
    conversation.lastMessage = textContent;
    conversation.lastMessageTime = timestamp;
    await conversation.save();

    // 5. Broadcast message to frontend clients
    const io = getIO();
    if (io) {
      // Broadcast to room
      io.to(lead._id.toString()).emit("new_message", messageRecord);
      // General conversation list update broadcast
      io.emit("conversation_updated", {
        leadId: lead._id,
        unreadCount: conversation.unreadCount,
        lastMessage: textContent,
        lastMessageTime: timestamp,
        isNewLead,
        lead,
      });
    }

    console.log(
      `[DEBUG] Successfully processed and broadcasted message to lead ID: ${lead._id}`,
    );

    // 6. Asynchronously trigger AI agent response
    if (lead.aiEnabled) {
      console.log(`[DEBUG] Queueing AI auto-reply for lead ID: ${lead._id}`);
      // Push to sequential processing queue
      aiMessageQueue.push({ lead, remoteJid, incomingText: textContent });
      processNextInQueue();
    }
  } catch (error) {
    console.error("Error processing incoming WhatsApp message:", error);
  }
};

/**
 * Handle Downloading and storing media messages locally.
 */
const downloadAndSaveMedia = async (msg, type) => {
  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: pino({ level: "silent" }) },
    );

    const msgContent = msg.message;
    const mediaMsg =
      msgContent.imageMessage ||
      msgContent.audioMessage ||
      msgContent.documentMessage;
    const mimeType = mediaMsg?.mimetype || "application/octet-stream";
    const ext = mime.extension(mimeType) || "bin";

    const fileName = `media_${msg.key.id}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadDir, fileName);

    fs.writeFileSync(filePath, buffer);
    console.log(`Media message downloaded and saved to: ${filePath}`);

    return `/uploads/${fileName}`;
  } catch (err) {
    console.error("Error downloading media attachment:", err);
    return "";
  }
};

// AI Message Queue for sequential processing
const aiMessageQueue = [];
let isProcessingQueue = false;

const processNextInQueue = async () => {
  if (isProcessingQueue || aiMessageQueue.length === 0) return;
  isProcessingQueue = true;

  while (aiMessageQueue.length > 0) {
    const { lead, remoteJid, incomingText } = aiMessageQueue.shift();
    await processAIResponse(lead, remoteJid, incomingText);
  }

  isProcessingQueue = false;
};

/**
 * Asynchronous worker to trigger the Gemini AI response generation and push back.
 */
const processAIResponse = async (lead, remoteJid, incomingText) => {
  try {
    // Wait 2 seconds before responding
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Emit typing status over socket.io
    const io = getIO();
    if (io) {
      io.to(lead._id.toString()).emit("typing_status", {
        leadId: lead._id,
        isTyping: true,
      });
    }

    // Call Gemini Agent
    const replyText = await generateAIResponse(lead._id, incomingText);

    // Send the reply message using Baileys
    if (sock) {
      const sendResult = await sock.sendMessage(remoteJid, { text: replyText });

      const outgoingId = sendResult.key.id;
      const outboundTimestamp = new Date();

      // Save outgoing message to DB
      const replyRecord = await Message.create({
        messageId: outgoingId,
        leadId: lead._id,
        sender: "system",
        direction: "outgoing",
        messageType: "text",
        text: replyText,
        timestamp: outboundTimestamp,
        aiGenerated: true,
        delivered: true,
        read: false,
        status: "sent",
      });

      // Update Conversation meta
      await Conversation.findOneAndUpdate(
        { leadId: lead._id },
        {
          lastMessage: replyText,
          lastMessageTime: outboundTimestamp,
        },
      );

      // Emit new outbound message over Socket
      if (io) {
        io.to(lead._id.toString()).emit("new_message", replyRecord);
        io.emit("conversation_updated", {
          leadId: lead._id,
          lastMessage: replyText,
          lastMessageTime: outboundTimestamp,
        });
      }
    }

    // Turn off typing indicator
    if (io) {
      io.to(lead._id.toString()).emit("typing_status", {
        leadId: lead._id,
        isTyping: false,
      });
    }
  } catch (err) {
    console.error("Failed to generate/send AI response:", err);
    const io = getIO();
    if (io) {
      io.to(lead._id.toString()).emit("typing_status", {
        leadId: lead._id,
        isTyping: false,
      });
    }
  }
};

/**
 * Expose function to dispatch manual messages from the CRM UI.
 */
export const sendMessageFromCRM = async (
  leadId,
  messageText,
  senderName = "Agent",
) => {
  if (!sock) {
    throw new Error("WhatsApp client is not connected!");
  }

  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new Error("Lead not found!");
  }

  // Format destination jid
  const targetJid = `${lead.phone}@s.whatsapp.net`;

  const sendResult = await sock.sendMessage(targetJid, { text: messageText });
  const messageId = sendResult.key.id;
  const timestamp = new Date();

  // Create message record
  const messageRecord = await Message.create({
    messageId,
    leadId: lead._id,
    sender: "agent",
    senderName,
    direction: "outgoing",
    messageType: "text",
    text: messageText,
    timestamp,
    aiGenerated: false,
    delivered: true,
    read: false,
    status: "sent",
  });

  // Update Conversation details
  await Conversation.findOneAndUpdate(
    { leadId: lead._id },
    {
      lastMessage: messageText,
      lastMessageTime: timestamp,
      unreadCount: 0, // Reset since agent is chatting active
    },
  );

  // Emit socket updates
  const io = getIO();
  if (io) {
    io.to(lead._id.toString()).emit("new_message", messageRecord);
    io.emit("conversation_updated", {
      leadId: lead._id,
      unreadCount: 0,
      lastMessage: messageText,
      lastMessageTime: timestamp,
    });
  }

  return messageRecord;
};

/**
 * Expose connection status getter
 */
export const getWhatsAppStatus = () => {
  return {
    status: connectionStatus,
    qrCode: activeQR,
  };
};
