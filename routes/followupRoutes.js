import express from "express";
import { getFollowups, createFollowup, updateFollowup } from "../controllers/followupController.js";

const router = express.Router();

router.route("/").get(getFollowups).post(createFollowup);
router.route("/:id").put(updateFollowup);

export default router;
