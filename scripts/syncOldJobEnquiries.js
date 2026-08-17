import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configs/db.js";
import Lead from "../models/Lead.js";
import { syncToJobs } from "../utils/jobsSync.js";

dotenv.config({ path: "../.env" });

const syncOldJobEnquiries = async () => {
  try {
    await connectDB();
    console.log("Connected to DB, starting sync for Jobs...");

    // Find leads with "Job Inquiry" that haven't been synced yet
    const leads = await Lead.find({ 
      services: "Job Inquiry",
      syncedToJobs: { $ne: true }
    });

    console.log(`Found ${leads.length} old Job Inquiry leads to sync.`);

    let syncedCount = 0;
    for (const lead of leads) {
      // The helper function will handle the axios call and updating the syncedToJobs flag
      await syncToJobs(lead);
      syncedCount++;
    }

    console.log(`Successfully triggered sync for ${syncedCount} leads.`);
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  }
};

syncOldJobEnquiries();
