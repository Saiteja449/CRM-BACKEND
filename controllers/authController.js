import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { sendEmail } from "../helpers/emailHelper.js";

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};
export const sendOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide an email" });
  }

  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email });
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = otp;
    user.otpExpiresAt = otpExpiresAt;
    await user.save();

    const message = `Your login OTP is ${otp}. It is valid for 10 minutes.`;
    const htmlMessage = `<p>Your login OTP is <strong>${otp}</strong>.</p><p>It is valid for 10 minutes.</p>`;

    const isEmailSent = await sendEmail({
      email: user.email,
      subject: "Petsfolio CRM - Login OTP",
      message,
      htmlMessage,
    });
    if (!isEmailSent) {
      return res
        .status(500)
        .json({ success: false, message: "Server error while sending OTP" });
    }

    res
      .status(200)
      .json({ success: true, message: "OTP sent successfully to email" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Server error while sending OTP" });
  }
};
export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide email and OTP" });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    if (new Date() > user.otpExpiresAt) {
      return res
        .status(400)
        .json({ success: false, message: "OTP has expired" });
    }

    user.otp = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Server error while verifying OTP" });
  }
};
