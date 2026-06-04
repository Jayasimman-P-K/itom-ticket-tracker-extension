/**
 * Native Messaging Host — a small Node.js script that runs on your machine.
 * 
 * The Chrome extension sends messages to this script, and it reads/writes
 * real files on your filesystem (something Chrome extensions can't do alone).
 * 
 * Protocol: Chrome sends a 4-byte length header (little-endian) followed by JSON.
 *           This script replies using the same format.
 */
const fs = require('fs');
const path = require('path');

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processBuffer();
});

function processBuffer() {
  // Need at least 4 bytes for the length header
  while (inputBuffer.length >= 4) {
    const msgLength = inputBuffer.readUInt32LE(0);

    // Wait until we have the full message
    if (inputBuffer.length < 4 + msgLength) break;

    const msgBody = inputBuffer.slice(4, 4 + msgLength);
    inputBuffer = inputBuffer.slice(4 + msgLength);

    try {
      const message = JSON.parse(msgBody.toString());
      handleMessage(message);
    } catch (e) {
      sendResponse({ success: false, error: 'Invalid JSON: ' + e.message });
    }
  }
}

function handleMessage(msg) {
  try {
    if (msg.action === 'write') {
      // Write (or overwrite) the entire file
      const filePath = path.resolve(msg.filePath);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, msg.content, 'utf-8');
      sendResponse({ success: true, path: filePath });
    }

    else if (msg.action === 'append') {
      // Append new content to existing file (or create if doesn't exist)
      const filePath = path.resolve(msg.filePath);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, msg.content, 'utf-8');
      sendResponse({ success: true, path: filePath });
    }

    else if (msg.action === 'read') {
      // Read file contents (returns empty string if file doesn't exist)
      const filePath = path.resolve(msg.filePath);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        sendResponse({ success: true, content: content });
      } else {
        sendResponse({ success: true, content: '', exists: false });
      }
    }

    else if (msg.action === 'getConfig') {
      // Read config.json from same directory as this script
      const configPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        sendResponse({ success: true, savePath: config.savePath || '' });
      } else {
        sendResponse({ success: true, savePath: '' });
      }
    }

    else if (msg.action === 'setConfig') {
      // Validate path exists, then write to config.json
      const newPath = msg.savePath;
      if (!fs.existsSync(newPath)) {
        sendResponse({ success: false, error: 'Path not found: ' + newPath });
      } else {
        const configPath = path.join(__dirname, 'config.json');
        const config = { savePath: newPath };
        fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
        sendResponse({ success: true });
      }
    }

    else {
      sendResponse({ success: false, error: 'Unknown action: ' + msg.action });
    }
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

function sendResponse(msg) {
  const json = JSON.stringify(msg);
  const byteLength = Buffer.byteLength(json, 'utf-8');
  const buffer = Buffer.alloc(4 + byteLength);
  buffer.writeUInt32LE(byteLength, 0);
  buffer.write(json, 4, 'utf-8');
  process.stdout.write(buffer);
}

// Ensure stdin is not paused and exit cleanly
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
