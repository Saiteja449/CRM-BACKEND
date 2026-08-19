import Lead from "../models/Lead.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

export const receiveWebsiteLead = async (req, res) => {
  try {
    const { name, mobile, email, location, service, message, petType, petAge, petAgeYears, petAgeMonths, pincode } = req.body;

    const errors = [];
    if (!name || name.trim() === "") errors.push("Name is required");
    if (!mobile || mobile.trim() === "")
      errors.push("Mobile number is required");
    if (!email || email.trim() === "") errors.push("Email is required");
    if (!location || location.trim() === "")
      errors.push("Location is required");
    if (!service || service.trim() === "") errors.push("Service is required");
    // if (!message || message.trim() === "") errors.push("Message is required");

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const existingLead = await Lead.findOne({ phone: mobile });
    if (existingLead) {
      return res.status(400).json({
        success: false,
        message: "A lead with this phone number already exists.",
      });
    }

    const mapService = (incomingService) => {
      if (!incomingService) return "General Enquiry";
      const s = incomingService.toLowerCase();
      if (s.includes("grooming")) return "Grooming";
      if (s.includes("training")) return "Training";
      if (s.includes("walking")) return "Walking";
      if (s.includes("sitting") || s.includes("boarding")) return "Pet Sitting";
      if (s.includes("insurance")) return "Pet Insurance";
      return "General Enquiry";
    };

    const leadData = {
      name: name,
      phone: mobile,
      email: email,
      city: location,
      services: [mapService(service)],
      notes: message || "No message provided",
      source: "Website Form",
      status: "New",
      assignedTo: "Unassigned",
      joinedAt: new Date(),
    };

    if (petType) leadData.petType = petType;
    if (petAge) {
      leadData.petAge = petAge;
    } else if (petAgeYears || petAgeMonths) {
      const years = petAgeYears ? `${petAgeYears} Years` : "";
      const months = petAgeMonths ? `${petAgeMonths} Months` : "";
      leadData.petAge = `${years} ${months}`.trim();
    }
    if (pincode) leadData.pincode = pincode;

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

    const lead = await Lead.create(leadData);

    // Return a structured response that is easy for the website to consume
    res.status(201).json({
      success: true,
      message: "Form submitted successfully. We will contact you soon!",
      leadId: lead._id,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
