import Lead from "../models/Lead.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";

export const getLeads = async (req, res) => {
  try {
    const leads = await Lead.find({});
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createLead = async (req, res) => {
  try {
    const leadData = req.body;

    if (leadData.phone) {
      const existingLead = await Lead.findOne({ phone: leadData.phone });
      if (existingLead) {
        return res
          .status(400)
          .json({ message: "A lead with this phone number already exists." });
      }
    }

    if (!leadData.assignedTo || leadData.assignedTo === "Unassigned") {
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
    }
    if (!leadData.joinedAt) {
      leadData.joinedAt = new Date();
    }

    const lead = await Lead.create(leadData);

    const assignedUser = await User.findOne({ name: lead.assignedTo });
    const targetUsers = assignedUser ? [assignedUser._id] : [];
    
    await Notification.create({
      title: "New Lead Added",
      message: `Lead ${lead.name} has been added and assigned to ${lead.assignedTo}.`,
      type: "new_lead",
      targetRoles: ["sales manager"],
      targetUsers: targetUsers,
    });

    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const lead = await Lead.findByIdAndUpdate(id, updateData, { new: true });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (updateData.status) {
      await Notification.create({
        title: "Lead Status Updated",
        message: `Lead ${lead.name} status updated to ${lead.status}.`,
        type: "lead_update",
        targetRoles: ["sales manager"],
      });
    }

    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findByIdAndDelete(id);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    await Followup.deleteMany({ leadId: id });

    res.json({ message: "Lead removed successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
