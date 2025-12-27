//Garrett Safsten, Will Knudson, Willard Richards, and Logan Johnson
// This is the server side .js file that contains all the routes and logic for the Sewing Camp web application.
// Load environment variables from .env file
require('dotenv').config();

// Import required Node.js packages for the Express server
const express = require("express");
const session = require("express-session");
const path = require("path");
const knex = require("knex");

// Initialize bcrypt for password hashing (optional dependency)
let bcrypt = null;
let bcryptAvailable = false;
try {
    bcrypt = require('bcryptjs');
    bcryptAvailable = true;
} catch (e) {
    console.warn('Optional dependency bcryptjs is not installed.');
}

// --- OPTIONAL EMAIL SETUP FOR NOTIFICATIONS ---
// Initialize nodemailer for sending confirmation emails
let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.warn('Optional dependency nodemailer is not installed. Emails will not send. Run: npm install nodemailer');
}

// Configure Email Transporter for Gmail service
// NOTE: For Gmail, you often need an "App Password" if 2FA is on.
const transporter = nodemailer ? nodemailer.createTransport({
    service: 'gmail', // or your email provider
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS
    }
}) : null;

// Helper function: Send Email
// Sends email notifications to users and admin
// If nodemailer is not installed, it logs the email to console instead
async function sendEmail(to, subject, text) {
    if (!transporter) {
        console.log(`[Mock Email] To: ${to} | Subject: ${subject} | Body: ${text}`);
        return;
    }
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: text
        });
        console.log(`Email sent to ${to}`);
    } catch (err) {
        console.error("Failed to send email:", err);
    }
}

// Admin Email for Notifications - used when sending alerts to admin
const ADMIN_EMAIL = process.env.EMAIL_USER;

const app = express();

// --- DATABASE CONNECTION SETUP ---
// Connect to PostgreSQL database using Knex.js ORM
let db = null;
let dbConnected = false;

try {
    db = knex({
        client: "pg",  // PostgreSQL client
        connection: {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: { rejectUnauthorized: false }
        },
        pool: { min: 0, max: 10 },
    });

    // Test database connection
    db.raw('SELECT 1').then(async () => {
        dbConnected = true;
        console.log('Database connected successfully.');
    }).catch((err) => {
        console.warn('Database connection failed:', err.message);
    });
} catch (err) {
    console.warn('Failed to initialize database:', err.message);
}

// --- MIDDLEWARE CONFIGURATION ---
// Serve static images from the /images folder
app.use('/images', express.static(path.join(__dirname, 'images')));

// Set EJS as the view engine for rendering HTML templates
app.set("view engine", "ejs");

// Middleware to parse form data (URL-encoded and JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure session management to track logged-in users
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
}));

// Make user data available to all views (for navigation/auth checks)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- PUBLIC ROUTES (NO LOGIN REQUIRED) ---
// Home page - displays sewing camp information
app.get("/", (req, res) => res.render("index"));

// Camp information page
app.get("/campinfo", (req, res) => res.render("campinfo"));

// Schedule/Sessions page - displays all available sewing camp sessions
// Fetches sessions from database and calculates enrollment count
app.get("/campschedule", async (req, res) => {
    if (!dbConnected) {
        return res.render("campschedule", { 
            sessions: [], 
            user: req.session.user || null 
        });
    }
    try {
        // Query sessions with enrollment counts (excluding rejected registrations)
        const sessions = await db('Sessions')
            .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
            .select(
                'Sessions.Sessionid',
                'Sessions.Sessionname',
                'Sessions.Sessiondesc',
                'Sessions.startdate',
                'Sessions.enddate',
                'Sessions.starttime',
                'Sessions.endtime',
                'Sessions.numseats',
                'Sessions.season', 
                db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count")
            )
            .groupBy('Sessions.Sessionid')
            .orderBy('Sessions.startdate', 'asc');
        
        res.render("campschedule", { 
            sessions: sessions, 
            user: req.session.user || null 
        });
    } catch (err) {
        console.error("Error fetching schedule:", err);
        res.render("campschedule", { 
            sessions: [], 
            user: req.session.user || null 
        });
    }
});

// Contact us page
app.get("/contactus", (req, res) => res.render("contactus"));

// Registration information page
app.get("/registrations", (req, res) => res.render("registrations"));

// Redirect old registration path to new one
app.get("/registration", (req, res) => res.redirect("/register"));

// --- REGISTRATION ROUTES (PUBLIC) ---

// GET: Display registration form with available sessions
app.get("/register", async (req, res) => {
    let sessions = [];
    if (dbConnected) {
        try {
            sessions = await db('Sessions')
                .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
                .select(
                    'Sessions.*', 
                    db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count")
                )
                .groupBy('Sessions.Sessionid')
                .orderBy('startdate', 'asc');
        } catch (err) {
            console.error("Error fetching sessions for register:", err);
        }
    }
    res.render("register", { 
        success_message: "", 
        error_message: "", 
        sessions: sessions 
    });
});

// POST: Handle new participant registration
// Creates parent info, address, child info, and registration records
// Sends email notifications to parent and admin
app.post("/register", async (req, res) => {
    const { first_name, last_name, birthdate, age, parent_first_name, parent_last_name, email, phone, street_address, city, state, zipcode, special_requests, season, selected_session } = req.body;

    if (!dbConnected) {
        return res.render("register", { success_message: "", error_message: "Database unavailable.", sessions: [] });
    }

    try {
        await db.transaction(async (trx) => {
            // Insert parent information
            const [parentRes] = await trx('parent_info').insert({ parentfirstname: parent_first_name, parentlastname: parent_last_name, email: email, cellphone: phone, waiver: 'Y' }).returning('parentid');
            const parentId = parentRes?.parentid || parentRes;

            // Insert street address linked to parent
            const [streetRes] = await trx('street').insert({ streetaddress: street_address, city: city, state: state, zipcode: zipcode, parentid: parentId }).returning('addressid');
            const streetId = streetRes?.addressid || streetRes;

            // Insert class information (special requests)
            const [classRes] = await trx('class_info').insert({ classinformation: special_requests, classdate: new Date() }).returning('classid');
            const classId = classRes?.classid || classRes;

            // Insert child information linked to parent
            const [childRes] = await trx('child_info').insert({ childfirstname: first_name, childlastname: last_name, childage: age ? parseInt(age) : null, parentid: parentId, classid: classId }).returning('childid');
            const childId = childRes?.childid || childRes;

            // Insert registration with pending status (awaiting admin approval)
            await trx('registrations').insert({ 
                first_name, 
                last_name, 
                email, 
                phone, 
                birthdate, 
                child_id: childId, 
                street_id: streetId, 
                class_id: classId, 
                Sessionid: selected_session ? parseInt(selected_session) : null,
                created_at: new Date(),
                status: 'pending'
            });

            // --- SEND NOTIFICATION EMAILS ---
            if (selected_session) {
                // Fetch session details for email
                const sessionDetails = await trx('Sessions').where('Sessionid', selected_session).first();
                if (sessionDetails) {
                    const sessionStr = `${sessionDetails.Sessionname} (${new Date(sessionDetails.startdate).toLocaleDateString()} - ${new Date(sessionDetails.enddate).toLocaleDateString()})`;

                    // Email to Parent - confirmation of registration received
                    const parentMsg = `Hello! ${parent_first_name} ${parent_last_name} we are so excited for ${first_name} ${last_name} to join us! We will let you know when payment has been recieved and we will reserve the spot for this session: ${sessionStr}`;
                    sendEmail(email, "Registration Received - Sewing Camp", parentMsg);

                    // Email to Admin - notify about new pending registration
                    const adminMsg = `You have a new participant in the queue awaiting your approval for ${sessionStr}.`;
                    sendEmail(ADMIN_EMAIL, "New Participant in Queue", adminMsg);
                }
            }
        });
        
        // Fetch updated sessions list for re-rendering form
        const sessions = await db('Sessions')
            .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
            .select('Sessions.*', db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count"))
            .groupBy('Sessions.Sessionid')
            .orderBy('startdate', 'asc');

        res.render("register", { success_message: "Registration successful! You will receive a confirmation message shortly.", error_message: "", sessions: sessions });

    } catch (err) {
        console.error("Registration error:", err);
        let sessions = [];
        try { 
            sessions = await db('Sessions')
                .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
                .select('Sessions.*', db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count"))
                .groupBy('Sessions.Sessionid')
                .orderBy('startdate', 'asc');
        } catch(e){}
        
        res.render("register", { success_message: "", error_message: "Error saving registration.", sessions: sessions });
    }
}); 

// --- AUTHENTICATION ROUTES ---
// GET: Display login page
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.render('login', { success_message: '', error_message: '' });
});

// POST: Handle login credentials
// Validates username and password against authentication table
// Supports both bcrypt-hashed passwords and plain text passwords
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!dbConnected) return res.render('login', { success_message: '', error_message: 'Database unavailable.' });

    try {
        // Fetch user from authentication table
        const user = await db('authentication').where({ username }).first();
        if (!user) return res.render('login', { success_message: '', error_message: 'Invalid credentials.' });

        // Check password - supports both bcrypt and plain text
        let match = false;
        if (bcryptAvailable && user.password.startsWith('$2')) {
            match = await bcrypt.compare(password, user.password);
        } else {
            match = (password === user.password);
        }

        // If password matches, create session and redirect to admin dashboard
        if (match) {
            req.session.user = { id: user.id, username: user.username, is_admin: user.is_admin };
            return res.redirect('/admin');
        } else {
            return res.render('login', { success_message: '', error_message: 'Invalid credentials.' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { success_message: '', error_message: 'Login error.' });
    }
});

// GET: Logout - destroy session and redirect to home
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ADMIN ROUTES (CRUD - Create, Read, Update, Delete) ---
// All admin routes require an authenticated user session

// 1. READ (Admin Dashboard) - Display all registrations with search capability
// Shows pending registrations separately for quick approval workflow
// Supports multi-term search across multiple fields (name, email, session, dates, etc)
app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const searchQuery = req.query.search || '';

    try {
        // Build query with joins to get all related data (parent, child, address, session info)
        let query = db('registrations')
            .leftJoin('child_info', 'registrations.child_id', 'child_info.childid')
            .leftJoin('street', 'registrations.street_id', 'street.addressid')
            .leftJoin('class_info', 'registrations.class_id', 'class_info.classid')
            .leftJoin('parent_info', 'child_info.parentid', 'parent_info.parentid')
            .leftJoin('Sessions', 'registrations.Sessionid', 'Sessions.Sessionid')
            .select(
                'registrations.id as reg_id',
                'registrations.first_name',
                'registrations.last_name',
                'registrations.email',
                'registrations.phone',
                'registrations.birthdate',
                'registrations.created_at',
                'registrations.notes', 
                'registrations.status', 
                'child_info.childage',
                'street.streetaddress',
                'street.city',
                'street.state',
                'street.zipcode',
                'parent_info.parentfirstname',
                'parent_info.parentlastname',
                'parent_info.waiver',
                'class_info.classinformation as special_requests',
                'Sessions.Sessionname',
                'Sessions.startdate as session_start',
                'Sessions.enddate as session_end',
                'Sessions.starttime as session_stime',
                'Sessions.endtime as session_etime',
                'Sessions.season'
            );
        
        // Apply search filter if search query provided
        if (searchQuery) {
            // Split search by comma or space for flexible multi-term searches
            // Example: "John Summer" or "Smith, 2025" both work
            const terms = searchQuery.split(/[\s,]+/).map(t => t.trim()).filter(t => t.length > 0);

            if (terms.length > 0) {
                // Search across all relevant fields with case-insensitive matching
                query.where(builder => {
                    terms.forEach(term => {
                        const pattern = `%${term}%`;
                        builder.orWhere(subBuilder => {
                            subBuilder.where('registrations.first_name', 'ilike', pattern)
                                .orWhere('registrations.last_name', 'ilike', pattern)
                                .orWhere('parent_info.parentfirstname', 'ilike', pattern)
                                .orWhere('parent_info.parentlastname', 'ilike', pattern)
                                .orWhere('registrations.email', 'ilike', pattern)
                                .orWhere('registrations.phone', 'ilike', pattern)
                                .orWhere('street.streetaddress', 'ilike', pattern)
                                .orWhere('street.city', 'ilike', pattern)
                                .orWhere('Sessions.Sessionname', 'ilike', pattern)
                                .orWhere('Sessions.season', 'ilike', pattern)
                                .orWhere('registrations.notes', 'ilike', pattern)
                                .orWhereRaw("TO_CHAR(registrations.birthdate, 'YYYY-MM-DD') ILIKE ?", [pattern])
                                .orWhereRaw("TO_CHAR(registrations.created_at, 'YYYY-MM-DD') ILIKE ?", [pattern])
                                .orWhereRaw("TO_CHAR(\"Sessions\".startdate, 'YYYY-MM-DD') ILIKE ?", [pattern])
                                .orWhereRaw("TO_CHAR(\"Sessions\".enddate, 'YYYY-MM-DD') ILIKE ?", [pattern]);
                        });
                    });
                });
            }
        }

        // Sort by creation date (newest first)
        query.orderBy('registrations.created_at', 'desc');
        const registrations = await query;

        // Separate pending registrations (awaiting approval) from processed ones
        const pendingRegs = registrations.filter(r => r.status === 'pending');
        const processedRegs = registrations.filter(r => r.status !== 'pending');

        // Generate comma-separated email list for bulk email functionality
        const allEmails = [...new Set(registrations.map(r => r.email).filter(e => e))].join(',');

        res.render('admin', { 
            registrations: processedRegs, 
            pendingRegs: pendingRegs, 
            user: req.session.user, 
            searchQuery,
            emailList: allEmails
        });
    } catch (err) {
        console.error('Admin Fetch Error:', err);
        res.render('admin', { registrations: [], pendingRegs: [], user: req.session.user, error: "Error loading data", searchQuery: '', emailList: '' });
    }
});

// ROUTE: Update Personal Notes (AJAX) - Admin can add notes to registrations
app.post('/admin/update-note', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const { reg_id, notes } = req.body;
    try {
        await db('registrations').where('id', reg_id).update({ notes: notes });
        res.json({ success: true });
    } catch (err) {
        console.error("Error updating note:", err);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// ROUTE: Approve Registration - Update status to 'approved' and send confirmation email to parent
app.post('/admin/approve/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const regId = req.params.id;

    try {
        await db.transaction(async (trx) => {
            // Update registration status to approved
            await trx('registrations').where('id', regId).update({ status: 'approved' });

            // Fetch registration and related session details for email
            const reg = await trx('registrations')
                .join('parent_info', 'registrations.id', '=', 'registrations.id') 
                .leftJoin('child_info', 'registrations.child_id', 'child_info.childid')
                .leftJoin('parent_info as pi', 'child_info.parentid', 'pi.parentid')
                .leftJoin('Sessions', 'registrations.Sessionid', 'Sessions.Sessionid')
                .select(
                    'registrations.first_name', 
                    'registrations.last_name',
                    'registrations.email',
                    'pi.parentfirstname',
                    'pi.parentlastname',
                    'Sessions.Sessionname',
                    'Sessions.startdate',
                    'Sessions.enddate',
                    'Sessions.starttime',
                    'Sessions.endtime'
                )
                .where('registrations.id', regId)
                .first();

            // Send approval email with session details to parent
            if (reg) {
                const dateStr = `${new Date(reg.startdate).toLocaleDateString()} - ${new Date(reg.enddate).toLocaleDateString()}`;
                
                // Helper function to convert 24-hour time to 12-hour format with AM/PM
                const formatT = (t) => {
                    if (!t) return '';
                    let [hours, minutes] = t.split(':');
                    hours = parseInt(hours);
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12;
                    hours = hours ? hours : 12; 
                    return `${hours}:${minutes}${ampm}`;
                };
                const timeStr = `${formatT(reg.starttime)} and ${formatT(reg.endtime)}`;

                const msg = `Hello ${reg.parentfirstname} ${reg.parentlastname} we are so excited for ${reg.first_name} ${reg.last_name} to join us for ${reg.Sessionname} on ${dateStr} from ${timeStr}! Your spot is reserved and if you have any questions or concerns feel free to send us as Email or text!`;

                sendEmail(reg.email, "Registration Approved - Sewing Camp", msg);
            }
        });

        res.redirect('/admin');
    } catch (err) {
        console.error("Error approving:", err);
        res.redirect('/admin');
    }
});

// ROUTE: Reject Registration - Update status to 'rejected'
app.post('/admin/reject/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        await db('registrations').where('id', req.params.id).update({ status: 'rejected' });
        res.redirect('/admin');
    } catch (err) {
        console.error("Error rejecting:", err);
        res.redirect('/admin');
    }
});

// 2. CREATE (Add New Registration from Admin)
// Admin can manually add new participants without needing approval
// Registrations added by admin are auto-approved
app.get('/admin/add', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    // Fetch available sessions for dropdown
    let sessions = [];
    if (dbConnected) {
        try {
            sessions = await db('Sessions')
                .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
                .select('Sessions.*', db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count"))
                .groupBy('Sessions.Sessionid')
                .orderBy('startdate', 'asc');
        } catch (err) {
            console.error("Error fetching sessions for admin add:", err);
        }
    }
    res.render('admin_add', { sessions }); 
});

// POST: Process new registration from admin form
// Creates all related records and auto-approves the registration
app.post('/admin/add', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { first_name, last_name, birthdate, age, parent_first_name, parent_last_name, email, phone, street_address, city, state, zipcode, special_requests, selected_session, agree } = req.body;

    try {
        await db.transaction(async (trx) => {
            // Insert parent information
            const [parentRes] = await trx('parent_info').insert({ parentfirstname: parent_first_name, parentlastname: parent_last_name, email: email, cellphone: phone, waiver: agree ? 'Y' : 'N' }).returning('parentid');
            const parentId = parentRes?.parentid || parentRes;

            // Insert street address
            const [streetRes] = await trx('street').insert({ streetaddress: street_address, city: city, state: state, zipcode: zipcode, parentid: parentId }).returning('addressid');
            const streetId = streetRes?.addressid || streetRes;

            // Insert class information
            const [classRes] = await trx('class_info').insert({ classinformation: special_requests, classdate: new Date() }).returning('classid');
            const classId = classRes?.classid || classRes;

            // Insert child information
            const [childRes] = await trx('child_info').insert({ childfirstname: first_name, childlastname: last_name, childage: age ? parseInt(age) : null, parentid: parentId, classid: classId }).returning('childid');
            const childId = childRes?.childid || childRes;

            // Insert registration with 'approved' status (auto-approved for admin additions)
            await trx('registrations').insert({ 
                first_name, 
                last_name, 
                email, 
                phone, 
                birthdate, 
                child_id: childId, 
                street_id: streetId, 
                class_id: classId, 
                Sessionid: selected_session ? parseInt(selected_session) : null,
                created_at: new Date(),
                status: 'approved'
            });
        });
        res.redirect('/admin');
    } catch (err) {
        console.error("Admin Add Error:", err);
        res.send("Error adding record: " + err.message);
    }
});

// 3. UPDATE (Edit Existing Registration)
// GET: Display form with existing registration data pre-filled
app.get('/admin/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const regId = req.params.id;

    try {
        // Fetch available sessions
        let sessions = [];
        if (dbConnected) {
             sessions = await db('Sessions')
                .leftJoin('registrations', 'Sessions.Sessionid', 'registrations.Sessionid')
                .select('Sessions.*', db.raw("COUNT(CASE WHEN registrations.status != 'rejected' THEN 1 END) as enrolled_count"))
                .groupBy('Sessions.Sessionid')
                .orderBy('startdate', 'asc');
        }

        // Fetch the registration record with all related data
        const record = await db('registrations')
            .leftJoin('child_info', 'registrations.child_id', 'child_info.childid')
            .leftJoin('street', 'registrations.street_id', 'street.addressid')
            .leftJoin('class_info', 'registrations.class_id', 'class_info.classid')
            .leftJoin('parent_info', 'child_info.parentid', 'parent_info.parentid')
            .select(
                'registrations.id as reg_id',
                'registrations.first_name',
                'registrations.last_name',
                'registrations.email',
                'registrations.phone',
                'registrations.birthdate',
                'registrations.Sessionid', 
                'child_info.childage',
                'child_info.childid',
                'street.streetaddress',
                'street.city',
                'street.state',
                'street.zipcode',
                'street.addressid',
                'parent_info.parentfirstname',
                'parent_info.parentlastname',
                'parent_info.parentid',
                'parent_info.waiver',
                'class_info.classinformation as special_requests',
                'class_info.classid'
            )
            .where('registrations.id', regId)
            .first();

        if (!record) return res.send("Record not found");
        res.render('admin_edit', { record, sessions }); 
    } catch (err) {
        console.error("Edit Fetch Error:", err);
        res.redirect('/admin');
    }
});

// POST: Process updates to existing registration
// Updates parent info, address, child info, and registration details
app.post('/admin/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const regId = req.params.id;
    const { first_name, last_name, birthdate, age, parent_first_name, parent_last_name, email, phone, street_address, city, state, zipcode, special_requests, child_id, parent_id, address_id, class_id, selected_session, agree } = req.body;

    try {
        // Update each table if the corresponding ID is provided
        await db.transaction(async (trx) => {
            // Update parent information
            if (parent_id) {
                await trx('parent_info').where('parentid', parent_id).update({ 
                    parentfirstname: parent_first_name, 
                    parentlastname: parent_last_name, 
                    email: email, 
                    cellphone: phone,
                    waiver: agree ? 'Y' : 'N'
                });
            }
            // Update address
            if (address_id) {
                await trx('street').where('addressid', address_id).update({ streetaddress: street_address, city: city, state: state, zipcode: zipcode });
            }
            // Update class information (special requests)
            if (class_id) {
                await trx('class_info').where('classid', class_id).update({ classinformation: special_requests });
            }
            // Update child information
            if (child_id) {
                await trx('child_info').where('childid', child_id).update({ childfirstname: first_name, childlastname: last_name, childage: age });
            }
            // Update main registration record
            await trx('registrations').where('id', regId).update({ 
                first_name, 
                last_name, 
                email, 
                phone, 
                birthdate,
                Sessionid: selected_session ? parseInt(selected_session) : null
            });
        });
        res.redirect('/admin');
    } catch (err) {
        console.error("Update Error:", err);
        res.send("Error updating record");
    }
});

// 4. DELETE - Remove a registration and related data
app.post('/admin/delete/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const regId = req.params.id;

    try {
        // Delete the registration record (cascade delete handles related data)
        await db('registrations').where('id', regId).del();
        res.redirect('/admin');
    } catch (err) {
        console.error("Delete Error:", err);
        res.redirect('/admin');
    }
});

// --- ADMIN SCHEDULE ROUTES (Manage Camp Sessions) ---

// A. GET: Display form to add new session
app.get('/admin/schedule/add', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('admin_schedule_add');
});

// B. POST: Create new session in the database
// Sessions define the camps available for registration
app.post('/admin/schedule/add', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { Sessionname, Sessiondesc, startdate, enddate, starttime, endtime, numseats, season } = req.body;

    try {
        // Insert new session record
        await db('Sessions').insert({
            Sessionname,
            Sessiondesc,
            startdate,
            enddate,
            starttime,
            endtime,
            numseats: numseats ? parseInt(numseats) : null,
            season: season || 'Summer'
        });
        res.redirect('/campschedule');
    } catch (err) {
        console.error("Error adding session:", err);
        res.send("Error adding session: " + err.message);
    }
});

// C. GET: Display form to edit existing session
// Fetches session details and pre-populates the form
app.get('/admin/schedule/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const sessionId = req.params.id;

    try {
        // Fetch the session record by ID
        const session = await db('Sessions').where('Sessionid', sessionId).first();
        if (!session) return res.send("Session not found");
        res.render('admin_schedule_edit', { session });
    } catch (err) {
        console.error("Error fetching session for edit:", err);
        res.redirect('/campschedule');
    }
});

// D. POST: Update existing session
// Modifies session details like name, dates, times, and capacity
app.post('/admin/schedule/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const sessionId = req.params.id;
    const { Sessionname, Sessiondesc, startdate, enddate, starttime, endtime, numseats, season } = req.body;

    try {
        // Update the session record with new information
        await db('Sessions').where('Sessionid', sessionId).update({
            Sessionname,
            Sessiondesc,
            startdate,
            enddate,
            starttime,
            endtime,
            numseats: numseats ? parseInt(numseats) : null,
            season: season || 'Summer'
        });
        res.redirect('/campschedule');
    } catch (err) {
        console.error("Error updating session:", err);
        res.send("Error updating session: " + err.message);
    }
});

// E. POST: Delete session from database
// Removes session and associated registrations may be affected
app.post('/admin/schedule/delete/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const sessionId = req.params.id;

    try {
        // Delete the session record
        await db('Sessions').where('Sessionid', sessionId).del();
        res.redirect('/campschedule');
    } catch (err) {
        console.error("Error deleting session:", err);
        res.send("Error deleting session (it might be linked to registrations): " + err.message);
    }
});

// --- SERVER STARTUP ---
// Start the Express server on the configured port
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port:${port}`));