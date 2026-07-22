import mongoose from "mongoose";
import dotenv from "dotenv";
import Lead from "./models/Lead.js";
import connectDB from "./configs/db.js";

dotenv.config();

async function migrate() {
  try {
    await connectDB();
    console.log("Connected to DB via connectDB");

    const leads = await Lead.find({});
    let updatedCount = 0;

    for (let lead of leads) {
      if (Array.isArray(lead.service)) {
        if (lead.service.length > 0) {
          lead.service = lead.service[0];
        } else {
          lead.service = "Grooming"; // default fallback
        }
        await lead.save();
        updatedCount++;
      } else if (!lead.service) {
        lead.service = "Grooming";
        await lead.save();
        updatedCount++;
      }
    }
    
    console.log(`Migration complete. Updated ${updatedCount} leads.`);
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
