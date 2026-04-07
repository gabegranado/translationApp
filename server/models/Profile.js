const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  user: {
    type: String,
    enum: ['Polly', 'Gabe'],
    required: true,
    unique: true,
  },
  imageData: {
    type: String, // base64 data URI
    default: null,
  },
});

module.exports = mongoose.model('Profile', profileSchema);
