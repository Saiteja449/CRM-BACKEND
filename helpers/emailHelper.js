import nodemailer from "nodemailer";

export const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `Petsfolio CRM <noreply@petsfolio.com>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.htmlMessage,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${options.email}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
};
