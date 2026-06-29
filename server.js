import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./configs/db.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import websiteRoutes from "./routes/websiteRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import metaRoutes from "./routes/metaRoutes.js";
import followupRoutes from "./routes/followupRoutes.js";

// Socket & WhatsApp Imports
import { initSocket } from "./socket/socket.js";
import { connectWhatsApp } from "./whatsapp/whatsappService.js";

dotenv.config();

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Get dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow all origins
      callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/website", websiteRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/followups", followupRoutes);

// Base route
app.get("/", (req, res) => {
  res.send("API is running...");
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Auto-connect WhatsApp on server start to resume session
  connectWhatsApp();
});
