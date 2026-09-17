const mongoose = require("mongoose");
const express = require("express");
const app = express();
app.set("view engine", "ejs");
app.use(express.json());
const path = require("path");
app.set("public", path.join(__dirname, "public"));
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
const passportLocalMongoose = require("passport-local-mongoose").default;
const LocalStrategy = require("passport-local").Strategy;
const passport = require("passport");
const multer = require('multer');
const Appointment = require("./models/appointmentdetails.js");
const Patient = require("./models/patients.js");
const User = require("./models/users.js");
const session = require("express-session");
const MongoStore=require("connect-mongo").default;
require("dotenv").config();

// ---- Cloudinary setup (v2, no multer-storage-cloudinary needed) ----
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

function uploadBufferToCloudinary(buffer, folder = 'ClinicRecords') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ---- Multer: parse the incoming image into memory (no disk write) ----
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});
// mongodb://localhost:27017/clinics


const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const main = async () => {
  await mongoose.connect(process.env.MONGO_DB_URL).then(() => {
    console.log("MongoDB connected");
  }).catch((err) => {
    console.error("MongoDB connection error:", err);
  });
}
main();
const store=MongoStore.create({
  mongoUrl:process.env.MONGO_DB_URL,
  crypto:{
     secret:process.env.SECRET,
  },
  touchAfter:24*3600,
});
app.use(session({
  store,
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookies: {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));


app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

function isLoggedIn(req, res, next) {
  if (!req.isAuthenticated()) {
    req.session.redirectURL = req.originalUrl;
    return res.redirect("/login");
  }
  return next();
};



app.post("/users/signup", async (req, res) => {
  try {
    const { Username, email, password, role } = req.body;
    const newuser = new User({ username: Username, email: email, role: role });
    const registereduser = await User.register(newuser, password);
    console.log(registereduser);
    return res.redirect("/");

  } catch (e) {
    return res.redirect("/register");
  }
});
app.get("/login", (req, res) => {
  res.render("login");
})
app.post("/users/login", passport.authenticate("local",
  { failureRedirect: "/login" }), async (req, res) => {
    const role = req.user.role;
    const username = req.user.username;
    console.log(role, username);
    if (role == "doctor") {
      return res.render("Doc_panel", { username });
    }
    else {
      return res.render("Recep_panel", { username });
    };
  }
);
app.get("/register", async (req, res) => {
  res.render("signup");
});


const QRCode = require('qrcode');
const { appendFile } = require("fs/promises");

// 1) Generate QR code from CNIC
app.post('/generate-qr', async (req, res) => {

  const { cnic } = req.body;

  if (!cnic) {
    return res.status(400).json({ success: false, message: 'CNIC is required' });
  }

  const cnicRegex = /^\d{13}$/;
  if (!cnicRegex.test(cnic)) {
    return res.status(400).json({ success: false, message: 'Invalid CNIC format' });
  }

  const patient = await Patient.findOne({ cnic });
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found' });
  }

  const qrPath = `https://clinics-beta-ten.vercel.app//history/${cnic}`;

  const qrBuffer = await QRCode.toBuffer(qrPath, {
    width: 400,
    margin: 2,
    color: { dark: '#1a4d1a', light: '#ffffff' }
  });
  res.set({
    'Content-Type': 'image/png',
    'Content-Disposition': 'attachment; filename="patient-qr.png"',
    'Content-Length': qrBuffer.length
  });
  return res.send(qrBuffer)
});



app.get("/doc/panel", (req, res) => {
  const username = req.user.username;
  res.render("Doc_panel", { username })
});


// GET /api/patients/:cnic
app.get('/api/patients/:cnic', async (req, res) => {
  try {
    const patient = await Patient.findOne({ cnic: req.params.cnic });
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    return res.status(200).json({ success: true, patient });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ---- GROQ multimodal extraction ----
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACTION_PROMPT = `You are reading a handwritten or printed doctor's prescription/appointment note from an image.
Extract the information and return ONLY a valid JSON object with exactly these keys, and nothing else — no markdown, no code fences, no explanation before or after:

{
  "details": "string - the diagnosis / notes / reason for visit",
  "medicines": "string - list of medicines and dosage, as a single readable string",
  "improvement": "string - patient's condition/improvement notes",
  "visitDate": "string - date of visit in YYYY-MM-DD format. If not present in the image, use today's date."
}

Rules:
- Output raw JSON only. Your entire response must be a single JSON object starting with { and ending with }.
- If a field is illegible or missing, make a reasonable best guess but never leave it empty.
- Do not invent medicines that clearly aren't written; only summarize what's actually visible.`;

async function extractAppointmentDataFromImage(imageUrl) {
  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ],
    temperature: 0.7,
    top_p: 0.8,
    reasoning_effort: 'none',
    max_completion_tokens: 800,
    // response_format removed — forcing json_object mode on a non-thinking
    // pass sometimes returns nothing instead of falling back to plain text
  });

  const raw = completion.choices[0]?.message?.content;

  console.log('GROQ raw output:', raw); // TEMP: keep this while debugging, remove once stable

  if (!raw || !raw.trim()) {
    throw new Error('LLM returned an empty response — check image URL is reachable and valid.');
  }

  // Strip markdown code fences if the model adds them despite instructions
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('LLM did not return valid JSON: ' + cleaned);
  }

  const { details, medicines, improvement, visitDate } = parsed;
  if (!details || !medicines || !improvement || !visitDate) {
    throw new Error('LLM response missing required fields: ' + JSON.stringify(parsed));
  }

  return { details, medicines, improvement, visitDate };
}

// ---- The single, correct /add/record/:id route (image -> Cloudinary -> GROQ -> DB) ----
app.post('/add/record/:id', upload.single('image'), async (req, res) => {
  const patientId = req.params.id;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }

    const actualPatient = await Patient.findById(patientId);
    if (!actualPatient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    // 1. Upload image buffer to Cloudinary
    const cloudinaryResult = await uploadBufferToCloudinary(req.file.buffer);
    const imageUrl = cloudinaryResult.secure_url;

    // 2. Ask GROQ vision model to extract structured data from the image
    const { details, medicines, improvement, visitDate } =
      await extractAppointmentDataFromImage(imageUrl);

    const doctor = req.user.username;

    // 3. Create the appointment document
    const appointment = await Appointment.create({
      details,
      medicines,
      improvement,
      visitDate,
      img: imageUrl,
      patient: patientId,
      doctor,
    });

    // 4. Append appointment id to patient's records
    actualPatient.records.push(appointment._id);
    await actualPatient.save();

    return res.status(201).json({ success: true, appointment });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error saving appointment' });
  }
});


// POST /api/patients
app.post('/api/patients', async (req, res) => {
  try {
    const { name, cnic, phone, gender, age } = req.body;

    if (!name || !cnic || !phone) {
      return res.status(400).json({ success: false, message: 'Name, CNIC, and phone are required' });
    }

    const existing = await Patient.findOne({ cnic: cnic });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A patient with this CNIC already exists' });
    }

    const patient = await Patient.create({ name, cnic, phone, gender, age });
    return res.status(201).json({ success: true, patient });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error creating patient' });
  }
});


// 2) The endpoint the QR code actually points to — returns patient history as JSON
app.get('/history/:cnic', async (req, res) => {

  const { cnic } = req.params;

  const patient = await Patient.findOne({ cnic }).populate('records');

  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found' });
  }

  res.render("history", { patient: patient });
});


app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.send("something wrong");
    }
    res.redirect("/index");
  });
});


app.get("/", (req, res) => {
  res.render("index");
})



app.listen(3000, () => {
  console.log("Server is running on port 3000");
});