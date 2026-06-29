import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import KnowledgeBase from "../models/KnowledgeBase.js";
import WhatsAppSession from "../models/WhatsAppSession.js";
import {
  connectWhatsApp,
  logoutWhatsApp,
  getWhatsAppStatus,
  sendMessageFromCRM,
} from "../whatsapp/whatsappService.js";
// @desc    Connect WhatsApp (starts Baileys client initialization)
// @route   POST /api/whatsapp/connect
// @access  Public
export const connectClient = async (req, res) => {
  try {
    connectWhatsApp();
    res.status(200).json({ message: "WhatsApp connection worker started." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get WhatsApp connection status
// @route   GET /api/whatsapp/status
// @access  Public
export const getStatus = async (req, res) => {
  try {
    // First try in-memory status
    const memoryStatus = getWhatsAppStatus();

    // Also check database for persisted state (handles page refresh after connect)
    const dbSession = await WhatsAppSession.findOne();

    const status = dbSession?.status || memoryStatus.status;
    const qrCode = memoryStatus.qrCode || dbSession?.qrCode || "";
    const connectedPhone = dbSession?.connectedPhone || "";
    const connectedName = dbSession?.connectedName || "";

    res.status(200).json({
      status,
      qrCode,
      connectedPhone,
      connectedName,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Disconnect WhatsApp and delete credentials
// @route   POST /api/whatsapp/logout
// @access  Public
export const logoutClient = async (req, res) => {
  try {
    await logoutWhatsApp();
    res
      .status(200)
      .json({ message: "WhatsApp disconnected and logged out successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get current active QR code image string
// @route   GET /api/whatsapp/qr
// @access  Public
export const getQR = async (req, res) => {
  try {
    const statusData = getWhatsAppStatus();
    res.status(200).json({ qrCode: statusData.qrCode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all WhatsApp conversations
// @route   GET /api/whatsapp/conversations
// @access  Public
export const getConversations = async (req, res) => {
  try {
    const { role, name } = req.query;

    const populateOptions = { path: "leadId" };

    if (role === "Sales Representative" && name) {
      populateOptions.match = {
        assignedTo: { $regex: new RegExp("^" + name + "$", "i") },
      };
    }

    let conversations = await Conversation.find()
      .populate(populateOptions)
      .sort({ lastMessageTime: -1 });

    // Filter out conversations where leadId is null (due to population match failure)
    if (role === "Sales Representative" && name) {
      conversations = conversations.filter((c) => c.leadId != null);
    }

    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get messages for a specific lead
// @route   GET /api/whatsapp/conversation/:leadId
// @access  Public
export const getMessages = async (req, res) => {
  try {
    const { leadId } = req.params;
    if (!leadId) {
      return res.status(400).json({ message: "leadId is required." });
    }

    // Reset unread count for this conversation since the agent is loading it
    await Conversation.findOneAndUpdate({ leadId }, { unreadCount: 0 });

    const messages = await Message.find({ leadId }).sort({ timestamp: 1 });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send manual WhatsApp message
// @route   POST /api/whatsapp/message/send
// @access  Public
export const sendMessage = async (req, res) => {
  try {
    const { leadId, text, senderName } = req.body;
    if (!leadId || !text) {
      return res
        .status(400)
        .json({ message: "leadId and text are required fields." });
    }

    const messageRecord = await sendMessageFromCRM(leadId, text, senderName);
    res.status(200).json(messageRecord);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle AI status for a lead
// @route   POST /api/whatsapp/ai/toggle
// @access  Public
export const toggleAI = async (req, res) => {
  try {
    const { leadId, aiEnabled } = req.body;
    if (leadId === undefined || aiEnabled === undefined) {
      return res
        .status(400)
        .json({ message: "leadId and aiEnabled are required fields." });
    }

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      { aiEnabled },
      { new: true },
    );

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res
      .status(200)
      .json({
        message: `AI response state set to ${aiEnabled} for ${lead.name}`,
        lead,
      });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Knowledge Base items
// @route   GET /api/whatsapp/knowledge-base
// @access  Public
export const getKB = async (req, res) => {
  try {
    const items = await KnowledgeBase.find().sort({ createdAt: -1 });
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create Knowledge Base item
// @route   POST /api/whatsapp/knowledge-base
// @access  Public
export const createKB = async (req, res) => {
  try {
    const { title, content, type } = req.body;
    if (!title || !content || !type) {
      return res
        .status(400)
        .json({ message: "title, content, and type are required." });
    }

    const item = await KnowledgeBase.create({ title, content, type });
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete Knowledge Base item
// @route   DELETE /api/whatsapp/knowledge-base/:id
// @access  Public
export const deleteKB = async (req, res) => {
  try {
    const { id } = req.params;
    await KnowledgeBase.findByIdAndDelete(id);
    res
      .status(200)
      .json({ message: "Knowledge base item deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Upload media file
// @route   POST /api/whatsapp/upload
// @access  Public
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const uploadMedia = async (req, res) => {
  try {
    const { fileName, base64Data } = req.body;
    if (!fileName || !base64Data) {
      return res
        .status(400)
        .json({ message: "fileName and base64Data are required." });
    }

    const buffer = Buffer.from(base64Data, "base64");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const uploadsDir = path.join(__dirname, "..", "uploads");

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const uniqueFileName = `upload_${Date.now()}_${fileName}`;
    const filePath = path.join(uploadsDir, uniqueFileName);

    fs.writeFileSync(filePath, buffer);
    const url = `/uploads/${uniqueFileName}`;

    res.status(200).json({ url });
  } catch (error) {
    console.error("Upload failed:", error);
    res.status(500).json({ message: error.message });
  }
};
