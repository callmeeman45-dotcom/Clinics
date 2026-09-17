const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const appointmentSchema = new Schema(
  {
    details: {
      type: String,
      required: true
    },
    visitDate: {
      type: Date,
      default: Date.now,
      required: true
    },
    img: {
      type: String,
      required: true
    },
    medicines: {
      type: String,
      required: true
    },
    improvement: {
      type: String,
      required: true
    },
    doctor: {
      type: String,
      required: true
    },
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true
    }
  },
  { timestamps: true }
);

const Appointment = mongoose.model("Appointment", appointmentSchema);
module.exports = Appointment;