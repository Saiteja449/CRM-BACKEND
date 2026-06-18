import mongoose from "mongoose";

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    otp: {
      type: String,
    },
    otpExpiresAt: {
      type: Date,
    },
    role: {
      type: String,
      enum: ["sales manager", "sales person"],
      default: "user",
    },
  },
  {
    timestamps: true,
  },
);

const User = mongoose.model("User", userSchema);

export default User;
