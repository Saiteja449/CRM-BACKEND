import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./configs/db.js";
import Lead from "./models/Lead.js";

dotenv.config();

connectDB().then(async () => {
  try {
    const res = await Lead.updateMany(
      {
        service: {
          $nin: [
            "Grooming",
            "Training",
            "Walking",
            "Pet Sitting",
            "Pet Insurance",
            "General Enquiry",
          ],
        },
      },
      { $set: { service: "Walking" } },
    );
    console.log("Cleaned up invalid services:", res);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});
