const mongoose = require('mongoose');

const stickerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  imageData: {
    type: String, // base64 data URI
    required: true,
  },
  uploadedBy: {
    type: String,
    enum: ['Polly', 'Gabe', 'system'],
    default: 'system',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Sticker', stickerSchema);
