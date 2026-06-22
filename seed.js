import mongoose from "mongoose";
import dotenv from "dotenv";
import Lead from "./models/Lead.js";
import Followup from "./models/Followup.js";

dotenv.config();

const dbURI = process.env.MONGODB_URI || "mongodb://localhost:27017/crm";

const seedData = async () => {
  try {
    await mongoose.connect(dbURI);
    console.log("Connected to MongoDB for cleaning old seed data...");

    // Remove old dummy leads
    const oldLeads = await Lead.find({
      notes: "Automatically generated dummy lead.",
    });
    const oldLeadIds = oldLeads.map((l) => l._id);
    await Lead.deleteMany({ _id: { $in: oldLeadIds } });
    await Followup.deleteMany({ leadId: { $in: oldLeadIds } });

    console.log("Cleaned old dummy leads. Seeding new leads via API...");

    const sources = [
      "Email",
      "WhatsApp",
      "Meta Ads",
      "Website Form",
      "Call",
      "Manual Entry",
    ];
    const services = [
      "Grooming",
      "Training",
      "Walking",
      "Pet Sitting",
      "Pet Insurance",
    ];
    const firstNames = [
      "Alice",
      "Bob",
      "Charlie",
      "Diana",
      "Eve",
      "Frank",
      "Grace",
      "Heidi",
      "Ivan",
      "Judy",
      "Mallory",
      "Niaj",
      "Olivia",
      "Peggy",
      "Sybil",
      "Trent",
      "Victor",
      "Walter",
      "Zoe",
      "Arthur",
    ];
    const lastNames = [
      "Smith",
      "Johnson",
      "Williams",
      "Brown",
      "Jones",
      "Garcia",
      "Miller",
      "Davis",
      "Rodriguez",
      "Martinez",
    ];

    for (let i = 0; i < 20; i++) {
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

      const leadData = {
        name: `${firstName} ${lastName}`,
        phone: `+1 555-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        source: sources[Math.floor(Math.random() * sources.length)],
        service: services[Math.floor(Math.random() * services.length)],
        status: "New",
        assignedTo: "Unassigned", // Will trigger round robin in the API
        notes: "Automatically generated dummy lead.",
      };

      const res = await fetch("http://localhost:5000/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadData),
      });

      if (!res.ok) {
        console.error("Failed to insert lead:", await res.text());
      }
    }

    console.log("20 dummy leads inserted successfully.");
    process.exit();
  } catch (err) {
    console.error("Error seeding database:", err);
    process.exit(1);
  }
};

seedData();
