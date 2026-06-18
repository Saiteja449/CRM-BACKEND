import User from "../models/User.js";

// @desc    Get all users
// @route   GET /api/users
// @access  Public (for now)
export const getUsers = async (req, res) => {
  try {
    const users = await User.find({ role: "sales person" }).select(
      "-otp -otpExpiresAt",
    ); // Don't send OTP data
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error while fetching users" });
  }
};

// @desc    Add a new Sales Representative
// @route   POST /api/users
// @access  Public (for now)
export const addSalesPerson = async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res
      .status(400)
      .json({ message: "Please provide both name and email" });
  }

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res
        .status(400)
        .json({ message: "A representative with this email already exists!" });
    }

    const user = await User.create({
      name,
      email,
      role: "sales person", // Will be mapped to 'Sales Representative' in frontend
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res
      .status(500)
      .json({ message: "Server error while creating sales representative" });
  }
};

// @desc    Delete a Sales Representative
// @route   DELETE /api/users/:id
// @access  Public (for now)
export const deleteSalesPerson = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "Representative not found" });
    }

    // You can optionally add a check here to ensure the logged in user is not deleting themselves,
    // although the frontend also checks this.
    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Representative removed" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res
      .status(500)
      .json({ message: "Server error while deleting representative" });
  }
};
