const express = require('express');
const session = require('express-session');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

let db;

// Database setup
async function initializeDatabase() {
  const SQL = await initSqlJs();
  
  // Load or create database
  if (fs.existsSync('ecommerce.db')) {
    const fileBuffer = fs.readFileSync('ecommerce.db');
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'user'
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT,
      image_url TEXT
    )
  `);
  
  // Insert sample data
  const adminExists = db.exec("SELECT * FROM users WHERE username = 'admin'");
  if (adminExists.length === 0 || adminExists[0].values.length === 0) {
    db.run("INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)", 
      ['admin', 'admin123', 'admin@shop.com', 'admin']);
    db.run("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", 
      ['user1', 'password1', 'user1@example.com']);
    db.run("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", 
      ['user2', 'password2', 'user2@example.com']);
  }
  
  // Insert 100 products
  const productCount = db.exec("SELECT COUNT(*) as count FROM products");
  if (productCount[0].values[0][0] === 0) {
    const categories = ['هاتف', 'حاسوب', 'سماعات', 'ساعة', 'كاميرا', 'طابعة', 'مكبر صوت', 'شاشة', 'فأرة', 'لوحة مفاتيح'];
    
    for (let i = 1; i <= 100; i++) {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const name = `${category} ${i} Pro`;
      const price = (Math.random() * 1000 + 50).toFixed(2);
      const description = `منتج ممتاز ${category} مع ميزات رائعة وجودة عالية`;
      const image_url = `https://via.placeholder.com/300x300?text=Product+${i}`;
      
      db.run("INSERT INTO products (name, price, description, image_url) VALUES (?, ?, ?, ?)",
        [name, price, description, image_url]);
    }
  }
  
  // Save database to file
  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync('ecommerce.db', buffer);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'super-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 3600000 }
}));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Vulnerable SQL query - SQL Injection
  const query = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
  
  try {
    const result = db.exec(query);
    
    if (result.length > 0 && result[0].values.length > 0) {
      const userData = result[0];
      const user = {
        id: userData.values[0][0],
        username: userData.values[0][1],
        password: userData.values[0][2],
        email: userData.values[0][3],
        role: userData.values[0][4]
      };
      
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      
      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          username: user.username, 
          email: user.email,
          role: user.role 
        },
        sessionId: req.sessionID
      });
    } else {
      res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم: ' + error.message });
  }
});

// Get products
app.get('/api/products', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول أولاً' });
  }
  
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const products = db.exec(`SELECT * FROM products LIMIT ${limit} OFFSET ${offset}`);
  const total = db.exec('SELECT COUNT(*) as count FROM products')[0].values[0][0];
  
  const formattedProducts = products.length > 0 ? products[0].values.map(row => ({
    id: row[0],
    name: row[1],
    price: row[2],
    description: row[3],
    image_url: row[4]
  })) : [];
  
  res.json({ 
    success: true, 
    products: formattedProducts,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page
  });
});

// Get user profile - IDOR vulnerability
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  
  // No authentication check or authorization
  const result = db.exec(`SELECT id, username, email, role, password FROM users WHERE id = ${userId}`);
  
  if (result.length > 0 && result[0].values.length > 0) {
    const user = {
      id: result[0].values[0][0],
      username: result[0].values[0][1],
      email: result[0].values[0][2],
      role: result[0].values[0][3],
      password: result[0].values[0][4]
    };
    res.json({ success: true, user });
  } else {
    res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
});

// Update user profile
app.put('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  const { email } = req.body;
  
  db.run("UPDATE users SET email = ? WHERE id = ?", [email, userId]);
  saveDatabase();
  res.json({ success: true, message: 'تم تحديث الملف الشخصي' });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'تم تسجيل الخروج' });
});

// Check auth status
app.get('/api/check-auth', (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true, 
      user: { 
        id: req.session.userId, 
        username: req.session.username,
        role: req.session.role 
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`المتجر الإلكتروني يعمل على http://localhost:${PORT}`);
    console.log('تم إنشاء 100 منتج وقاعدة بيانات المستخدمين');
    console.log('اختبر مهاراتك في اكتشاف الثغرات الأمنية!');
  });
}).catch(console.error);
