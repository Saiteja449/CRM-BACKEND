import pkg from "@whiskeysockets/baileys";
const { default: makeWASocket, useMultiFileAuthState } = pkg;
import pino from "pino";

console.log("Baileys imported successfully!");
console.log("makeWASocket:", typeof makeWASocket);
console.log("useMultiFileAuthState:", typeof useMultiFileAuthState);
process.exit(0);
