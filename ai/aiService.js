import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import AILog from "../models/AILog.js";
import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

// Initialize Qdrant Vector Store Lazily
let qdrantVectorStore = null;

const initVectorStore = async () => {
  if (qdrantVectorStore) return qdrantVectorStore;

  try {
    const qdrantUrl = process.env.CLUSTER_ENDPOINT;
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
      console.warn(
        "QDRANT_URL or QDRANT_API_KEY not found in .env. RAG context will be empty.",
      );
      return null;
    }

    const client = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-embedding-2",
    });

    qdrantVectorStore = new QdrantVectorStore(embeddings, {
      client,
      collectionName: "petsfolio_kb",
    });

    return qdrantVectorStore;
  } catch (e) {
    console.warn("Qdrant Vector store initialization failed:", e.message);
    return null;
  }
};

// Define Structured Output Schema
const qualificationSchema = z.object({
  reply: z
    .string()
    .describe(
      "Your reply text to the user. Provide comprehensive answers and guide the user naturally without forcing unnecessary questions.",
    ),
  qualification: z.object({
    petType: z
      .string()
      .default("")
      .describe(
        "Type of pet (e.g., Dog, Cat). Return empty string if not mentioned in the current input.",
      ),
    breed: z
      .string()
      .default("")
      .describe(
        "Breed of the pet. Return empty string if not mentioned in the current input.",
      ),
    petAge: z
      .string()
      .default("")
      .describe(
        "Age of the pet. Return empty string if not mentioned in the current input.",
      ),
    city: z
      .string()
      .default("")
      .describe(
        "City of the user. Return empty string if not mentioned in the current input.",
      ),
    intent: z
      .string()
      .default("")
      .describe(
        "Service user is interested in (Training, Grooming, Walking, Pet Sitting, Pet Insurance). Return empty string if not mentioned in the current input.",
      ),
    specialRequirements: z
      .string()
      .default("")
      .describe(
        "Health issues, allergies, etc. 'None' if specified none, empty string if not mentioned.",
      ),
    urgency: z
      .string()
      .default("Medium")
      .describe("High, Medium, or Low urgency based on context."),
    interestScore: z
      .number()
      .default(5)
      .describe("1 to 10 interest score based on engagement."),
  }).default({}),
  tags: z
    .array(z.string())
    .default([])
    .describe("Relevant tags (e.g., 'Hot Lead', 'Interested')."),
  disableAI: z
    .boolean()
    .default(false)
    .describe(
      "Set to true if user asks for human or if all 5 required details are collected.",
    ),
  summary: z
    .string()
    .default("")
    .describe("One sentence summary of the conversation so far."),
  sentiment: z
    .string()
    .default("Neutral")
    .describe("Positive, Neutral, or Negative."),
  probabilityOfConversion: z
    .number()
    .default(50)
    .describe("0 to 100 estimated probability."),
  nextAction: z.string().default("").describe("Next step for the sales team."),
  triggerActions: z
    .object({
      createFollowUp: z
        .boolean()
        .default(false)
        .describe("Set true if user asked for a callback."),
      followUpNotes: z.string().default("").describe("Notes for the callback."),
      followUpDate: z
        .string()
        .default("")
        .describe("Date string for follow up if requested."),
      addNote: z
        .string()
        .default("")
        .describe("Any specific notes for the CRM lead record."),
    })
    .default({
      createFollowUp: false,
      followUpNotes: "",
      followUpDate: "",
      addNote: "",
    }),
});

export const generateAIResponse = async (leadId, incomingText) => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      console.error(
        "GEMINI_API_KEY is not defined in the environment variables.",
      );
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error(`Lead not found with ID: ${leadId}`);
    }

    // Auto-assign representative if currently Unassigned or not set
    let assignedRep = lead.assignedTo;
    if (!assignedRep || assignedRep === "Unassigned") {
      const representatives = await User.find({ role: "sales person" }).sort({
        _id: 1,
      });
      if (representatives && representatives.length > 0) {
        let state = await AssignmentState.findOne({ key: "leadAssignment" });
        if (!state) {
          state = await AssignmentState.create({
            key: "leadAssignment",
            lastAssignedIndex: -1,
          });
        }
        let nextIndex = state.lastAssignedIndex + 1;
        if (nextIndex >= representatives.length) nextIndex = 0;

        assignedRep = representatives[nextIndex].name;
        state.lastAssignedIndex = nextIndex;
        await state.save();

        lead.assignedTo = assignedRep;
        await lead.save();

        // Create Lead Notification
        const assignedAgent = await User.findOne({ name: assignedRep });
        const targetUsers = assignedAgent ? [assignedAgent._id] : [];
        await Notification.create({
          title: "Lead Assigned by AI",
          message: `Lead ${lead.name} has been assigned to ${assignedRep}.`,
          type: "lead_update",
          targetRoles: ["sales manager"],
          targetUsers: targetUsers,
        });
      } else {
        assignedRep = "Our team";
      }
    }

    // RAG Context Retrieval from Qdrant
    const vs = await initVectorStore();
    let ragContext = "";
    if (vs) {
      const results = await vs.similaritySearch(incomingText, 10);
      ragContext = results.map((r) => r.pageContent).join("\n\n");
    }

    // History
    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(4);
    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));
    const chatHistoryLog = formattedHistory
      .map((h) => `${h.role === "user" ? "Customer" : "AI Agent"}: ${h.text}`)
      .join("\n");

    const lastAgentMessage = [...formattedHistory]
      .reverse()
      .find((h) => h.role === "model");
    const lastAgentMessageText = lastAgentMessage
      ? lastAgentMessage.text
      : "(none — this is the first message to this lead)";

    const systemPrompt = `You are Petsfolio's AI assistant.

KNOWLEDGE BASE:
${ragContext}

LEAD CONTEXT:
Name: ${lead.name} | Phone: ${lead.phone} | Rep: ${assignedRep}
Already Collected:
- Service (intent): ${lead.aiQualification?.intent || "Missing"}
- City: ${lead.aiQualification?.city || "Missing"}
- Pet Type: ${lead.aiQualification?.petType || "Missing"}

HISTORY:
${chatHistoryLog || "(None)"}

LAST AGENT MSG: "${lastAgentMessageText}"
USER MSG: "${incomingText}"

CRITICAL RULES:
1. TONE & GREETING: Act as a friendly, helpful assistant. If this is the first message (HISTORY is (None)), warmly welcome the user to Petsfolio and greet them before assisting.
2. CONCISE ANSWERS: When the user asks for information about a service, provide the relevant details found in the Knowledge Base about that service, but keep your response strictly under 350 words. Be concise and do not overwhelm the user with too much information at once.
3. GUIDANCE: After providing the information, direct the user to download and use the Petsfolio Client Application to book their service. Do NOT ask them if they are ready to book here or try to schedule it manually.
4. NO FORCED QUALIFICATION: Do NOT ask the user for 'Pet Type', 'City', or any other missing data fields purely to collect data. Your goal is simply to assist them with their inquiries.
5. PASSIVE EXTRACTION: Even though you won't ask for it, if the user naturally mentions their 'Pet Type', 'City', 'Intent', etc., you MUST extract that info into the corresponding JSON fields so it can be saved.
6. RESTRICTIONS: NEVER ask for Pet Name, Gender, Address, Dates/Times, Packages, Payment, Phone, Email, or OTP.
7. SHARING LINKS: If the user asks for the app or if he mentions about booking a service, application, or website link, you MUST share the direct URLs exactly as provided in the Knowledge Base. You are fully authorized to share links.
8. COMPLETION & HUMAN HANDOFF: If the user explicitly asks to speak with a human or if you cannot answer their question, let them know that ${assignedRep} will contact them shortly and set disableAI=true.
9. OUTPUT: Respond purely via the structured JSON schema.
10. FORMATTING: You are chatting on WhatsApp. Use WhatsApp markdown (*bold* for emphasis). NO HTML tags. Keep sentences short.`;

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      console.warn(
        "OPENROUTER_API_KEY is not defined in the environment variables.",
      );
      return "I'm currently unable to assist because the AI configuration is missing. Please contact support.";
    }

    const model = new ChatOpenAI({
      modelName: "openrouter/auto",
      temperature: 0,
      apiKey: openRouterApiKey,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
      },
    });

    const modelWithStructure = model.withStructuredOutput(qualificationSchema);

    console.log("Generating RAG response with Gemini...");
    const parsed = await modelWithStructure.invoke([
      ["system", systemPrompt],
      ["user", incomingText],
    ]);

    await AILog.create({
      leadId,
      prompt: systemPrompt + "\n\nUser Message: " + incomingText,
      response: JSON.stringify(parsed, null, 2),
      model: "openrouter/auto (OpenRouter + Qdrant)",
      tokensUsed: 0,
    });

    const updatePayload = {};

    if (parsed.qualification) {
      const aiData = parsed.qualification || {};
      const prevQual = lead.aiQualification || {};

      updatePayload.lastMessage = incomingText;
      updatePayload.lastActivity = new Date();
      updatePayload.aiQualification = {
        petType: aiData.petType || prevQual.petType || "",
        breed: aiData.breed || prevQual.breed || "",
        petAge: aiData.petAge || prevQual.petAge || "",
        city: aiData.city || prevQual.city || "",
        intent: aiData.intent || prevQual.intent || "",
        specialRequirements:
          aiData.specialRequirements || prevQual.specialRequirements || "",
        urgency: aiData.urgency || prevQual.urgency || "Medium",
        interestScore: aiData.interestScore ?? prevQual.interestScore ?? 0,
      };

      const resolvedIntent = aiData.intent || prevQual.intent;
      if (resolvedIntent) updatePayload.service = resolvedIntent;

      const resolvedCity = aiData.city || prevQual.city;
      if (resolvedCity) updatePayload.city = resolvedCity;
    }

    if (parsed.tags && parsed.tags.length > 0) {
      const currentTags = lead.aiTags || [];
      const newTags = new Set([...currentTags, ...parsed.tags]);
      updatePayload.aiTags = Array.from(newTags);
    }

    if (parsed.summary) updatePayload.conversationSummary = parsed.summary;
    if (parsed.sentiment) updatePayload.sentiment = parsed.sentiment;
    if (parsed.probabilityOfConversion)
      updatePayload.probabilityOfConversion = parsed.probabilityOfConversion;
    if (parsed.nextAction) updatePayload.nextAction = parsed.nextAction;

    if (parsed.disableAI) {
      updatePayload.aiEnabled = false;
      await Notification.create({
        title: "AI Disabled - Human Takeover Needed",
        message: `AI has been disabled for ${lead.name} (${lead.phone}) because they requested human support or the AI reached its limit.`,
        type: "lead_update",
        targetRoles: ["sales manager", "sales person"],
      });
    }

    await Lead.findByIdAndUpdate(leadId, updatePayload);

    if (
      parsed.triggerActions?.createFollowUp &&
      parsed.triggerActions?.followUpDate
    ) {
      const existingFollowUp = await Followup.findOne({
        leadId,
        date: parsed.triggerActions.followUpDate,
      });

      if (!existingFollowUp) {
        await Followup.create({
          leadId,
          leadName: lead.name,
          type: "WhatsApp",
          date: parsed.triggerActions.followUpDate,
          time: "10:00 AM",
          priority:
            parsed.qualification?.urgency === "High" ? "High" : "Medium",
          notes:
            parsed.triggerActions.followUpNotes ||
            "Follow-up scheduled by AI Agent",
          author: "AI Agent",
        });

        await Notification.create({
          title: "Followup Created by AI",
          message: `AI Agent created a follow-up task for lead ${lead.name} on ${parsed.triggerActions.followUpDate}.`,
          type: "lead_update",
          targetRoles: ["sales manager", "sales person"],
        });
      }
    }

    if (parsed.triggerActions?.addNote) {
      await Lead.findByIdAndUpdate(leadId, {
        $set: {
          notes:
            (lead.notes || "") +
            "\n\n[AI Note]: " +
            parsed.triggerActions.addNote,
        },
      });
    }

    return (
      parsed.reply ||
      "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly."
    );
  } catch (error) {
    console.error("Error in AI Service generateAIResponse:", error);
    return "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
  }
};
