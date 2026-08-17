import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configs/db.js";
import Lead from "../models/Lead.js";

dotenv.config();

const migrate = async () => {
  try {
    await connectDB();
    console.log("Connected to DB, starting migration...");

    // Find leads where service is a string and services is missing or empty
    const leads = await Lead.find({ service: { $exists: true, $ne: null } });

    console.log(`Found ${leads.length} leads with 'service' field.`);

    let migratedCount = 0;
    for (const lead of leads) {
      if (!lead.services || lead.services.length === 0) {
        if (lead.service) {
          lead.services = [lead.service];
          await lead.save();
          migratedCount++;
        }
      }
    }

    console.log(`Successfully migrated ${migratedCount} leads.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
};

migrate();
