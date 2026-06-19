import Activity from "../models/Activity.js";

// @desc    Get all activities
// @route   GET /api/activities
// @access  Public
export const getActivities = async (req, res) => {
  try {
    const activities = await Activity.find().sort({ createdAt: -1 });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create an activity
// @route   POST /api/activities
// @access  Public
export const createActivity = async (req, res) => {
  try {
    const { leadId, type, content, author } = req.body;
    const activity = new Activity({
      leadId,
      type,
      content,
      author,
    });
    const createdActivity = await activity.save();
    res.status(201).json(createdActivity);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
