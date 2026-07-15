import dotenv from "dotenv";
import mongoose from "mongoose";
import readline from "readline";

// Setup environment and DB
dotenv.config();

// Mongoose Models needed
import Lead from "./models/Lead.js";
import Message from "./models/Message.js";
import { generateAIResponse } from "./ai/aiService.js";

const connectDB = async () => {
  try {
    const dbUri = process.env.NODE_ENV === "production" ? process.env.MONGODB_URI : process.env.MONGODB_URI_BETA;
    if (!dbUri) {
      console.error("No MongoDB URI found in .env");
      process.exit(1);
    }
    const conn = await mongoose.connect(dbUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function run() {
  await connectDB();
  
  // Create a dummy lead for testing
  let lead = await Lead.findOne({ phone: "0000000000" });
  if (!lead) {
    lead = await Lead.create({
      name: "Test User",
      phone: "0000000000",
      service: "General Inquiry",
      source: "Manual Entry"
    });
    console.log("Created dummy lead:", lead._id);
  } else {
    console.log("Using existing dummy lead:", lead._id);
  }

  // Clear previous test messages
  await Message.deleteMany({ leadId: lead._id });
  // Also reset AI qualification for a fresh test
  await Lead.findByIdAndUpdate(lead._id, {
    aiQualification: {
      petType: "",
      breed: "",
      petAge: "",
      city: "",
      intent: "",
      budget: "",
      specialRequirements: "",
      urgency: "",
      interestScore: 0
    },
    aiEnabled: true,
    disableAI: false
  });
  console.log("Cleared history and AI state for the dummy lead.");

  const askQuestion = () => {
    rl.question('\nYou: ', async (input) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log("Exiting...");
        mongoose.disconnect();
        rl.close();
        return;
      }
      
      try {
        // Save user message to history
        await Message.create({
          messageId: `test-in-${Date.now()}`,
          sender: lead.phone,
          leadId: lead._id,
          text: input,
          direction: "incoming",
          timestamp: new Date()
        });

        console.log("Agent thinking...");
        const response = await generateAIResponse(lead._id, input);
        
        // Save agent message to history
        await Message.create({
          messageId: `test-out-${Date.now()}`,
          sender: "AI Agent",
          leadId: lead._id,
          text: response,
          direction: "outgoing",
          timestamp: new Date()
        });

        console.log(`\nAI: ${response}`);
        
        // Print out current Lead Qualification state for debugging
        const updatedLead = await Lead.findById(lead._id);
        console.log("\n[DEBUG] Current AI Qualification Data:");
        console.log(updatedLead.aiQualification);
        if (!updatedLead.aiEnabled) {
          console.log("[DEBUG] AI has been disabled (completed qualification or user asked for human).");
        }
      } catch (err) {
        console.error("Error generating response:", err);
      }
      
      askQuestion();
    });
  };

  console.log("\n--- AI Agent Test Mode ---");
  console.log("Type 'exit' or 'quit' to stop.\n");
  askQuestion();
}

run();
