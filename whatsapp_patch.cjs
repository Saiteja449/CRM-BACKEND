const fs = require('fs');

let content = fs.readFileSync('whatsapp/whatsappService.js', 'utf8');

content = content.replace(
  /let sock = null;\r?\nlet connectionStatus = "disconnected";\r?\nlet activeQR = "";/,
  "const sessions = {}; // map of sessionId -> { sock, status, qrCode, connectedPhone, connectedName }"
);

content = content.replace(
  /const updateSessionStatus = async \(status, qr = "", phone = "", name = ""\) => {/,
  `const updateSessionStatus = async (sessionId, status, qr = "", phone = "", name = "") => {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { status: "disconnected" };
  }
  sessions[sessionId].status = status;
  sessions[sessionId].qrCode = qr;
  if (phone) sessions[sessionId].connectedPhone = phone;
  if (name) sessions[sessionId].connectedName = name;`
);

content = content.replace(
  /let session = await WhatsAppSession\.findOne\(\);\r?\n    if \(!session\) {\r?\n      session = new WhatsAppSession\(\);\r?\n    }/,
  `let session = await WhatsAppSession.findOne({ sessionId });
    if (!session) {
      session = new WhatsAppSession({ sessionId });
    }`
);

content = content.replace(
  /io\.emit\("whatsapp_status", {/,
  `io.emit("whatsapp_status", {
        sessionId,`
);

content = content.replace(
  /export const connectWhatsApp = async \(\) => {/,
  `export const connectWhatsApp = async (sessionId) => {
  if (!sessionId) sessionId = "device_1";`
);

content = content.replace(
  /const authFolder = path\.join\(__dirname, "\.\.", "whatsapp_auth_info"\);/,
  `const authFolder = path.join(__dirname, "..", \`whatsapp_auth_info_\${sessionId}\`);`
);

content = content.replace(
  /updateSessionStatus\("connecting"\);/,
  `updateSessionStatus(sessionId, "connecting");`
);

content = content.replace(
  /sock = makeWASocket/,
  `const sock = makeWASocket`
);

content = content.replace(
  /logger: pino\(\{ level: "silent" \}\),\r?\n    \}\);/,
  `logger: pino({ level: "silent" }),
    });

    if (!sessions[sessionId]) sessions[sessionId] = {};
    sessions[sessionId].sock = sock;`
);

content = content.replace(
  /updateSessionStatus\("qr", qr\);/,
  `updateSessionStatus(sessionId, "qr", qr);`
);

content = content.replace(
  /setTimeout\(\(\) => connectWhatsApp\(\), 3000\);/,
  `setTimeout(() => connectWhatsApp(sessionId), 3000);`
);

content = content.replace(
  /logoutWhatsApp\(\);/,
  `logoutWhatsApp(sessionId);`
);

content = content.replace(
  /updateSessionStatus\("connected", "", phone, name\);/,
  `updateSessionStatus(sessionId, "connected", "", phone, name);`
);

content = content.replace(
  /await handleIncomingMessage\(msg\);/,
  `await handleIncomingMessage(msg, sessionId);`
);

content = content.replace(
  /updateSessionStatus\("disconnected"\);/,
  `updateSessionStatus(sessionId, "disconnected");`
);

content = content.replace(
  /export const logoutWhatsApp = async \(\) => {/,
  `export const logoutWhatsApp = async (sessionId) => {
  if (!sessionId) return;`
);

content = content.replace(
  /const authFolder = path\.join\(__dirname, "\.\.", "whatsapp_auth_info"\);\r?\n\r?\n  if \(sock\) {/,
  `const authFolder = path.join(__dirname, "..", \`whatsapp_auth_info_\${sessionId}\`);
  const sock = sessions[sessionId]?.sock;

  if (sock) {`
);

content = content.replace(
  /sock = null;/,
  `sessions[sessionId].sock = null;`
);

content = content.replace(
  /updateSessionStatus\("disconnected", "", "", ""\);/,
  `updateSessionStatus(sessionId, "disconnected", "", "", "");`
);

content = content.replace(
  /const handleIncomingMessage = async \(msg\) => {/,
  `const handleIncomingMessage = async (msg, sessionId) => {`
);

content = content.replace(
  /triggerAIDebounced\(lead, remoteJid, textContent\);/g,
  `triggerAIDebounced(lead, remoteJid, textContent, sessionId);`
);

content = content.replace(
  /const triggerAIDebounced = \(lead, remoteJid, incomingText\) => {/,
  `const triggerAIDebounced = (lead, remoteJid, incomingText, sessionId) => {`
);

content = content.replace(
  /triggerAIDebounced\(lead, remoteJid, ""\);/g,
  `triggerAIDebounced(lead, remoteJid, "", sessionId);`
);

content = content.replace(
  /await processAIResponse\(lead, remoteJid, batchedText\);/,
  `await processAIResponse(lead, remoteJid, batchedText, sessionId);`
);

content = content.replace(
  /const processAIResponse = async \(lead, remoteJid, incomingText\) => {/,
  `const processAIResponse = async (lead, remoteJid, incomingText, sessionId) => {`
);

content = content.replace(
  /\/\/ Send the reply message using Baileys\r?\n    if \(sock\) {/,
  `// Send the reply message using Baileys
    const sock = sessions[sessionId]?.sock || Object.values(sessions).find(s => s.status === 'connected')?.sock;
    if (sock) {`
);

content = content.replace(
  /export const sendMessageFromCRM = async \(\r?\n  leadId,\r?\n  messageText,\r?\n  senderName = "Agent",\r?\n\) => \{\r?\n  if \(!sock\) \{/,
  `export const sendMessageFromCRM = async (
  leadId,
  messageText,
  senderName = "Agent",
) => {
  const sock = Object.values(sessions).find(s => s.status === 'connected')?.sock;
  if (!sock) {`
);

content = content.replace(
  /export const getWhatsAppStatus = \(\) => \{\r?\n  return \{\r?\n    status: connectionStatus,\r?\n    qrCode: activeQR,\r?\n  \};\r?\n\};/,
  `export const getWhatsAppStatus = () => {
  return Object.keys(sessions).map(sessionId => ({
    sessionId,
    status: sessions[sessionId].status,
    qrCode: sessions[sessionId].qrCode,
    connectedPhone: sessions[sessionId].connectedPhone,
    connectedName: sessions[sessionId].connectedName
  }));
};`
);

content = content.replace(
  /export const sendAutomatedFollowup = async \(lead, imageUrl, text\) => \{\r?\n  if \(!sock\) \{/,
  `export const sendAutomatedFollowup = async (lead, imageUrl, text) => {
  const sock = Object.values(sessions).find(s => s.status === 'connected')?.sock;
  if (!sock) {`
);

fs.writeFileSync('whatsapp/whatsappService.js', content, 'utf8');
console.log("whatsappService.js updated successfully.");
