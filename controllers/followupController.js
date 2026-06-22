import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";

// @desc    Get all followups
// @route   GET /api/followups
// @access  Public
export const getFollowups = async (req, res) => {
  try {
    const followups = await Followup.find().sort({ createdAt: -1 });
    res.json(followups);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a followup
// @route   POST /api/followups
// @access  Public
export const createFollowup = async (req, res) => {
  try {
    const {
      leadId,
      leadName,
      type,
      date,
      time,
      priority,
      notes,
      author,
      done,
    } = req.body;
    const followup = new Followup({
      leadId,
      leadName,
      type,
      date,
      time,
      priority,
      notes,
      author,
      done,
    });
    const createdFollowup = await followup.save();

    if (type !== "Lead Edited") {
      await Notification.create({
        title: "New Follow-up Scheduled",
        message: `A follow-up was scheduled for lead ${leadName} by ${author}.`,
        type: "system",
        targetRoles: ["sales manager"],
      });
    }

    res.status(201).json(createdFollowup);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a followup
// @route   PUT /api/followups/:id
// @access  Public
export const updateFollowup = async (req, res) => {
  try {
    const followup = await Followup.findById(req.params.id);

    if (followup) {
      followup.done =
        req.body.done !== undefined ? req.body.done : followup.done;
      // Other fields can be updated if needed, but primarily we toggle 'done'

      const updatedFollowup = await followup.save();
      res.json(updatedFollowup);
    } else {
      res.status(404).json({ message: "Followup not found" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
