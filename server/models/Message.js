const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ['Polly', 'Gabe'],
    required: true,
  },
  originalText: {
    type: String,
    default: '',
  },
  imageData: {
    type: String, // base64 data URI
    default: null,
  },
  stickerData: {
    type: String, // base64 data URI for sticker
    default: null,
  },
  russianText: {
    type: String,
    default: '',
  },
  englishText: {
    type: String,
    default: '',
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  readBy: {
    type: [String], // ['Polly', 'Gabe']
    default: [],
  },
  reactions: {
    type: Map,
    of: [String], // emoji -> [senderNames who reacted]
    default: {},
  },
});

module.exports = mongoose.model('Message', messageSchema);
