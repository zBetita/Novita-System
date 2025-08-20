const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// GitHub configuration - TOKEN IS SECURE ON SERVER
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'zBetita';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Novita-System';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`;

// Helper functions
function atbashEncrypt(text) {
    return text.split('').map(char => {
        if (char >= 'A' && char <= 'Z') {
            return String.fromCharCode('Z'.charCodeAt(0) - (char.charCodeAt(0) - 'A'.charCodeAt(0)));
        } else if (char >= 'a' && char <= 'z') {
            return String.fromCharCode('z'.charCodeAt(0) - (char.charCodeAt(0) - 'a'.charCodeAt(0)));
        }
        return char;
    }).join('');
}

function generateMessageId() {
    return 'MSG_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getCurrentTimestamp() {
    return new Date().toISOString().replace('T', ' ').substr(0, 19);
}

// GitHub API wrapper functions
async function createOrUpdateFile(path, content, message) {
    if (!GITHUB_TOKEN) {
        throw new Error('GitHub token not configured on server');
    }

    try {
        let sha = null;
        
        // Check if file exists
        try {
            const getResponse = await fetch(`${GITHUB_API_BASE}/contents/${path}`, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (getResponse.ok) {
                const fileData = await getResponse.json();
                sha = fileData.sha;
            }
        } catch (e) {
            // File doesn't exist, that's fine
        }
        
        // Create or update file
        const requestBody = {
            message: message,
            content: Buffer.from(content, 'utf8').toString('base64'),
        };
        
        if (sha) {
            requestBody.sha = sha;
        }
        
        const response = await fetch(`${GITHUB_API_BASE}/contents/${path}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`GitHub API Error: ${errorData.message}`);
        }
        
        return true;
    } catch (error) {
        console.error('Error creating/updating file:', error);
        throw error;
    }
}

async function readFile(path) {
    if (!GITHUB_TOKEN) {
        throw new Error('GitHub token not configured on server');
    }

    try {
        const response = await fetch(`${GITHUB_API_BASE}/contents/${path}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            const fileData = await response.json();
            return Buffer.from(fileData.content, 'base64').toString('utf8');
        } else if (response.status === 404) {
            return null; // File doesn't exist
        } else {
            const errorData = await response.json();
            throw new Error(`GitHub API Error: ${errorData.message}`);
        }
    } catch (error) {
        console.error('Error reading file:', error);
        throw error;
    }
}

// API Routes

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test connection
app.get('/api/test', async (req, res) => {
    try {
        if (!GITHUB_TOKEN) {
            return res.json({ 
                success: false, 
                message: 'GitHub token not configured' 
            });
        }
        
        const testPath = `test/connection_test_${Date.now()}.txt`;
        const testContent = 'Connection test successful';
        await createOrUpdateFile(testPath, testContent, 'Connection test');
        res.json({ success: true, message: 'GitHub connection successful' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send message
app.post('/api/messages/send', async (req, res) => {
    try {
        const { from, to, message } = req.body;
        
        if (!from || !to || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: from, to, message' 
            });
        }
        
        const messageId = generateMessageId();
        const timestamp = getCurrentTimestamp();
        const encryptedMessage = atbashEncrypt(message);
        
        // Create message object
        const messageData = {
            id: messageId,
            from: from,
            to: to,
            message: encryptedMessage,
            timestamp: timestamp,
            decrypted: false
        };
        
        // Store message in recipient's inbox
        const inboxPath = `messages/${to}/inbox.txt`;
        let existingMessages = await readFile(inboxPath) || '';
        existingMessages += JSON.stringify(messageData) + '\n';
        
        await createOrUpdateFile(
            inboxPath,
            existingMessages,
            `New message for ${to} from ${from}`
        );
        
        // Log the message
        const logPath = `logs/${to}/messages.log`;
        let logContent = await readFile(logPath) || '';
        logContent += `[${timestamp}] MESSAGE_SENT: ${from} -> ${to} (ID: ${messageId})\n`;
        
        await createOrUpdateFile(
            logPath,
            logContent,
            `Log entry for message ${messageId}`
        );
        
        res.json({
            success: true,
            messageId: messageId,
            encrypted: encryptedMessage,
            timestamp: timestamp
        });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get messages
app.get('/api/messages/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const inboxPath = `messages/${username}/inbox.txt`;
        const messages = await readFile(inboxPath);
        
        if (!messages) {
            return res.json({ success: true, messages: [] });
        }
        
        const messageLines = messages.trim().split('\n').filter(line => line);
        const parsedMessages = [];
        
        messageLines.forEach(line => {
            try {
                const msg = JSON.parse(line);
                parsedMessages.push(msg);
            } catch (e) {
                // Skip malformed lines
            }
        });
        
        res.json({ success: true, messages: parsedMessages });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Decrypt message
app.post('/api/messages/decrypt', async (req, res) => {
    try {
        const { username, messageId } = req.body;
        
        if (!username || !messageId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: username, messageId' 
            });
        }
        
        const inboxPath = `messages/${username}/inbox.txt`;
        const messages = await readFile(inboxPath);
        
        if (!messages) {
            return res.status(404).json({ success: false, message: 'No messages found' });
        }
        
        const messageLines = messages.trim().split('\n').filter(line => line);
        let targetMessage = null;
        let updatedMessages = [];
        
        messageLines.forEach(line => {
            try {
                const msg = JSON.parse(line);
                if (msg.id === messageId) {
                    targetMessage = msg;
                    msg.decrypted = true; // Mark as read
                }
                updatedMessages.push(JSON.stringify(msg));
            } catch (e) {
                updatedMessages.push(line); // Keep malformed lines as-is
            }
        });
        
        if (!targetMessage) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        
        // Update inbox to mark message as read
        await createOrUpdateFile(
            inboxPath,
            updatedMessages.join('\n') + '\n',
            `Mark message ${messageId} as read`
        );
        
        // Decrypt message
        const decryptedMessage = atbashEncrypt(targetMessage.message);
        
        // Log the decryption
        const logPath = `logs/${username}/messages.log`;
        let logContent = await readFile(logPath) || '';
        logContent += `[${getCurrentTimestamp()}] MESSAGE_READ: ${targetMessage.from} -> ${username} (ID: ${messageId})\n`;
        
        await createOrUpdateFile(
            logPath,
            logContent,
            `Log entry for reading message ${messageId}`
        );
        
        res.json({
            success: true,
            message: {
                ...targetMessage,
                decryptedMessage: decryptedMessage
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Handle client-side routing - serve index.html for all non-API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 NOTIVA Message Service running on port ${PORT}`);
    console.log(`📍 GitHub Username: ${GITHUB_USERNAME}`);
    console.log(`📁 GitHub Repository: ${GITHUB_REPO}`);
    console.log(`🔐 GitHub Token configured: ${!!GITHUB_TOKEN}`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
});

// Export for testing
module.exports = app;