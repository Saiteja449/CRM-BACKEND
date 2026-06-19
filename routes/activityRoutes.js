import express from "express";
import { getActivities, createActivity } from "../controllers/activityController.js";

const router = express.Router();

router.route("/").get(getActivities).post(createActivity);

export default router;
