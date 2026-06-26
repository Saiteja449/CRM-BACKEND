import { GoogleGenerativeAI } from "@google/generative-ai";
import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import KnowledgeBase from "../models/KnowledgeBase.js";
import AILog from "../models/AILog.js";
import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

export const generateAIResponse = async (leadId, incomingText) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not configured in .env!");
      return "I'll connect you with one of our team members.";
    }
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error(`Lead not found with ID: ${leadId}`);
    }

    const kbItems = await KnowledgeBase.find({ isActive: true });
    const kbContext = kbItems
      .map(
        (item) =>
          `[${item.type.toUpperCase()}] ${item.title}:\n${item.content}`,
      )
      .join("\n\n");

    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(15);

    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));

    const chatHistoryLog = formattedHistory
      .map((h) => `${h.role === "user" ? "Customer" : "AI Agent"}: ${h.text}`)
      .join("\n");

    const agents = await User.find({ role: "sales person" }).select("name");
    const agentList = agents.map((a) => a.name).join(", ");

    const systemPrompt = `You are a highly skilled, friendly, and professional Customer Success Manager for Petsfolio, a premium pet care and services company.
Your goal is to guide customers, answer their questions accurately, and collect necessary information to qualify them as leads.

COMPANY KNOWLEDGE BASE:
${kbContext}

LEAD CONTEXT:
- Name: ${lead.name}
- Phone: ${lead.phone}
- Assigned Representative: ${lead.assignedTo || "Unassigned"}
- Status: ${lead.status || "New"}

CONVERSATION HISTORY:
${chatHistoryLog || "(No prior history)"}

LATEST CUSTOMER MESSAGE: 
"${incomingText}"

YOUR INSTRUCTIONS for generating the "reply":
1. READ THE CONVERSATION HISTORY: Base your response on the context of previous messages. Do not repeat questions you have already asked. 
2. BE NATURAL & HUMAN-LIKE: Keep your response short, conversational, and friendly (like a real human on WhatsApp). Use emojis naturally but sparingly. Do NOT mention you are an AI.
3. BE HELPFUL & ACCURATE: Only use facts from the Company Knowledge Base. If a user asks for prices, services, or locations not listed in the Knowledge Base, reply exactly with: "I'll connect you with one of our team members who can help with that." Do NOT invent or hallucinate information.
4. ASK ONE QUESTION AT A TIME: If you need to qualify the lead (find out their pet type, breed, location, or budget), ask only ONE follow-up question naturally at the end of your message.

YOUR INSTRUCTIONS for automated actions:
5. If the customer is angry, explicitly asks for a human/agent/call, or if you cannot answer their question, set "disableAI" to true.
6. Qualify the lead based on the *entire* conversation history:
   - Identify petType, breed, city, intent, budget, and urgency (High/Medium/Low).
   - Calculate interestScore (0-10) based on their engagement.
7. Categorize tags (e.g. "Hot Lead", "Interested", "Support", "Complaint", "Sales").
8. Generate a one-sentence summary of the conversation history.
9. If the customer asks for a callback, follow-up, or provides a specific time to talk, set "createFollowUp" to true, write notes, and provide "followUpDate" (YYYY-MM-DD). If they request a specific service, suggest updating the status in "updateLeadStatus" (e.g., "Follow Up").

You must respond in JSON format ONLY matching this schema:
{
  "reply": "Polite text reply to send back to the user",
  "qualification": {
    "petType": "Dog or Cat or other",
    "breed": "Breed name if mentioned",
    "city": "City name if mentioned",
    "intent": "Buy / Grooming / Training / Sitting / etc.",
    "budget": "Budget info if mentioned, else empty string",
    "urgency": "High or Medium or Low",
    "interestScore": 8
  },
  "tags": ["Hot Lead", "Sales"],
  "disableAI": false,
  "summary": "Summary of conversation",
  "sentiment": "Positive or Neutral or Negative",
  "probabilityOfConversion": 75,
  "nextAction": "Schedule onboarding call / Wait for human response / etc.",
  "triggerActions": {
    "createFollowUp": false,
    "followUpNotes": "Details of the follow up task",
    "followUpDate": "YYYY-MM-DD",
    "updateLeadStatus": "New or Follow Up or Not Interested or Joined",
    "addNote": "Note to attach to the lead"
  }
}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
    });

    const rawResponse = result.response.text();
    console.log("Gemini Raw JSON Response:", rawResponse);

    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error(
        "Failed to parse Gemini JSON output. Attempting cleanup...",
        parseError,
      );
      parsed = {
        reply: "I'll connect you with one of our team members.",
        disableAI: true,
      };
    }

    await AILog.create({
      leadId,
      prompt: systemPrompt,
      response: rawResponse,
      model: "gemini-2.5-flash",
      tokensUsed: 0, // Free tier / approximate
    });

    const updatePayload = {};

    if (parsed.qualification) {
      const prevQual = lead.aiQualification || {};
      updatePayload.aiQualification = {
        petType: parsed.qualification.petType || prevQual.petType || "",
        breed: parsed.qualification.breed || prevQual.breed || "",
        city: parsed.qualification.city || prevQual.city || "",
        intent: parsed.qualification.intent || prevQual.intent || "",
        budget: parsed.qualification.budget || prevQual.budget || "",
        urgency: parsed.qualification.urgency || prevQual.urgency || "Medium",
        interestScore:
          parsed.qualification.interestScore ?? prevQual.interestScore ?? 0,
      };
    }

    if (parsed.tags && parsed.tags.length > 0) {
      const currentTags = lead.aiTags || [];
      const newTags = new Set([...currentTags, ...parsed.tags]);
      updatePayload.aiTags = Array.from(newTags);
    }

    if (parsed.summary) {
      updatePayload.conversationSummary = parsed.summary;
    }
    if (parsed.sentiment) {
      updatePayload.sentiment = parsed.sentiment;
    }
    if (parsed.probabilityOfConversion) {
      updatePayload.probabilityOfConversion = parsed.probabilityOfConversion;
    }
    if (parsed.nextAction) {
      updatePayload.nextAction = parsed.nextAction;
    }

    if (parsed.disableAI) {
      updatePayload.aiEnabled = false;
      await Notification.create({
        title: "AI Disabled - Human Takeover Needed",
        message: `AI has been disabled for ${lead.name} (${lead.phone}) because they requested human support or the AI reached its limit.`,
        type: "lead_update",
        targetRoles: ["sales manager", "sales person"],
      });
    }

    if (
      parsed.triggerActions?.updateLeadStatus &&
      parsed.triggerActions.updateLeadStatus !== lead.status
    ) {
      updatePayload.status = parsed.triggerActions.updateLeadStatus;
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

    return parsed.reply || "I'll connect you with one of our team members.";
  } catch (error) {
    console.error("Error in AI Service generateAIResponse:", error);
    return "I'll connect you with one of our team members.";
  }
};

export const getReplySuggestions = async (leadId) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return [];

    const lead = await Lead.findById(leadId);
    if (!lead) return [];

    const kbItems = await KnowledgeBase.find({ isActive: true });
    const kbContext = kbItems
      .map(
        (item) =>
          `[${item.type.toUpperCase()}] ${item.title}:\n${item.content}`,
      )
      .join("\n\n");

    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(10);

    const chatHistoryLog = history
      .map(
        (h) =>
          `${h.direction === "incoming" ? "Customer" : "Agent"}: ${h.text}`,
      )
      .join("\n");

    const systemPrompt = `You are a helper backend agent for a human representative managing a pet care lead in the CRM.
Review the knowledge base and the conversation history.
Provide 3 helpful, distinct, and short reply suggestions (less than 20 words each) that the agent can choose to send next.

Company Knowledge Base:
${kbContext}

Lead Context:
- Name: ${lead.name}
- Status: ${lead.status}

Conversation History:
${chatHistoryLog}

You must return a JSON array containing exactly 3 strings:
["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
    });

    const rawResponse = result.response.text();
    return JSON.parse(rawResponse);
  } catch (err) {
    console.error("Failed to generate suggestions:", err);
    return [];
  }
};
