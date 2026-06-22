const fetch = require('node-fetch') || globalThis.fetch;

async function run() {
  console.log("Logging in as admin/sales manager to get token...");
  const loginRes = await fetch("http://127.0.0.1:5000/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "siva.infasta@gmail.com", otp: "123456" }) // Assuming this email exists, if not we'll create one
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Login failed:", loginData);
    return;
  }

  const token = loginData.token;
  console.log("Login successful! Token acquired.");

  console.log("Fetching notifications...");
  const notifRes = await fetch("http://127.0.0.1:5000/api/notifications", {
    headers: { "Authorization": `Bearer ${token}` }
  });

  const notifData = await notifRes.json();
  if (notifRes.ok) {
    console.log("Notifications fetched:");
    console.log(JSON.stringify(notifData, null, 2));
  } else {
    console.error("Failed to fetch notifications:", notifData);
  }
}

run();
