require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { Translate } = require('@google-cloud/translate').v2;

const Message = require('./models/Message');

// Multer config for profile images
const profileStorage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads/profiles'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.user}${ext}`);
  },
});
const uploadProfile = multer({ storage: profileStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// Multer config for message images
const messageStorage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads/messages'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const uploadMessage = multer({ storage: messageStorage, limits: { fileSize: 10 * 1024 * 1024 } });

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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// POST upload profile image
app.post('/api/profile/:user', uploadProfile.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/uploads/profiles/${req.file.filename}`;
  res.json({ imageUrl });
});

// GET profile image URL (checks if one exists)
app.get('/api/profile/:user', (req, res) => {
  const fs = require('fs');
  const dir = path.join(__dirname, 'uploads/profiles');
  const files = fs.readdirSync(dir).filter(f => f.startsWith(req.params.user + '.'));
  if (files.length > 0) {
    res.json({ imageUrl: `/uploads/profiles/${files[files.length - 1]}` });
  } else {
    res.json({ imageUrl: null });
  }
});

// POST upload message image
app.post('/api/upload-message-image', uploadMessage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/uploads/messages/${req.file.filename}`;
  res.json({ imageUrl });
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

  socket.on('sendMessage', async ({ sender, text, imageUrl }) => {
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
        imageUrl: imageUrl || null,
      });

      await message.save();

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
