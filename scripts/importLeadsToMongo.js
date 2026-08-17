import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Lead from "../models/Lead.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function cleanPhoneNumber(phone) {
  if (!phone) return "";
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, "");

  // If it's an Indian number with 91 prefix (12 digits) or 0 prefix (11 digits), strip it
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.length === 11 && cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  return cleaned;
}

async function importLeads() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error("MONGODB_URI is not defined in .env");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoURI);
    console.log("Connected to MongoDB successfully.");

    const leadsFilePath = path.resolve(__dirname, "../leads_output.json");
    if (!fs.existsSync(leadsFilePath)) {
      console.error(`File not found: ${leadsFilePath}`);
      process.exit(1);
    }

    const rawData = fs.readFileSync(leadsFilePath, "utf-8");
    const leads = JSON.parse(rawData);

    console.log(`Found ${leads.length} leads in JSON file. Starting import...`);

    let insertedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (const leadData of leads) {
      try {
        const cleanedPhone = cleanPhoneNumber(leadData.phone);

        if (!cleanedPhone || cleanedPhone.length < 7) {
          console.log(
            `Skipping lead ${leadData.name} due to invalid phone: ${leadData.phone}`,
          );
          errorCount++;
          continue;
        }

        leadData.phone = cleanedPhone;

        // Check for existing lead by phone number
        const existingLead = await Lead.findOne({ phone: cleanedPhone });

        if (existingLead) {
          duplicateCount++;
        } else {
          leadData.joinedAt = new Date();
          const newLead = new Lead(leadData);
          await newLead.save();
          insertedCount++;
        }
      } catch (err) {
        console.error(`Error inserting lead ${leadData.name}:`, err.message);
        errorCount++;
      }
    }

    console.log("\n--- Import Summary ---");
    console.log(`Total Leads Processed: ${leads.length}`);
    console.log(`Successfully Inserted: ${insertedCount}`);
    console.log(`Skipped (Duplicates):  ${duplicateCount}`);
    console.log(`Skipped (Errors):      ${errorCount}`);
  } catch (error) {
    console.error("Database connection error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

importLeads();
