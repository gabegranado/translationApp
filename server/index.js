require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { Translate } = require('@google-cloud/translate').v2;

const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

const translate = new Translate({ key: process.env.GOOGLE_TRANSLATE_API_KEY });

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Translate helper
async function translateText(text, targetLanguage) {
  const [translation] = await translate.translate(text, targetLanguage);
  return translation;
}

// POST verify PIN
app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (pin === process.env.SESSION_PIN) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// GET all messages
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Socket.io real-time messaging
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('sendMessage', async ({ sender, text }) => {
    try {
      let englishText, russianText;

      if (sender === 'Gabe') {
        // Gabe writes in English → translate to Russian
        englishText = text;
        russianText = await translateText(text, 'ru');
      } else {
        // Polly writes in Russian → translate to English
        russianText = text;
        englishText = await translateText(text, 'en');
      }

      const message = new Message({
        sender,
        originalText: text,
        russianText,
        englishText,
      });

      await message.save();

      // Broadcast to all clients
      io.emit('newMessage', message);
    } catch (err) {
      console.error('Error sending message:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('reactToMessage', async ({ messageId, emoji, sender }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;

      const current = message.reactions.get(emoji) || [];
      if (current.includes(sender)) {
        const updated = current.filter((u) => u !== sender);
        if (updated.length === 0) {
          message.reactions.delete(emoji);
        } else {
          message.reactions.set(emoji, updated);
        }
      } else {
        message.reactions.set(emoji, [...current, sender]);
      }

      message.markModified('reactions');
      await message.save();

      io.emit('messageReacted', {
        messageId,
        reactions: Object.fromEntries(message.reactions),
      });
    } catch (err) {
      console.error('Error reacting to message:', err);
    }
  });

  socket.on('typing', ({ sender }) => {
    socket.broadcast.emit('userTyping', { sender });
  });

  socket.on('stopTyping', () => {
    socket.broadcast.emit('userStopTyping');
  });

  socket.on('disconnect', () => {
    socket.broadcast.emit('userStopTyping');
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
