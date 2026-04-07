require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { Translate } = require('@google-cloud/translate').v2;

const Message = require('./models/Message');
const Profile = require('./models/Profile');

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
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for base64 images
});

const translate = new Translate({ key: process.env.GOOGLE_TRANSLATE_API_KEY });

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '10mb' }));

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

// POST upload profile image (base64)
app.post('/api/profile/:user', async (req, res) => {
  const { imageData } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data' });
  try {
    await Profile.findOneAndUpdate(
      { user: req.params.user },
      { imageData },
      { upsert: true }
    );
    res.json({ imageData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save profile image' });
  }
});

// GET profile image
app.get('/api/profile/:user', async (req, res) => {
  try {
    const profile = await Profile.findOne({ user: req.params.user }).lean();
    res.json({ imageData: profile?.imageData || null });
  } catch {
    res.json({ imageData: null });
  }
});

// GET all messages
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).populate('replyTo').lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Track online users: socketId -> userName
const onlineUsers = new Map();

function getOnlineNames() {
  const names = new Set(onlineUsers.values());
  return { Polly: names.has('Polly'), Gabe: names.has('Gabe') };
}

// Socket.io real-time messaging
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // When a user identifies themselves
  socket.on('setUser', (userName) => {
    onlineUsers.set(socket.id, userName);
    io.emit('onlineStatus', getOnlineNames());
  });

  // When a user logs out / switches user
  socket.on('clearUser', () => {
    onlineUsers.delete(socket.id);
    io.emit('onlineStatus', getOnlineNames());
  });

  socket.on('sendMessage', async ({ sender, text, imageData, replyTo }) => {
    try {
      let englishText = '', russianText = '';

      if (text && text.trim()) {
        if (sender === 'Gabe') {
          englishText = text;
          russianText = await translateText(text, 'ru');
        } else {
          russianText = text;
          englishText = await translateText(text, 'en');
        }
      }

      const message = new Message({
        sender,
        originalText: text || '',
        russianText,
        englishText,
        imageData: imageData || null,
        replyTo: replyTo || null,
        readBy: [sender],
      });

      await message.save();
      await message.populate('replyTo');

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

  socket.on('deleteMessage', async ({ messageId }) => {
    try {
      await Message.findByIdAndDelete(messageId);
      io.emit('messageDeleted', { messageId });
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  socket.on('markRead', async ({ messageIds, reader }) => {
    try {
      await Message.updateMany(
        { _id: { $in: messageIds }, readBy: { $ne: reader } },
        { $addToSet: { readBy: reader } }
      );
      io.emit('messagesRead', { messageIds, reader });
    } catch (err) {
      console.error('Error marking messages read:', err);
    }
  });

  socket.on('typing', ({ sender }) => {
    socket.broadcast.emit('userTyping', { sender });
  });

  socket.on('stopTyping', () => {
    socket.broadcast.emit('userStopTyping');
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('onlineStatus', getOnlineNames());
    socket.broadcast.emit('userStopTyping');
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
