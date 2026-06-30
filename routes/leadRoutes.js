import express from "express";
import {
  getLeads,
  getPaginatedLeads,
  createLead,
  updateLead,
  deleteLead,
  updateStatusByWebhook,
} from "../controllers/leadController.js";

const router = express.Router();

router.route("/").get(getLeads).post(createLead);
router.route("/paginated").get(getPaginatedLeads);

router.post("/webhook/status", updateStatusByWebhook);

router.route("/:id").put(updateLead).delete(deleteLead);

export default router;
