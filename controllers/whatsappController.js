import Lead from "../models/Lead.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

export const verifyWebhook = (req, res) => {
  const verify_token =
    process.env.WHATSAPP_VERIFY_TOKEN || "petsfolio_whatsapp_token";

  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WHATSAPP WEBHOOK VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).send("Invalid request");
  }
};

export const receiveWebhook = async (req, res) => {
  try {
    let body = req.body;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        let from = body.entry[0].changes[0].value.messages[0].from;

        const existingLead = await Lead.findOne({ phone: from });
        if (existingLead) {
          return res
            .status(400)
            .json({ message: "A lead with this phone number already exists." });
        }

        let msg_body = body.entry[0].changes[0].value.messages[0].text.body;
        let contact_name =
          body.entry[0].changes[0].value.contacts?.[0]?.profile?.name ||
          "WhatsApp User";

        let service = "General Inquiry";
        const requirementMatch = msg_body.match(/requirement of\s+(.+)/i);
        if (requirementMatch && requirementMatch[1]) {
          service = requirementMatch[1].trim();
        }

        const leadData = {
          name: contact_name,
          phone: from,
          email: "",
          service: service,
          notes: msg_body,
          source: "WhatsApp",
          status: "New",
          assignedTo: "Unassigned",
          joinedAt: new Date(),
        };

        const reps = await User.find({ role: "sales person" }).sort({ _id: 1 });
        if (reps && reps.length > 0) {
          let state = await AssignmentState.findOne({ key: "leadAssignment" });
          if (!state) {
            state = await AssignmentState.create({
              key: "leadAssignment",
              lastAssignedIndex: -1,
            });
          }

          let nextIndex = state.lastAssignedIndex + 1;
          if (nextIndex >= reps.length) {
            nextIndex = 0;
          }

          leadData.assignedTo = reps[nextIndex].name;
          state.lastAssignedIndex = nextIndex;
          await state.save();
        }

        // Save lead
        await Lead.create(leadData);
        console.log(`Successfully ingested WhatsApp lead from ${from}`);
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("Error processing WhatsApp Webhook:", error);
    res.sendStatus(500);
  }
};
