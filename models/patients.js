const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const patientSchema = new Schema(
  {
    name: {
      type: String,
      required: true
    },
    cnic: {
      type: String,
      required: true
    },
    phone:{
      type:String
    },
    gender:{
      type:String
    },
    age:{
      type:String
    },
    records: [
      {
        type: Schema.Types.ObjectId,
        ref: "Appointment"
      }
    ]
  },
  { timestamps: true }
);

const Patient = mongoose.model("Patient", patientSchema);
module.exports = Patient;