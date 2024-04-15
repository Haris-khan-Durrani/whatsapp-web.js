const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const app = express();
const port = 3000;
const cors = require('cors');

// Use it before all route definitions
app.use(cors({ origin: '*' }));

let clients = {}; // Store clients indexed by instanceId
let qrCodes = {}; // Store QR codes for each client instance

const mysql = require('mysql');

// Setup MySQL database connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "fileweb"
});

db.connect(err => {
    if (err) throw err;
    console.log('Connected to the database successfully.');
    loadSessionsAndInitializeClients();
});
function loadSessionsAndInitializeClients() {
    db.query('SELECT instanceId FROM sessions', (err, results) => {
        if (err) {
            console.error('Failed to load sessions from the database:', err);
            return;
        }
        results.forEach(row => {
            console.log(`Attempting to reinitialize client for instance ${row.instanceId}...`);
            createClient(row.instanceId);
        });
    });
}

async function createClient(instanceId) {
    const client = new Client({
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
        authStrategy: new LocalAuth({ clientId: instanceId, dataPath: `./wwebjs_auth/${instanceId}` })
    });

    client.on('qr', (qr) => {
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error(`Failed to convert QR for instance ${instanceId}:`, err);
                return;
            }
            qrCodes[instanceId] = url; // Store QR code as data URL
        });
    });

    client.on('ready', () => {
        console.log(`Client ${instanceId} is ready!`);
        delete qrCodes[instanceId]; // Cleanup QR code as it's no longer needed
    });

    client.on('authenticated', () => {
        console.log(`Client ${instanceId} authenticated.`);
                const sessionData = "Authenticated"; // Assuming 'session' is an object
        db.query('INSERT INTO sessions (instanceId, session) VALUES (?, ?) ON DUPLICATE KEY UPDATE session = VALUES(session)', [instanceId, sessionData], (err) => {
            if (err) console.error('Failed to save the session to the database:', err);
            else console.log(`Session for instance ${instanceId} saved to the database.`);
        });
        // Your database operations here
    });

    client.on('auth_failure', msg => {
        console.error(`Authentication failure for instance ${instanceId}:`, msg);
    });

    client.on('disconnected', (reason) => {
        console.log(`Client ${instanceId} disconnected: ${reason}.`);
                db.query('UPDATE `sessions` SET `session`="Inactive" WHERE instanceId = ?', [instanceId], (err) => {
            if (err) console.error('Failed to remove the session from the database:', err);
            else console.log(`Session for instance ${instanceId} Inactive from the database.`);
        });
        // Your disconnection handling logic here
    });

    // Wrapping client initialization in try-catch for error handling
    try {
        await client.initialize();
    } catch (error) {
        console.error(`Failed to initialize client ${instanceId}: ${error}`);
        // Handle initialization failures (e.g., retry the initialization, log the failure, or perform cleanup)
    }

    clients[instanceId] = client;
}






app.use(express.json());

// Endpoint to initialize a new device session
app.get('/add-device/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    if (clients[instanceId]) {
        return res.status(400).send({ success: false, message: "Instance already exists." });
    }
    createClient(instanceId);
    res.send({ success: true, message: `Initialization for instance ${instanceId} started.` });
});

// Endpoint to fetch QR code for a specific instance
app.get('/get-qr/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    const qrCodeUrl = qrCodes[instanceId];
    if (!qrCodeUrl) {
        return res.status(404).send({ success: false, message: "QR code not available. Ensure the instance is initialized and awaiting authentication." });
    }
    res.send({ success: true, qrCodeUrl });
    
});





// app.get('/send-message/:instanceId', (req, res) => {
//     const { instanceId } = req.params;
//     const { number, message } = req.query; // Data is now received from query parameters

//     if (!clients[instanceId]) {
//         return res.status(404).send({ success: false, message: "Instance not found." });
//     }

//     const numberId = number.includes("@c.us") ? number : `${number}@c.us`;
//     clients[instanceId].sendMessage(numberId, message)
//         .then((response) => {
//             res.send({ success: true,  response: response });
//         })
//         .catch(err => {
//             res.status(500).send({ success: false, message: "Failed to send message.", error: err.toString() });
//         });
// });

app.get('/send-message/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    // Accepting refId as an optional query parameter
    const { number, message, refId } = req.query; // Data is now received from query parameters including an optional refId

    if (!clients[instanceId]) {
        return res.status(404).send({ success: false, message: "Instance not found." });
    }

    const numberId = number.includes("@c.us") ? number : `${number}@c.us`;
    clients[instanceId].sendMessage(numberId, message)
        .then((response) => { // Assuming response contains the message ID
            // Constructing the success response including the message ID and optionally the refId
            const successResponse = {
                success: true,
                message: "Message sent successfully.",
                messageId: response.id // Assuming 'id' is the property where the message ID is stored
            };

            // If a refId was provided, include it in the response
            if (refId) {
                successResponse.refId = refId;
            }

            res.send(successResponse);
        })
        .catch(err => {
            res.status(500).send({ success: false, message: "Failed to send message.", error: err.toString() });
        });
});




//http://localhost:3000/send-message/instance123?number=1234567890&message=Hello%20World

app.get('/send-media/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { number, mediaUrl, mediaType, caption = '' } = req.query; // Use query parameters

    if (!clients[instanceId]) {
        return res.status(404).send({ success: false, message: "Instance not found." });
    }

    try {
      
        const media = await MessageMedia.fromUrl(mediaUrl);
        
        await clients[instanceId].sendMessage(number + '@c.us', media, { caption });
        res.send({ success: true, message: "Media message sent successfully." });
    } catch (err) {
        console.error(`Failed to send media message for instance ${instanceId}:`, err);
        res.status(500).send({ success: false, message: "Failed to send media message.", error: err.toString() });
    }
});

//http://localhost:3000/send-media/instance123?number=1234567890&mediaUrl=https%3A%2F%2Fexample.com%2Fimage.png&mediaType=image%2Fpng&caption=An%20Image




app.get('/get-chat-backup/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const client = clients[instanceId];

    if (!client) {
        return res.status(404).send({ success: false, message: "Instance not found." });
    }

    if (!client.info) { // Checking client readiness
        return res.status(503).send({ success: false, message: "Client is not ready. Please try again later." });
    }

    try {
        const chats = await client.getChats(); // Fetch all chats
        res.send({ success: true, chats });
    } catch (err) {
        console.error(`Failed to retrieve chats for instance ${instanceId}:`, err);
        res.status(500).send({ success: false, message: "Failed to retrieve chats.", error: err.toString() });
    }
});




app.get('/get-messages/:instanceId/:userId/:limitme', async (req, res) => {
    const { instanceId, userId, limitme } = req.params; // `userId` should be the full phone number without '+'
    const client = clients[instanceId];

    if (!client) {
        return res.status(404).send({ success: false, message: "Instance not found." });
    }

    try {
        // Ensure the client is ready
        if (!client.info) {
            return res.status(503).send({ success: false, message: "Client is not ready. Please try again later." });
        }

        // Find the chat object by matching the userId
        const chat = await client.getChats().then(chats => chats.find(c => c.id.user === userId));

        if (!chat) {
            return res.status(404).send({ success: false, message: "Chat not found." });
        }

        // Fetch the last 10 messages from the chat
        const messages = await chat.fetchMessages({ limit: limitme });
        res.send({ success: true, messages });
    } catch (err) {
        console.error(`Failed to retrieve messages for user ${userId} in instance ${instanceId}:`, err);
        res.status(500).send({ success: false, message: "Failed to retrieve messages.", error: err.toString() });
    }
});


app.get('/get-media/:instanceId/:messageId', async (req, res) => {
    const { instanceId, messageId } = req.params;
    const client = clients[instanceId];

    if (!client) {
        return res.status(404).send({ success: false, message: "Instance not found." });
    }

    try {
        // Ensure the client is ready
        if (!client.info) {
            return res.status(503).send({ success: false, message: "Client is not ready. Please try again later." });
        }

        // Find the message by ID across all chats
        let foundMedia = null;
        const chats = await client.getChats();
        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 100 }); // Adjust limit as needed
            const mediaMessage = messages.find(m => m.id.id === messageId && m.hasMedia);
            if (mediaMessage) {
                foundMedia = await mediaMessage.downloadMedia();
                break;
            }
        }

        if (!foundMedia) {
            return res.status(404).send({ success: false, message: "Media not found." });
        }

        // Send the base64 encoded media data
        res.send({ success: true, media: foundMedia });
    } catch (err) {
        console.error(`Failed to retrieve media for message ${messageId} in instance ${instanceId}:`, err);
        res.status(500).send({ success: false, message: "Failed to retrieve media.", error: err.toString() });
    }
});



app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
