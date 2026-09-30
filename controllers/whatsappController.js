import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import KnowledgeBase from "../models/KnowledgeBase.js";
import WhatsAppSession from "../models/WhatsAppSession.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  connectWhatsApp,
  logoutWhatsApp,
  getWhatsAppStatus,
  sendMessageFromCRM,
  sendPDFAgreement,
  isAIChatDisabled,
  setAIChatDisabled,
} from "../whatsapp/whatsappService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Connect WhatsApp (starts Baileys client initialization)
// @route   POST /api/whatsapp/connect
// @access  Public
export const connectClient = async (req, res) => {
  try {
    const { sessionId } = req.body;
    connectWhatsApp(sessionId);
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
    const memoryStatuses = getWhatsAppStatus(); // Now returns an array
    const dbSessions = await WhatsAppSession.find();

    const result = memoryStatuses.map((mem) => {
      const db = dbSessions.find(s => s.sessionId === mem.sessionId);
      const status = mem.status || db?.status || "disconnected";
      return {
        sessionId: mem.sessionId,
        status: status,
        qrCode: status === "qr" ? (mem.qrCode || db?.qrCode || "") : "",
        connectedPhone: mem.connectedPhone || db?.connectedPhone || "",
        connectedName: mem.connectedName || db?.connectedName || "",
      };
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Disconnect WhatsApp and delete credentials
// @route   POST /api/whatsapp/logout
// @access  Public
export const logoutClient = async (req, res) => {
  try {
    const { sessionId } = req.body;
    await logoutWhatsApp(sessionId);
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

// @desc    Test AI Response without WhatsApp
// @route   POST /api/whatsapp/test-ai
// @access  Public
export const testAI = async (req, res) => {
  try {
    const { message, leadId, reset } = req.body;
    
    if (!message && !reset) {
      return res.status(400).json({ message: "message is required." });
    }

    let lead;
    if (leadId) {
      lead = await Lead.findById(leadId);
    } else {
      // Find or create dummy lead
      lead = await Lead.findOne({ phone: "0000000000" });
      if (!lead) {
        lead = await Lead.create({
          name: "Test User",
          phone: "0000000000",
          services: ["General Enquiry"],
          source: "Manual Entry",
        });
      }
    }

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (reset) {
      await Message.deleteMany({ leadId: lead._id });
      await Lead.findByIdAndUpdate(lead._id, {
        aiQualification: {
          petType: "",
          breed: "",
          petAge: "",
          city: "",
          intent: "",
          budget: "",
          specialRequirements: "",
          urgency: "",
          interestScore: 0
        },
        aiEnabled: true,
        disableAI: false
      });
      return res.status(200).json({ message: "Test lead reset successfully." });
    }

    const { generateAIResponse } = await import("../ai/aiService.js");

    // Save incoming
    const incoming = await Message.create({
      messageId: `test-in-${Date.now()}`,
      sender: lead.phone,
      leadId: lead._id,
      text: message,
      direction: "incoming",
      timestamp: new Date()
    });

    const aiResponseText = await generateAIResponse(lead._id, message);

    // Save outgoing
    const outgoing = await Message.create({
      messageId: `test-out-${Date.now()}`,
      sender: "AI Agent",
      leadId: lead._id,
      text: aiResponseText,
      direction: "outgoing",
      timestamp: new Date()
    });

    const updatedLead = await Lead.findById(lead._id);

    res.status(200).json({
      incoming,
      outgoing,
      aiQualification: updatedLead.aiQualification,
      leadId: lead._id
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getTestAIHistory = async (req, res) => {
  try {
    let lead = await Lead.findOne({ phone: "0000000000" });
    if (!lead) {
      lead = await Lead.create({
        name: "Test User",
        phone: "0000000000",
        services: ["General Enquiry"],
        source: "Manual Entry",
      });
    }

    const messages = await Message.find({ leadId: lead._id }).sort({ timestamp: 1 });
    
    res.status(200).json({
      leadId: lead._id,
      aiQualification: lead.aiQualification,
      messages: messages.map(m => ({
        text: m.text,
        role: m.direction === "incoming" ? "user" : "ai"
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get global AI chat status (auto-reply vs silent extraction)
// @route   GET /api/whatsapp/ai/global-status
// @access  Public
export const getGlobalAIStatus = (req, res) => {
  const disabled = isAIChatDisabled();
  res.status(200).json({
    disableAIChats: disabled,
    mode: disabled ? "extraction_only" : "full_auto_reply",
    message: disabled
      ? "AI chat replies are currently disabled. Incoming lead data is extracted and stored silently."
      : "AI chat replies are currently enabled.",
  });
};

// @desc    Toggle global AI chat responses
// @route   POST /api/whatsapp/ai/global-toggle
// @access  Public
export const toggleGlobalAIChats = (req, res) => {
  const { disableAIChats } = req.body;
  if (disableAIChats !== undefined) {
    setAIChatDisabled(Boolean(disableAIChats));
  } else {
    setAIChatDisabled(!isAIChatDisabled());
  }

  const currentStatus = isAIChatDisabled();
  res.status(200).json({
    message: `Global AI chat replies ${currentStatus ? "disabled (Silent Extraction Only)" : "enabled"}`,
    disableAIChats: currentStatus,
    mode: currentStatus ? "extraction_only" : "full_auto_reply",
  });
};

// @desc    Send PDF agreement via WhatsApp to a new lead (even if never messaged before)
// @route   POST /api/whatsapp/send-agreement
// @access  Public
export const sendAgreementPDF = async (req, res) => {
  try {
    const {
      number,
      phone,
      document,
      pdfUrl,
      text,
      caption,
      name,
      fileName,
      service,
      senderName,
      sessionId,
      leadId,
    } = req.body;

    // Primary fields: number and document (with fallback to phone and pdfUrl)
    const targetPhone = number || phone;
    const targetPdfUrl = document || pdfUrl;

    const accompanyingText = (
      text ||
      caption ||
      "Dear Customer, please find attached your Petsfolio Service Agreement. Kindly review and let us know if you have any questions. Thank you!"
    ).trim();

    // 1. Identify or create the lead
    let lead = null;
    let resolvedPhone = targetPhone;

    if (leadId) {
      lead = await Lead.findById(leadId);
      if (lead) {
        resolvedPhone = lead.phone;
      }
    }

    if (!resolvedPhone) {
      return res.status(400).json({
        success: false,
        error: "MISSING_NUMBER",
        message: "The 'number' field is required.",
      });
    }

    // Normalize phone number
    let cleanPhone = resolvedPhone.toString().replace(/\D/g, "");
    if (cleanPhone.length === 10) {
      cleanPhone = "91" + cleanPhone;
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) {
      cleanPhone = "91" + cleanPhone.slice(1);
    }

    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        error: "INVALID_PHONE",
        message: "A valid phone number with at least 10 digits is required.",
      });
    }

    // If lead is not found by ID, look up or create in DB
    // If lead is not found by ID, look up or create in DB
    if (!lead) {
      lead = await Lead.findOne({
        $or: [
          { phone: cleanPhone },
          { phone: cleanPhone.startsWith("91") ? cleanPhone.slice(2) : cleanPhone },
          { phone: resolvedPhone },
        ],
      });

      if (!lead) {
        lead = await Lead.create({
          name: name ? name.trim() : "Valued Customer",
          phone: cleanPhone,
          source: "WhatsApp Outreach",
          services: service ? [service] : ["General Enquiry"],
          status: "New",
        });
      }
    }

    // 2. Resolve PDF buffer & mediaUrl
    let pdfBuffer = null;
    let mediaUrl = "";
    let resolvedFileName = fileName || "Petsfolio_Agreement.pdf";

    // Case A: Multipart file uploaded
    if (req.file) {
      if (
        req.file.mimetype !== "application/pdf" &&
        !req.file.originalname.toLowerCase().endsWith(".pdf")
      ) {
        return res.status(400).json({
          success: false,
          error: "INVALID_DOCUMENT_TYPE",
          message: "Only PDF documents are allowed.",
        });
      }

      pdfBuffer = fs.readFileSync(req.file.path);
      mediaUrl = `/uploads/agreements/${req.file.filename}`;
      if (!fileName) {
        resolvedFileName = req.file.originalname;
      }
    }
    // Case B: PDF URL from other website
    else if (targetPdfUrl) {
      try {
        const downloadRes = await axios.get(targetPdfUrl, {
          responseType: "arraybuffer",
          timeout: 45000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PetsfolioCRM/1.0",
            Accept: "application/pdf,*/*",
          },
        });

        pdfBuffer = Buffer.from(downloadRes.data);

        // Verify PDF magic bytes '%PDF-'
        const isPdf =
          pdfBuffer.slice(0, 5).toString() === "%PDF-" ||
          downloadRes.headers["content-type"]?.includes("pdf") ||
          targetPdfUrl.toLowerCase().split("?")[0].endsWith(".pdf");

        if (!isPdf) {
          return res.status(400).json({
            success: false,
            error: "INVALID_PDF",
            message: "The provided 'document' does not point to a valid PDF document.",
          });
        }

        // Save local copy to uploads/agreements for CRM archiving
        const agreementDir = path.join(__dirname, "..", "uploads", "agreements");
        if (!fs.existsSync(agreementDir)) {
          fs.mkdirSync(agreementDir, { recursive: true });
        }
        const savedName = `agreement_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`;
        const savedPath = path.join(agreementDir, savedName);
        fs.writeFileSync(savedPath, pdfBuffer);
        mediaUrl = `/uploads/agreements/${savedName}`;

        if (!fileName) {
          try {
            const urlPath = new URL(targetPdfUrl).pathname;
            const extractedName = path.basename(urlPath);
            if (extractedName && extractedName.toLowerCase().endsWith(".pdf")) {
              resolvedFileName = decodeURIComponent(extractedName);
            }
          } catch (e) {}
        }
      } catch (dlErr) {
        return res.status(400).json({
          success: false,
          error: "PDF_FETCH_FAILED",
          message: `Failed to download PDF from provided document URL (${targetPdfUrl}): ${dlErr.message}`,
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: "MISSING_DOCUMENT",
        message: "Please provide 'document' (PDF URL) or upload a PDF file.",
      });
    }

    // 3. Dispatch via WhatsApp Baileys
    const result = await sendPDFAgreement({
      lead,
      phone: cleanPhone,
      pdfBuffer,
      fileName: resolvedFileName,
      text: accompanyingText,
      mediaUrl,
      senderName: senderName || "Petsfolio Sales",
      sessionId,
    });

    return res.status(200).json({
      success: true,
      message: "Agreement PDF sent successfully via WhatsApp.",
      data: {
        messageId: result.messageId,
        leadId: lead._id,
        leadName: lead.name,
        phone: cleanPhone,
        whatsappJid: result.targetJid,
        fileName: result.safeFileName,
        mediaUrl: mediaUrl,
        caption: accompanyingText,
        sentAt: result.timestamp,
      },
    });
  } catch (error) {
    console.error("sendAgreementPDF error:", error);

    if (error.code === "NOT_ON_WHATSAPP" || error.message.includes("not registered on WhatsApp")) {
      return res.status(400).json({
        success: false,
        error: "NOT_ON_WHATSAPP",
        phone: error.phone || undefined,
        message: error.message,
      });
    }

    if (error.message.includes("WhatsApp client is not connected")) {
      return res.status(400).json({
        success: false,
        error: "WHATSAPP_DISCONNECTED",
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: "DISPATCH_FAILED",
      message: error.message || "Failed to send agreement via WhatsApp.",
    });
  }
};





