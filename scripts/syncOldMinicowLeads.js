import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configs/db.js";
import Lead from "../models/Lead.js";
import { syncToMinicow } from "../utils/minicowSync.js";

dotenv.config({ path: "../.env" });

const syncOldLeads = async () => {
  try {
    await connectDB();
    console.log("Connected to DB, starting sync for Minicow...");

    // Find leads with "Cow Services" that haven't been synced yet
    const leads = await Lead.find({ 
      services: "Cow Services",
      syncedToMinicow: { $ne: true }
    });

    console.log(`Found ${leads.length} old Cow Services leads to sync.`);

    let syncedCount = 0;
    for (const lead of leads) {
      // The helper function will handle the axios call and updating the syncedToMinicow flag
      await syncToMinicow(lead);
      syncedCount++;
    }

    console.log(`Successfully triggered sync for ${syncedCount} leads.`);
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  }
};

syncOldLeads();
