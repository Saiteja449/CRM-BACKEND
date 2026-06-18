import express from "express";
import {
  verifyWebhook,
  receiveWebhook,
} from "../controllers/whatsappController.js";

const router = express.Router();

router.route("/webhook").get(verifyWebhook).post(receiveWebhook);

export default router;
