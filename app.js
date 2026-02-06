// relation bdd 
require('dotenv').config();
const db = require('./db'); // pool mysql2/promise

const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const methodOverride = require('method-override');
const app = express();

// Clé secrète pour JWT
const JWT_SECRET = process.env.JWT_SECRET || 'votre_cle_secrete_jwt';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Configuration EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware pour parser les données des formulaires et les cookies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));

// Configuration des fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Création du dossier uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuration de multer pour l'upload des fichiers
const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, uploadsDir);
    },
    filename(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Le fichier doit être une image'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    }
});

// mallware pour vérifier le token JWT
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.jwt;
  if (!token) {
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Charger l'utilisateur depuis la DB
    const [rows] = await db.query('SELECT id, name, email, type FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      res.clearCookie('jwt');
      return res.redirect('/login');
    }
    req.user = rows[0];
    res.locals.user = rows[0];
    next();
  } catch (err) {
    console.error('verifyToken error:', err);
    res.clearCookie('jwt');
    return res.redirect('/login');
  }
};

// Middleware pour vérifier si l'utilisateur est un client
const isClient = (req, res, next) => {
    console.log('Vérification client:', req.user);
    if (req.user && req.user.type === 'client') {
        next();
    } else {
        console.log('Utilisateur non client');
        res.redirect('/login');
    }
};

// Middleware pour vérifier si l'utilisateur est un propriétaire
const isOwner = (req, res, next) => {
    if (req.user && req.user.type === 'owner') {
        next();
    } else {
        res.redirect('/login');
    }
};

// Middleware pour vérifier si l'utilisateur est un administrateur
const isAdmin = (req, res, next) => {
    if (req.user && req.user.type === 'admin') {
        next();
    } else {
        res.redirect('/login');
    }
};

// Middleware pour passer l'utilisateur aux vues
app.use((req, res, next) => {
    const token = req.cookies?.jwt;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            res.locals.user = decoded;
        } catch (error) {
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});




// Routes publiques
// GET / - page d'accueil : latest rooms, latest reviews et statistiques depuis la BDD
app.get('/', async (req, res) => {
  try {
    // Récupérer les 3 salles les plus récentes
    const [latestRoomsRows] = await db.query('SELECT * FROM rooms ORDER BY createdAt DESC LIMIT 3');
    const latestRooms = latestRoomsRows.map(r => {
      let equipment = [], amenities = [];
      try { equipment = r.equipment ? JSON.parse(r.equipment) : []; } catch (e) {}
      try { amenities = r.amenities ? JSON.parse(r.amenities) : []; } catch (e) {}
      return { ...r, equipment, amenities };
    });

    // Récupérer les 3 avis les plus récents (avec nom d'utilisateur et nom de la salle si possible)
    const [latestReviewsRows] = await db.query(
      `SELECT rv.*, u.name AS userName, ro.name AS roomName
       FROM reviews rv
       LEFT JOIN users u ON rv.userId = u.id
       LEFT JOIN rooms ro ON rv.roomId = ro.id
       WHERE rv.isApproved = 1
       ORDER BY rv.date DESC
       LIMIT 3`
    );
    const latestReviews = latestReviewsRows.map(r => ({
      id: r.id,
      bookingId: r.bookingId,
      roomId: r.roomId,
      userId: r.userId,
      userName: r.userName || r.userName,
      roomName: r.roomName || r.roomName,
      rating: r.rating,
      comment: r.comment,
      date: r.date
    }));

    // Statistiques (exécutées en parallèle)
    const [
      [roomsCountRows],
      [bookingsCountRows],
      [avgRatingRows],
      [usersCountRows],
      [minPriceRows]
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS totalRooms FROM rooms'),
      db.query('SELECT COUNT(*) AS totalBookings FROM bookings'),
      db.query('SELECT IFNULL(ROUND(AVG(rating),1), 0) AS averageRating FROM reviews WHERE isApproved = 1'),
      db.query('SELECT COUNT(*) AS totalUsers FROM users'),
      db.query('SELECT MIN(price) AS minPrice FROM rooms')
    ]);

    const stats = {
      totalRooms: roomsCountRows[0].totalRooms || 0,
      totalBookings: bookingsCountRows[0].totalBookings || 0,
      averageRating: avgRatingRows[0].averageRating || 0,
      totalUsers: usersCountRows[0].totalUsers || 0,
      minPrice: minPriceRows[0].minPrice || 0
    };

    res.render('index', {
      latestRooms,
      latestReviews,
      stats,
      user: res.locals.user || null
    });
  } catch (err) {
    console.error('Erreur page d\'accueil:', err);
    res.status(500).send('Erreur serveur');
  }
});

// GET /rooms — lister les salles depuis la BD avec filtres (capacity, price, wilaya, equipment)
app.get('/rooms', async (req, res) => {
  try {
    // Récupérer les filtres depuis la query string
    const { capacity, price, wilaya, equipment } = req.query;

    // Construire dynamiquement la clause WHERE et les paramètres
    const whereParts = [];
    const params = [];

    if (capacity) {
      // capacity représente un minimum (ex: 5 => capacity >= 5)
      const capNum = parseInt(capacity, 10);
      if (!Number.isNaN(capNum)) {
        whereParts.push('capacity >= ?');
        params.push(capNum);
      }
    }

    if (price) {
      const priceNum = parseFloat(price);
      if (!Number.isNaN(priceNum)) {
        whereParts.push('price <= ?');
        params.push(priceNum);
      }
    }

    if (wilaya) {
      whereParts.push('wilaya = ?');
      params.push(wilaya);
    }

    if (equipment) {
      // equipment stocké comme JSON stringified ; on cherche la présence du mot dans la colonne JSON.
      // Utilise JSON_CONTAINS si la colonne est de type JSON, sinon fallback LIKE.
      // Ici on utilise LIKE qui marche même si la colonne est TEXT contenant JSON.
      whereParts.push('equipment LIKE ?');
      params.push('%"' + equipment + '"%');
    }

    const whereSql = whereParts.length ? ('WHERE ' + whereParts.join(' AND ')) : '';

    const sql = `SELECT * FROM rooms ${whereSql} ORDER BY createdAt DESC`;
    const [rows] = await db.query(sql, params);

    // Parser equipment/amenities JSON si présents
    const rooms = rows.map(r => {
      let equipmentArr = [], amenitiesArr = [];
      try { equipmentArr = r.equipment ? JSON.parse(r.equipment) : []; } catch (e) {}
      try { amenitiesArr = r.amenities ? JSON.parse(r.amenities) : []; } catch (e) {}
      return { ...r, equipment: equipmentArr, amenities: amenitiesArr };
    });

    // Passer aussi les filtres vers la vue pour marquer les selects
    res.render('rooms', { rooms, filters: req.query });
  } catch (error) {
    console.error('Erreur fetch rooms avec filtres:', error);
    res.status(500).send('Erreur serveur');
  }
});


// Route pour afficher le formulaire de réservation d'une salle
// GET /rooms/:id — détail d'une room + récupérer avis approuvés
app.get('/rooms/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    const [roomRows] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (roomRows.length === 0) return res.status(404).send('Salle non trouvée');

    const roomRow = roomRows[0];
    let equipment = [], amenities = [];
    try { equipment = roomRow.equipment ? JSON.parse(roomRow.equipment) : []; } catch(e){}
    try { amenities = roomRow.amenities ? JSON.parse(roomRow.amenities) : []; } catch(e){}

    // Valeurs par défaut pour les coordonnées si elles sont nulles ou invalides
    roomRow.lat = parseFloat(roomRow.lat) || 36.7538;
    roomRow.lng = parseFloat(roomRow.lng) || 3.0588;

    const room = { ...roomRow, equipment, amenities };

    const [reviewRows] = await db.query('SELECT * FROM reviews WHERE roomId = ? AND isApproved = 1 ORDER BY date DESC', [roomId]);
    room.reviews = reviewRows;

    res.render('book-room', { room });
  } catch (error) {
    console.error('Erreur fetch room:', error);
    res.status(500).send('Erreur serveur');
  }
});

// Route pour traiter la réservation
// POST /rooms/:id/book — créer une réservation
app.post('/rooms/:id/book', verifyToken, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const roomId = parseInt(req.params.id, 10);
    const { startDate, endDate, participants, purpose } = req.body;
    const userId = req.user.id;

    await conn.beginTransaction();

    const [roomRows] = await conn.query('SELECT capacity, price FROM rooms WHERE id = ?', [roomId]);
    if (roomRows.length === 0) {
      await conn.rollback(); conn.release();
      return res.status(404).send('Salle introuvable');
    }
    const room = roomRows[0];
    if (participants > room.capacity) {
      await conn.rollback(); conn.release();
      return res.status(400).send('Nombre de participants dépasse la capacité');
    }

    const [conflicts] = await conn.query(
      `SELECT id FROM bookings WHERE roomId = ? AND NOT (endDate <= ? OR startDate >= ?)`,
      [roomId, startDate, endDate]
    );
    if (conflicts.length > 0) {
      await conn.rollback(); conn.release();
      return res.status(400).send('Salle déjà réservée pour cette période');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.max(1, Math.ceil((end - start) / (1000*60*60*24)));
    const totalPrice = (room.price || 0) * days;

    await conn.query(
      `INSERT INTO bookings (roomId, userId, startDate, endDate, participants, purpose, totalPrice, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [roomId, userId, startDate, endDate, participants, purpose, totalPrice]
    );

    await conn.commit();
    conn.release();

    res.redirect('/client/dashboard?success=1');
  } catch (err) {
    try { await conn.rollback(); } catch(e){}
    try { conn.release(); } catch(e){}
    console.error('Erreur booking:', err);
    res.status(500).send('Erreur serveur');
  }
});

// Routes d'authentification
app.get('/register', (req, res) => {
    if (req.cookies?.jwt) {
        try {
            const decoded = jwt.verify(req.cookies.jwt, JWT_SECRET);
            return res.redirect(decoded.type === 'owner' ? '/owner/dashboard' : '/client/dashboard');
        } catch (error) {
            res.clearCookie('jwt');
        }
    }
    res.render('register', { error: null });
});

// POST /register — insertion en DB
app.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword, userType, terms } = req.body;

    if (!terms) return res.render('register', { error: 'Vous devez accepter les conditions d\'utilisation' });
    if (password !== confirmPassword) return res.render('register', { error: 'Les mots de passe ne correspondent pas' });

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) return res.render('register', { error: 'Cet email est déjà utilisé' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO users (name, email, password, phone, type) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, phone, userType]
    );

    const newUserId = result.insertId;

    const token = jwt.sign(
      { id: newUserId, email, type: userType, name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.redirect(userType === 'owner' ? '/owner/dashboard' : '/client/dashboard');
  } catch (error) {
    console.error('Erreur d\'inscription:', error);
    res.render('register', { error: 'Erreur lors de l\'inscription' });
  }
});

app.get('/login', (req, res) => {
    if (req.cookies?.jwt) {
        try {
            const decoded = jwt.verify(req.cookies.jwt, JWT_SECRET);
            return res.redirect(decoded.type === 'owner' ? '/owner/dashboard' : '/client/dashboard');
        } catch (error) {
            res.clearCookie('jwt');
        }
    }
    res.render('login', { error: null });
});

// POST /login — connexion via DB
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query('SELECT id, name, email, password, type, isActive FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.render('login', { error: 'Email ou mot de passe incorrect' });
    }

    const user = rows[0];
    
    // Vérifier si le compte est actif
    if (!user.isActive) {
      return res.render('login', { error: 'Votre compte a été désactivé. Contactez l\'administrateur.' });
    }
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, type: user.type, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    // Redirection selon le type d'utilisateur
    if (user.type === 'admin') {
      res.redirect('/admin/dashboard');
    } else if (user.type === 'owner') {
      res.redirect('/owner/dashboard');
    } else {
      res.redirect('/client/dashboard');
    }
  } catch (error) {
    console.error('Erreur login:', error);
    res.render('login', { error: 'Erreur lors de la connexion' });
  }
});

// Route pour la déconnexion
app.post('/logout', (req, res) => {
    res.clearCookie('jwt');
    res.json({ success: true });
});

// Routes Client
// GET /client/dashboard — afficher réservations et avis depuis la BDD (mis à jour pour le nouveau dashboard)
app.get('/client/dashboard', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1) Récupérer toutes les salles (pour l'affichage "rooms" dans le dashboard)
    const [roomsRows] = await db.query('SELECT * FROM rooms ORDER BY createdAt DESC');
    const enrichedRooms = roomsRows.map(r => {
      let equipment = [], amenities = [];
      try { equipment = r.equipment ? JSON.parse(r.equipment) : []; } catch (e) {}
      try { amenities = r.amenities ? JSON.parse(r.amenities) : []; } catch (e) {}
      
      // Valeurs par défaut pour les coordonnées
      if (r.lat === null || r.lat === undefined) r.lat = 36.7538;
      if (r.lng === null || r.lng === undefined) r.lng = 3.0588;
      
      return { ...r, equipment, amenities };
    });

    // 2) Récupérer les réservations de l'utilisateur (avec infos room)
    const [bookRows] = await db.query(
      `SELECT b.*, r.id AS roomId, r.name AS room_name, r.price AS room_price, r.image AS room_image, r.wilaya AS room_wilaya
       FROM bookings b
       JOIN rooms r ON b.roomId = r.id
       WHERE b.userId = ?
       ORDER BY b.startDate DESC`,
      [userId]
    );

    // Séparer réservations en "current" et "past" selon la date de fin
    const today = new Date();
    today.setHours(0,0,0,0);

    const currentBookings = [];
    const pastBookings = [];

    bookRows.forEach(b => {
      const booking = {
        id: b.id,
        startDate: b.startDate,
        endDate: b.endDate,
        participants: b.participants,
        purpose: b.purpose,
        totalPrice: b.totalPrice,
        status: b.status,
        room: {
          id: b.roomId,
          name: b.room_name,
          price: b.room_price,
          wilaya: b.room_wilaya,
          image: b.room_image
        }
      };

      const end = new Date(b.endDate);
      end.setHours(0,0,0,0);
      if (end < today) {
        pastBookings.push(booking);
      } else {
        currentBookings.push(booking);
      }
    });

    // 3) Récupérer les avis de l'utilisateur depuis la BD (avec roomName si possible)
    const [reviewRows] = await db.query(
      `SELECT rv.*, r.name AS roomName
       FROM reviews rv
       LEFT JOIN rooms r ON rv.roomId = r.id
       WHERE rv.userId = ?
       ORDER BY rv.date DESC`,
      [userId]
    );

    const userReviews = reviewRows.map(r => ({
      id: r.id,
      bookingId: r.bookingId,
      roomId: r.roomId,
      roomName: r.roomName || 'Salle inconnue',
      userId: r.userId,            // inclus pour sécurité côté template
      rating: r.rating,
      comment: r.comment,
      date: r.date,
      isApproved: !!r.isApproved
    }));

    // 4) Compteurs simples fournis au template pour éviter calculs côté EJS
    const roomsCount = enrichedRooms.length;
    const currentBookingsCount = currentBookings.length;
    const reviewsCount = userReviews.length;

    // 5) Rendu : passer tout ce dont le nouveau dashboard a besoin
    res.render('client/dashboard', {
      user: req.user,
      rooms: enrichedRooms,
      currentBookings,
      pastBookings,
      reviews: userReviews,
      // compteurs
      roomsCount,
      currentBookingsCount,
      reviewsCount
    });
  } catch (error) {
    console.error('Erreur dashboard client:', error);
    res.status(500).render('error', {
      message: 'Erreur lors du chargement du tableau de bord',
      error: error
    });
  }
});


// GET /rooms/:id/book -> redirige vers le détail /rooms/:id (affiche le formulaire)
app.get('/rooms/:id/book', (req, res) => {
  res.redirect(`/rooms/${req.params.id}`);
});

// ------------ROUTES ADMIN

// GET /admin/dashboard — afficher le panneau d'administration
app.get('/admin/dashboard', verifyToken, isAdmin, async (req, res) => {
  try {
    // Récupérer les filtres
    const { search, type, status, view } = req.query;
    
    // Construire la requête SQL avec filtres
    let whereParts = [];
    let params = [];
    
    if (search) {
      whereParts.push('(name LIKE ? OR email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (type) {
      whereParts.push('type = ?');
      params.push(type);
    }
    
    if (status === 'active') {
      whereParts.push('isActive = 1');
    } else if (status === 'inactive') {
      whereParts.push('isActive = 0');
    }
    
    const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    
    // Récupérer les utilisateurs
    const [users] = await db.query(
      `SELECT id, name, email, phone, type, isActive, createdAt, updatedAt 
       FROM users ${whereSql} ORDER BY createdAt DESC`,
      params
    );
    
    // Récupérer les salles pour la vue admin
    const [roomsRows] = await db.query('SELECT * FROM rooms ORDER BY createdAt DESC');
    const rooms = roomsRows.map(r => {
      let equipment = [], amenities = [];
      try { equipment = r.equipment ? JSON.parse(r.equipment) : []; } catch (e) {}
      try { amenities = r.amenities ? JSON.parse(r.amenities) : []; } catch (e) {}
      return { ...r, equipment, amenities };
    });
    
    // Récupérer les avis pour la modération
    const [reviewsRows] = await db.query(`
      SELECT r.*, u.name as userName, rm.name as roomName 
      FROM reviews r 
      LEFT JOIN users u ON r.userId = u.id 
      LEFT JOIN rooms rm ON r.roomId = rm.id 
      ORDER BY r.date DESC
    `);
    const reviews = reviewsRows.map(r => ({
      ...r,
      date: r.date,
      isApproved: !!r.isApproved
    }));
    
    // Récupérer les statistiques
    const [
      [totalUsersRow],
      [activeUsersRow],
      [inactiveUsersRow],
      [totalClientsRow],
      [totalOwnersRow],
      [totalAdminsRow],
      [totalRoomsRow],
      [totalReviewsRow],
      [pendingReviewsRow],
      [approvedReviewsRow]
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM users'),
      db.query('SELECT COUNT(*) AS count FROM users WHERE isActive = 1'),
      db.query('SELECT COUNT(*) AS count FROM users WHERE isActive = 0'),
      db.query('SELECT COUNT(*) AS count FROM users WHERE type = "client"'),
      db.query('SELECT COUNT(*) AS count FROM users WHERE type = "owner"'),
      db.query('SELECT COUNT(*) AS count FROM users WHERE type = "admin"'),
      db.query('SELECT COUNT(*) AS count FROM rooms'),
      db.query('SELECT COUNT(*) AS count FROM reviews'),
      db.query('SELECT COUNT(*) AS count FROM reviews WHERE isApproved = 0'),
      db.query('SELECT COUNT(*) AS count FROM reviews WHERE isApproved = 1')
    ]);
    
    const stats = {
      totalUsers: totalUsersRow[0].count,
      activeUsers: activeUsersRow[0].count,
      inactiveUsers: inactiveUsersRow[0].count,
      totalClients: totalClientsRow[0].count,
      totalOwners: totalOwnersRow[0].count,
      totalAdmins: totalAdminsRow[0].count,
      totalRooms: totalRoomsRow[0].count,
      totalReviews: totalReviewsRow[0].count,
      pendingReviews: pendingReviewsRow[0].count,
      approvedReviews: approvedReviewsRow[0].count
    };
    
    // Messages de succès/erreur via query params
    const success = req.query.success;
    const error = req.query.error;
    
    res.render('admin/dashboard', {
      user: req.user,
      users,
      rooms,
      reviews,
      stats,
      filters: { search, type, status, view },
      success,
      error,
      activePage: 'admin-dashboard'
    });
  } catch (err) {
    console.error('Erreur admin dashboard:', err);
    res.status(500).send('Erreur serveur');
  }
});

// POST /admin/users/:id/activate — activer un compte utilisateur
app.post('/admin/users/:id/activate', verifyToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    // Vérifier que l'utilisateur existe
    const [users] = await db.query('SELECT id, type FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.redirect('/admin/dashboard?error=' + encodeURIComponent('Utilisateur non trouvé'));
    }
    
    // Empêcher la modification de son propre compte
    if (userId === req.user.id) {
      return res.redirect('/admin/dashboard?error=' + encodeURIComponent('Vous ne pouvez pas modifier votre propre compte'));
    }
    
    // Activer le compte
    await db.query('UPDATE users SET isActive = 1 WHERE id = ?', [userId]);
    
    res.redirect('/admin/dashboard?success=' + encodeURIComponent('Compte activé avec succès'));
  } catch (err) {
    console.error('Erreur activation compte:', err);
    res.redirect('/admin/dashboard?error=' + encodeURIComponent('Erreur lors de l\'activation'));
  }
});

// POST /admin/users/:id/deactivate — désactiver un compte utilisateur
app.post('/admin/users/:id/deactivate', verifyToken, isAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    // Vérifier que l'utilisateur existe
    const [users] = await db.query('SELECT id, type FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.redirect('/admin/dashboard?error=' + encodeURIComponent('Utilisateur non trouvé'));
    }
    
    // Empêcher la désactivation de son propre compte
    if (userId === req.user.id) {
      return res.redirect('/admin/dashboard?error=' + encodeURIComponent('Vous ne pouvez pas désactiver votre propre compte'));
    }
    
    // Désactiver le compte
    await db.query('UPDATE users SET isActive = 0 WHERE id = ?', [userId]);
    
    res.redirect('/admin/dashboard?success=' + encodeURIComponent('Compte désactivé avec succès'));
  } catch (err) {
    console.error('Erreur désactivation compte:', err);
    res.redirect('/admin/dashboard?error=' + encodeURIComponent('Erreur lors de la désactivation'));
  }
});

// POST /admin/rooms/:id/delete — supprimer une salle (admin)
app.post('/admin/rooms/:id/delete', verifyToken, isAdmin, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (Number.isNaN(roomId)) {
      return res.redirect('/admin/dashboard?view=rooms&error=' + encodeURIComponent('ID de salle invalide'));
    }

    // Récupérer la salle pour l'image
    const [rows] = await db.query('SELECT id, image, name FROM rooms WHERE id = ?', [roomId]);
    if (rows.length === 0) {
      return res.redirect('/admin/dashboard?view=rooms&error=' + encodeURIComponent('Salle non trouvée'));
    }

    const room = rows[0];

    // Supprimer l'image si ce n'est pas l'image par défaut
    const imagePath = room.image || '/images/default-room.jpg';
    if (imagePath && imagePath !== '/images/default-room.jpg') {
      const filePath = path.join(__dirname, 'public', imagePath.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.warn('Impossible de supprimer l\'image:', e); }
      }
    }

    // Supprimer les avis associés
    await db.query('DELETE FROM reviews WHERE roomId = ?', [roomId]);
    
    // Supprimer les réservations associées
    await db.query('DELETE FROM bookings WHERE roomId = ?', [roomId]);

    // Supprimer la salle
    await db.query('DELETE FROM rooms WHERE id = ?', [roomId]);

    res.redirect('/admin/dashboard?view=rooms&success=' + encodeURIComponent('Salle "' + room.name + '" supprimée avec succès'));
  } catch (err) {
    console.error('Erreur suppression salle (admin):', err);
    res.redirect('/admin/dashboard?view=rooms&error=' + encodeURIComponent('Erreur lors de la suppression de la salle'));
  }
});

// POST /admin/reviews/:id/approve — approuver un avis
app.post('/admin/reviews/:id/approve', verifyToken, isAdmin, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id, 10);
    
    // Vérifier que l'avis existe
    const [rows] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
    if (rows.length === 0) {
      return res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Avis non trouvé'));
    }
    
    // Approuver l'avis
    await db.query('UPDATE reviews SET isApproved = 1 WHERE id = ?', [reviewId]);
    
    res.redirect('/admin/dashboard?view=reviews&success=' + encodeURIComponent('Avis approuvé avec succès'));
  } catch (err) {
    console.error('Erreur approbation avis:', err);
    res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Erreur lors de l\'approbation de l\'avis'));
  }
});

// POST /admin/reviews/:id/reject — rejeter un avis
app.post('/admin/reviews/:id/reject', verifyToken, isAdmin, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id, 10);
    
    // Vérifier que l'avis existe
    const [rows] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
    if (rows.length === 0) {
      return res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Avis non trouvé'));
    }
    
    // Supprimer l'avis rejeté
    await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
    
    res.redirect('/admin/dashboard?view=reviews&success=' + encodeURIComponent('Avis rejeté et supprimé'));
  } catch (err) {
    console.error('Erreur rejet avis:', err);
    res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Erreur lors du rejet de l\'avis'));
  }
});

// POST /admin/reviews/:id/delete — supprimer un avis
app.post('/admin/reviews/:id/delete', verifyToken, isAdmin, async (req, res) => {
  console.log('DELETE REVIEW ROUTE CALLED with id:', req.params.id);
  try {
    const reviewId = parseInt(req.params.id, 10);
    
    // Vérifier que l'avis existe
    const [rows] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
    if (rows.length === 0) {
      return res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Avis non trouvé'));
    }
    
    // Supprimer l'avis
    await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
    
    res.redirect('/admin/dashboard?view=reviews&success=' + encodeURIComponent('Avis supprimé avec succès'));
  } catch (err) {
    console.error('Erreur suppression avis:', err);
    res.redirect('/admin/dashboard?view=reviews&error=' + encodeURIComponent('Erreur lors de la suppression de l\'avis'));
  }
});

// Routes Owner

app.get('/owner/dashboard', verifyToken, isOwner, async (req, res) => {
  try {
    const ownerId = req.user.id;

    const [roomsRows] = await db.query('SELECT * FROM rooms WHERE ownerId = ? ORDER BY createdAt DESC', [ownerId]);

    const enrichedRooms = roomsRows.map(r => {
      let equipment = [], amenities = [];
      try { equipment = r.equipment ? JSON.parse(r.equipment) : []; } catch (e) {}
      try { amenities = r.amenities ? JSON.parse(r.amenities) : []; } catch (e) {}
      return { ...r, equipment, amenities };
    });

    res.render('owner/dashboard', {
      user: req.user,
      rooms: enrichedRooms
    });
  } catch (error) {
    console.error('Erreur dashboard owner:', error);
    res.status(500).render('error', {
      message: 'Erreur lors du chargement du tableau de bord propriétaire',
      error: error
    });
  }
});

app.get('/owner/add-room', verifyToken, isOwner, (req, res) => {
    res.render('owner/add-room');
});

// POST /owner/add-room — insérer une nouvelle salle
app.post('/owner/add-room', verifyToken, isOwner, upload.single('image'), async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { name, description, capacity, price, location, wilaya, lat, lng } = req.body;

    const equipmentArray = req.body.equipment ? (Array.isArray(req.body.equipment) ? req.body.equipment : [req.body.equipment]) : [];
    const amenitiesArray = req.body.amenities ? (Array.isArray(req.body.amenities) ? req.body.amenities : [req.body.amenities]) : [];

    const imagePath = req.file ? `/uploads/${req.file.filename}` : '/images/default-room.jpg';

    await db.query(
      `INSERT INTO rooms (ownerId, name, description, capacity, price, image, location, wilaya, lat, lng, equipment, amenities)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ownerId, name, description, capacity, price, imagePath, location, wilaya, (lat !== undefined && lat !== null && lat !== '') ? lat : 36.7538, (lng !== undefined && lng !== null && lng !== '') ? lng : 3.0588, JSON.stringify(equipmentArray), JSON.stringify(amenitiesArray)]
    );

    res.redirect('/owner/dashboard');
  } catch (error) {
    console.error('Erreur add room:', error);
    res.status(500).send('Erreur serveur');
  }
});

// GET /owner/edit-room/:id — afficher formulaire d'édition (à ajouter)
app.get('/owner/edit-room/:id', verifyToken, isOwner, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    const [rows] = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (rows.length === 0) return res.status(404).send('Salle non trouvée');

    const roomRow = rows[0];
    // Vérif d'appartenance : only owner can edit
    if (roomRow.ownerId !== null && roomRow.ownerId !== req.user.id) {
      return res.status(403).send('Accès refusé');
    }

    // Parse JSON fields si besoin
    let equipment = [], amenities = [];
    try { equipment = roomRow.equipment ? JSON.parse(roomRow.equipment) : []; } catch(e){}
    try { amenities = roomRow.amenities ? JSON.parse(roomRow.amenities) : []; } catch(e){}

    // Valeurs par défaut pour les coordonnées si elles sont nulles ou invalides
    roomRow.lat = parseFloat(roomRow.lat) || 36.7538;
    roomRow.lng = parseFloat(roomRow.lng) || 3.0588;

    const room = { ...roomRow, equipment, amenities };
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.render('owner/edit-room', { room });
  } catch (err) {
    console.error('Erreur GET edit-room:', err);
    res.status(500).send('Erreur serveur');
  }
});

// POST /owner/edit-room/:id 
// POST /owner/edit-room/:id — mise à jour en base (avec location & wilaya)
app.post('/owner/edit-room/:id', verifyToken, isOwner, upload.any(), async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    const [roomRows] = await db.query('SELECT ownerId, image, lat, lng FROM rooms WHERE id = ?', [roomId]);
    if (roomRows.length === 0) return res.status(404).send('Salle non trouvée');

    const current = roomRows[0];
    if (current.ownerId !== req.user.id) return res.status(403).send('Accès refusé');

    const { name, description, capacity, price, location, wilaya, lat, lng } = req.body;
    console.log('DEBUG: req.body complet:', JSON.stringify(req.body, null, 2));
    console.log('DEBUG: Valeurs extraites - lat:', lat, 'lng:', lng, 'types:', typeof lat, typeof lng);

    // Utiliser les valeurs actuelles si les nouvelles ne sont pas fournies
    const newLat = (lat !== undefined && lat !== null && lat !== '') ? parseFloat(lat) : parseFloat(current.lat || 36.7538);
    const newLng = (lng !== undefined && lng !== null && lng !== '') ? parseFloat(lng) : parseFloat(current.lng || 3.0588);

    console.log('DEBUG: Nouvelles valeurs - newLat:', newLat, 'newLng:', newLng);

    const equipmentArray = req.body.equipment ? (Array.isArray(req.body.equipment) ? req.body.equipment : [req.body.equipment]) : [];
    const amenitiesArray = req.body.amenities ? (Array.isArray(req.body.amenities) ? req.body.amenities : [req.body.amenities]) : [];

    let imagePath = current.image || '/images/default-room.jpg';
    const imageFile = req.files ? req.files.find(f => f.fieldname === 'image') : null;
    if (imageFile) {
      if (imagePath && imagePath !== '/images/default-room.jpg') {
        const oldImagePath = path.join(__dirname, 'public', imagePath.replace(/^\//, ''));
        if (fs.existsSync(oldImagePath)) {
          try { fs.unlinkSync(oldImagePath); } catch (e) { console.warn(e); }
        }
      }
      imagePath = `/uploads/${imageFile.filename}`;
    }

    await db.query(
      `UPDATE rooms SET name = ?, description = ?, capacity = ?, price = ?, image = ?, location = ?, wilaya = ?, lat = ?, lng = ?, equipment = ?, amenities = ?
       WHERE id = ?`,
      [
        name,
        description,
        parseInt(capacity || 0, 10),
        parseFloat(price || 0),
        imagePath,
        location,
        wilaya,
        newLat,
        newLng,
        JSON.stringify(equipmentArray),
        JSON.stringify(amenitiesArray),
        roomId
      ]
    );

    console.log('DEBUG: UPDATE exécuté pour roomId:', roomId);

    // Vérifier la mise à jour
    const [checkRows] = await db.query('SELECT lat, lng FROM rooms WHERE id = ?', [roomId]);
    console.log('DEBUG: Valeurs après UPDATE:', checkRows[0]);

    res.redirect('/owner/dashboard?updated=1');
  } catch (err) {
    console.error('Erreur POST edit-room:', err);
    res.status(500).send('Erreur serveur');
  }
});

// POST /owner/delete-room/:id — supprimer une salle (BDD + image)
app.post('/owner/delete-room/:id', verifyToken, isOwner, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (Number.isNaN(roomId)) return res.status(400).send('ID invalide');

    // Récupérer la salle pour vérifier ownerId et image
    const [rows] = await db.query('SELECT ownerId, image FROM rooms WHERE id = ?', [roomId]);
    if (rows.length === 0) return res.status(404).send('Salle non trouvée');

    const room = rows[0];

    // Vérifier l'appartenance
    if (room.ownerId !== req.user.id) {
      return res.status(403).send('Accès refusé');
    }

    // Supprimer l'image si ce n'est pas l'image par défaut
    const imagePath = room.image || '/images/default-room.jpg';
    if (imagePath && imagePath !== '/images/default-room.jpg') {
      const filePath = path.join(__dirname, 'public', imagePath.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.warn('Impossible de supprimer l\'image:', e); }
      }
    }

    // Supprimer la salle (les contraintes FK doivent gérer bookings/reviews si configurées)
    await db.query('DELETE FROM rooms WHERE id = ?', [roomId]);

    res.redirect('/owner/dashboard?deleted=1');
  } catch (err) {
    console.error('Erreur delete-room:', err);
    res.status(500).send('Erreur serveur');
  }
});


// GET /bookings/:id/review — afficher le formulaire d'avis (lecture depuis la BDD)
app.get('/bookings/:id/review', verifyToken, isClient, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    // Récupérer la réservation et la salle jointe (s'assure que la réservation appartient à l'utilisateur)
    const [rows] = await db.query(
      `SELECT b.*, r.id AS roomId, r.name AS roomName, r.image AS roomImage, r.wilaya AS roomWilaya, r.price AS roomPrice
       FROM bookings b
       JOIN rooms r ON b.roomId = r.id
       WHERE b.id = ? AND b.userId = ?`,
      [bookingId, userId]
    );

    if (!rows || rows.length === 0) {
      return res.redirect('/client/dashboard');
    }

    const b = rows[0];
    // Construire des objets plus simples pour la vue
    const booking = {
      id: b.id,
      roomId: b.roomId,
      userId: b.userId,
      startDate: b.startDate,
      endDate: b.endDate,
      participants: b.participants,
      purpose: b.purpose,
      totalPrice: b.totalPrice,
      status: b.status
    };

    const room = {
      id: b.roomId,
      name: b.roomName,
      image: b.roomImage,
      wilaya: b.roomWilaya,
      price: b.roomPrice
    };

    res.render('reviews/create', { booking, room });
  } catch (err) {
    console.error('Erreur GET booking review:', err);
    res.redirect('/client/dashboard');
  }
});

// Route POST - Sauvegarder l'avis
// POST /bookings/:id/review — laisser un avis
app.post('/bookings/:id/review', verifyToken, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const { rating, comment } = req.body;
    const userId = req.user.id;

    const [bookRows] = await db.query('SELECT * FROM bookings WHERE id = ? AND userId = ?', [bookingId, userId]);
    if (bookRows.length === 0) return res.redirect('/client/dashboard');

    const [existRows] = await db.query('SELECT id FROM reviews WHERE bookingId = ?', [bookingId]);
    if (existRows.length > 0) return res.redirect('/client/dashboard');

    const roomId = bookRows[0].roomId;

    const [userRows] = await db.query('SELECT name FROM users WHERE id = ?', [userId]);
    const userName = userRows.length ? userRows[0].name : null;
    const [roomRows] = await db.query('SELECT name FROM rooms WHERE id = ?', [roomId]);
    const roomName = roomRows.length ? roomRows[0].name : null;

    await db.query(
      `INSERT INTO reviews (bookingId, roomId, userId, userName, roomName, rating, comment, isApproved)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [bookingId, roomId, userId, userName, roomName, parseInt(rating,10), comment]
    );

    res.redirect('/client/dashboard');
  } catch (error) {
    console.error('Erreur review:', error);
    res.redirect('/client/dashboard');
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
