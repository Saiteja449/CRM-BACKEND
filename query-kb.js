import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./configs/db.js";
import KnowledgeBase from "./models/KnowledgeBase.js";

dotenv.config();

connectDB().then(async () => {
  try {
    const kbs = await KnowledgeBase.find({ content: { $regex: /login|mobile|otp/i } });
    console.log(JSON.stringify(kbs, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});
