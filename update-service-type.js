import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./configs/db.js";
import Lead from "./models/Lead.js";

dotenv.config();

const updateServiceType = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB.");

    const result = await Lead.updateMany(
      { service: "General Inquiry" },
      { $set: { service: "General Enquiry" } },
    );

    console.log(
      `Updated ${result.modifiedCount} leads from 'General Inquiry' to 'General Enquiry'.`,
    );
  } catch (error) {
    console.error("Error updating leads:", error);
  } finally {
    mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
};

updateServiceType();
