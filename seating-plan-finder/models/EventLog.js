const mongoose = require('mongoose');

const eventLogSchema = new mongoose.Schema({
  type: { type: String, required: true }, // e.g. 'lookup_not_found'
  detail: { type: String, default: '' },
  at: { type: Date, default: Date.now },
});

module.exports = mongoose.models.EventLog || mongoose.model('EventLog', eventLogSchema);
