const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ['Polly', 'Gabe'],
    required: true,
  },
  originalText: {
    type: String,
    required: true,
  },
  russianText: {
    type: String,
    required: true,
  },
  englishText: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  reactions: {
    type: Map,
    of: [String], // emoji -> [senderNames who reacted]
    default: {},
  },
});

module.exports = mongoose.model('Message', messageSchema);
