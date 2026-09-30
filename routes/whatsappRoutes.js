import express from "express";
import {
  connectClient,
  getStatus,
  logoutClient,
  getQR,
  getConversations,
  getMessages,
  sendMessage,
  toggleAI,
  getGlobalAIStatus,
  toggleGlobalAIChats,
  getKB,
  createKB,
  deleteKB,
  sendAgreementPDF,
} from "../controllers/whatsappController.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadAgreementsDir = path.join(__dirname, "..", "uploads", "agreements");

if (!fs.existsSync(uploadAgreementsDir)) {
  fs.mkdirSync(uploadAgreementsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadAgreementsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `agreement_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed."));
    }
  },
});

const handlePdfUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: "UPLOAD_ERROR",
        message: err.message,
      });
    }
    next();
  });
};

const router = express.Router();

// Session Control
router.post("/connect", connectClient);
router.get("/status", getStatus);
router.post("/logout", logoutClient);
router.get("/qr", getQR);

// Send Agreement PDF via WhatsApp (accepts JSON with pdfUrl or multipart PDF file)
router.post("/send-agreement", handlePdfUpload, sendAgreementPDF);

// Chats and Messages
router.get("/conversations", getConversations);
router.get("/conversation/:leadId", getMessages);
router.post("/message/send", sendMessage);

// AI Automation
router.post("/ai/toggle", toggleAI);
router.get("/ai/global-status", getGlobalAIStatus);
router.post("/ai/global-toggle", toggleGlobalAIChats);

// Knowledge Base Management
router.route("/knowledge-base").get(getKB).post(createKB);

router.route("/knowledge-base/:id").delete(deleteKB);

// Testing Route
import { testAI, getTestAIHistory } from "../controllers/whatsappController.js";
router.post("/test-ai", testAI);
router.get("/test-ai", getTestAIHistory);

export default router;

