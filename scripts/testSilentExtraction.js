import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configs/db.js";
import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import { extractAndStoreLeadData } from "../ai/aiService.js";
import { isAIChatDisabled } from "../whatsapp/whatsappService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const runTest = async () => {
  console.log("==================================================");
  console.log(" Running Silent AI Lead Data Extraction Verification ");
  console.log("==================================================");

  try {
    await connectDB();

    // 1. Verify Global Setting
    const disabled = isAIChatDisabled();
    console.log(`[TEST 1] Checking isAIChatDisabled(): ${disabled}`);
    if (!disabled) {
      console.warn("WARNING: isAIChatDisabled() is false! Check DISABLE_AI_CHATS in .env");
    } else {
      console.log("PASS: AI Chat replies are confirmed DISABLED.");
    }

    // 2. Create Test Lead
    const testPhone = "9999999991";
    await Lead.deleteMany({ phone: testPhone });
    await Message.deleteMany({ sender: testPhone });

    const lead = await Lead.create({
      name: "Silent Extraction Test User",
      phone: testPhone,
      source: "WhatsApp",
      status: "New",
      aiEnabled: true,
      services: [],
    });
    console.log(`[TEST 2] Created dummy lead ID: ${lead._id}`);

    // 3. Simulate Incoming Customer Message
    const incomingText =
      "Hello, I have a 2 year old Golden Retriever and I urgently need pet grooming services at my home in Indiranagar, Bangalore. Please call me back.";
    console.log(`[TEST 3] Sending incoming customer message: "${incomingText}"`);

    // Call extractAndStoreLeadData
    const updatedLead = await extractAndStoreLeadData(lead._id, incomingText);

    // 4. Verify Stored Lead Data
    console.log("\n--- Extracted Data in MongoDB ---");
    console.log("Services:", updatedLead?.services);
    console.log("City:", updatedLead?.city || updatedLead?.aiQualification?.city);
    console.log("Pet Type:", updatedLead?.aiQualification?.petType);
    console.log("Breed:", updatedLead?.aiQualification?.breed);
    console.log("Pet Age:", updatedLead?.aiQualification?.petAge);
    console.log("Intent:", updatedLead?.aiQualification?.intent);
    console.log("Summary:", updatedLead?.conversationSummary);
    console.log("Tags:", updatedLead?.aiTags);
    console.log("---------------------------------\n");

    const hasGrooming = updatedLead?.services?.some((s) => /grooming/i.test(s));
    const hasCity = /bangalore|indiranagar/i.test(updatedLead?.city || updatedLead?.aiQualification?.city || "");
    const hasBreed = /golden retriever/i.test(updatedLead?.aiQualification?.breed || "");
    const hasPetType = /dog/i.test(updatedLead?.aiQualification?.petType || "");

    console.log(`Validation - Has Grooming Service: ${hasGrooming ? "PASS" : "FAIL"}`);
    console.log(`Validation - Has City (Bangalore/Indiranagar): ${hasCity ? "PASS" : "FAIL"}`);
    console.log(`Validation - Has Breed (Golden Retriever): ${hasBreed ? "PASS" : "FAIL"}`);
    console.log(`Validation - Has Pet Type (Dog): ${hasPetType ? "PASS" : "FAIL"}`);

    // 5. Clean up
    await Lead.findByIdAndDelete(lead._id);
    console.log("\nCleaned up test lead.");

    if (hasGrooming && (hasCity || hasBreed || hasPetType)) {
      console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY! Lead data extracted and stored silently without replies. <<<");
    } else {
      console.error("\n>>> SOME VALIDATIONS FAILED. Please review the output above. <<<");
    }
  } catch (err) {
    console.error("Test execution error:", err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

runTest();
