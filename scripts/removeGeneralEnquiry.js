import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configs/db.js";
import Lead from "../models/Lead.js";

// Setup dotenv path resolution for flexibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config(); // fallback

const isDryRun = process.argv.includes("--dry-run") || process.argv.includes("-d");

export const removeGeneralEnquiry = async ({ dryRun = isDryRun } = {}) => {
  try {
    console.log("==================================================");
    console.log(" Starting General Enquiry Services Cleanup Script ");
    console.log(` Mode: ${dryRun ? "DRY RUN (No changes will be saved)" : "LIVE EXECUTION"}`);
    console.log("==================================================");

    await connectDB();

    // Directly query only leads that contain "General Enquiry" AND have 2 or more services in the array
    const leads = await Lead.find({
      services: { $regex: /^general\s*enquiry$/i },
      "services.1": { $exists: true }, // Ensures array has at least 2 elements (index 1 exists)
    });

    console.log(`Matching leads found in DB: ${leads.length}`);

    const leadsToUpdate = [];

    for (const lead of leads) {
      if (Array.isArray(lead.services) && lead.services.length >= 2) {
        const hasGeneralEnquiry = lead.services.some(
          (service) =>
            typeof service === "string" &&
            service.trim().toLowerCase() === "general enquiry"
        );

        if (hasGeneralEnquiry) {
          const updatedServices = lead.services.filter(
            (service) =>
              typeof service === "string" &&
              service.trim().toLowerCase() !== "general enquiry"
          );

          leadsToUpdate.push({
            leadId: lead._id,
            name: lead.name,
            phone: lead.phone,
            oldServices: lead.services,
            newServices: updatedServices,
          });
        }
      }
    }

    console.log(`\nFound ${leadsToUpdate.length} lead(s) with 2+ services containing 'General Enquiry'.\n`);

    if (leadsToUpdate.length === 0) {
      console.log("No leads need updating.");
      await mongoose.connection.close();
      process.exit(0);
    }

    let updatedCount = 0;

    for (const item of leadsToUpdate) {
      console.log(`Lead ID: ${item.leadId} | Name: ${item.name || "N/A"} (${item.phone})`);
      console.log(`  Before: [ ${item.oldServices.join(", ")} ]`);
      console.log(`  After:  [ ${item.newServices.join(", ")} ]`);

      if (!dryRun) {
        await Lead.updateOne(
          { _id: item.leadId },
          { $set: { services: item.newServices } }
        );
        updatedCount++;
      }
      console.log("--------------------------------------------------");
    }

    if (dryRun) {
      console.log(`\n[DRY RUN SUMMARY] ${leadsToUpdate.length} lead(s) would be updated.`);
      console.log("To apply changes, run the script without --dry-run (e.g., node scripts/removeGeneralEnquiry.js).");
    } else {
      console.log(`\n[SUCCESS] Successfully updated ${updatedCount} lead(s).`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Error executing cleanup script:", error);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  }
};

// Run automatically when executed directly via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  removeGeneralEnquiry();
}
