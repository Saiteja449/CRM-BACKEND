import { GoogleGenerativeAI } from "@google/generative-ai";
import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import KnowledgeBase from "../models/KnowledgeBase.js";
import AILog from "../models/AILog.js";
import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

export const generateAIResponse = async (leadId, incomingText) => {
  try {
    const groqApiKey = process.env.GROQ_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!groqApiKey && !geminiApiKey) {
      console.error(
        "Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in .env!",
      );
      return "I'll connect you with one of our team members.";
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
        if (nextIndex >= representatives.length) {
          nextIndex = 0;
        }
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

    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(15);

    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));

    // The last question the agent asked, so the model has zero ambiguity
    // about whether it's about to repeat itself.
    const lastAgentMessage = [...formattedHistory]
      .reverse()
      .find((h) => h.role === "model");
    const lastAgentMessageText = lastAgentMessage ? lastAgentMessage.text : "";

    const systemPrompt = `You are the Petsfolio Intake Assistant. Represent Petsfolio as a team and never introduce yourself with a personal name.

Your job is to collect the information required to register a customer's service request.

Supported Services:
- Training (Dog)
- Grooming (Dog, Cat)
- Walking (Dog)
- Pet Sitting (Dog)
- Pet Insurance (Dog, Cat)

Supported pets: Dog and Cat only.

Rules:
1. Extract any Service, Pet Type, Breed, Age, City or Health Issues from the customer's latest message before asking anything.
2. Never ask for information already collected.
3. Ask exactly ONE missing field at a time in this order:
Service → Pet Type → Breed → Pet Age → City → Health Issues.
4. Never repeat the same question. Rephrase if needed.
5. Keep replies short, professional and task-focused.
6. Never introduce yourself, never ask how the customer is doing, and never mention you're an AI.
7. If pricing is requested, reply: "I'll connect you with our team—they'll share the best options and pricing 😊" then continue collecting details.
8. Only reject these combinations:
   - Training + Cat
   - Walking + Cat
   - Pet Sitting + Cat
   Reply that only Grooming and Pet Insurance are available for cats and clear the intent.
9. If an unsupported animal is mentioned, explain that Petsfolio currently serves only Dogs and Cats.
10. If the customer requests a human, callback, becomes angry, or the conversation is unrelated to Petsfolio services, set disableAI=true.
11. Once all required fields are collected, thank the customer, mention the assigned representative, set disableAI=true and ask no more questions.
12. Return ONLY valid JSON matching the required schema.

Required Schema:
{
  "reply": "Your response to the customer",
  "qualification": {
    "intent": "",
    "petType": "",
    "breed": "",
    "petAge": "",
    "city": "",
    "specialRequirements": ""
  },
  "disableAI": false
}`;

    const userPayload = JSON.stringify({
      lead: {
        name: lead.name,
        phone: lead.phone,
        assignedRepresentative: assignedRep,
        status: lead.status || "New",
      },
      qualification: {
        intent: lead.aiQualification?.intent || "",
        petType: lead.aiQualification?.petType || "",
        breed: lead.aiQualification?.breed || "",
        petAge: lead.aiQualification?.petAge || "",
        city: lead.aiQualification?.city || "",
        specialRequirements: lead.aiQualification?.specialRequirements || "",
      },
      lastQuestion: lastAgentMessageText,
      history: formattedHistory,
      message: incomingText,
    });

    let rawResponse = "";
    let tokensUsed = 0;
    let modelNameUsed = "";
    let success = false;
    let parsed = null;

    const fallbackModels = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-prompt-guard-2-22m",
    ];

    if (geminiApiKey) {
      try {
        modelNameUsed = "gemini-2.5-flash-lite";
        console.log(`Attempting Gemini call with model: ${modelNameUsed}...`);
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: modelNameUsed,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: systemPrompt + "\n\nUser Input: " + userPayload },
              ],
            },
          ],
        });
        const content = result.response.text();
        try {
          parsed = JSON.parse(content);
          rawResponse = content;
          tokensUsed = 0;
          success = true;
          console.log("Gemini call succeeded and returned valid JSON!");
        } catch (jsonErr) {
          console.warn(`Gemini returned invalid JSON: ${content}`);
        }
      } catch (geminiErr) {
        console.error("Gemini API call failed:", geminiErr);
      }
    }

    if (!success && groqApiKey && groqApiKey !== "your_groq_api_key_here") {
      for (const model of fallbackModels) {
        try {
          modelNameUsed = model;
          console.log(
            `Attempting Groq fallback call with model: ${modelNameUsed}...`,
          );
          const response = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${groqApiKey}`,
              },
              body: JSON.stringify({
                model: modelNameUsed,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPayload },
                ],
                response_format: { type: "json_object" },
              }),
            },
          );

          if (response.ok) {
            const resJson = await response.json();
            const content = resJson.choices[0].message.content;
            try {
              parsed = JSON.parse(content);
              rawResponse = content;
              tokensUsed = resJson.usage?.total_tokens || 0;
              success = true;
              console.log(
                `Groq fallback call succeeded with model: ${modelNameUsed} and returned valid JSON.`,
              );
              break;
            } catch (jsonErr) {
              console.warn(
                `Groq model ${modelNameUsed} returned invalid JSON: ${content}. Trying next model...`,
              );
            }
          } else {
            const errText = await response.text();
            console.warn(
              `Groq model ${modelNameUsed} failed (status ${response.status}): ${errText}`,
            );
          }
        } catch (groqErr) {
          console.warn(`Groq model ${modelNameUsed} threw error:`, groqErr);
        }
      }
    }

    if (!success) {
      console.error(
        "All AI models (Groq and Gemini) failed to generate response.",
      );
      return "I'll connect you with one of our team members.";
    }

    console.log("AI Raw JSON Response:", rawResponse);

    if (!parsed) {
      parsed = {
        reply: "I'll connect you with one of our team members.",
        disableAI: true,
      };
    }

    await AILog.create({
      leadId,
      prompt: systemPrompt + "\n\nUser Payload: " + userPayload,
      response: rawResponse,
      model: modelNameUsed,
      tokensUsed: tokensUsed,
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

      // Also update the top-level Lead fields from AI qualification
      const resolvedIntent = aiData.intent || prevQual.intent;
      if (resolvedIntent) {
        updatePayload.service = resolvedIntent;
      }
      const resolvedCity = aiData.city || prevQual.city;
      if (resolvedCity) {
        updatePayload.city = resolvedCity;
      }
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

    // Note: The AI chatbot is not authorized to update the lead status. Status should remain unchanged until human updates it.

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
