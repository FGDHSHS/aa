const express = require('express');
const session = require('express-session');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Database setup
const db = new sqlite3('ecommerce.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user'
  );
  
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    image_url TEXT
  );
`);

// Insert sample data
const insertSampleData = () => {
  // Insert admin user if not exists
  const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run('admin', 'admin123', 'admin@shop.com', 'admin');
    db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)').run('user1', 'password1', 'user1@example.com');
    db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)').run('user2', 'password2', 'user2@example.com');
  }

  // Insert 100 products
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (productCount.count === 0) {
    const insertProduct = db.prepare('INSERT INTO products (name, price, description, image_url) VALUES (?, ?, ?, ?)');
    
    const categories = ['هاتف', 'حاسوب', 'سماعات', 'ساعة', 'كاميرا', 'طابعة', 'مكبر صوت', 'شاشة', 'فأرة', 'لوحة مفاتيح'];
    
    for (let i = 1; i <= 100; i++) {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const name = `${category} ${i} Pro`;
      const price = (Math.random() * 1000 + 50).toFixed(2);
      const description = `منتج ممتاز ${category} مع ميزات رائعة وجودة عالية`;
      const image_url = `https://via.placeholder.com/300x300?text=Product+${i}`;
      
      insertProduct.run(name, price, description, image_url);
    }
  }
};

insertSampleData();

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
    const user = db.prepare(query).get();
    
    if (user) {
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
  
  const products = db.prepare('SELECT * FROM products LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  
  res.json({ 
    success: true, 
    products,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page
  });
});

// Get user profile - IDOR vulnerability
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  
  // No authentication check or authorization
  const user = db.prepare('SELECT id, username, email, role, password FROM users WHERE id = ?').get(userId);
  
  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
});

// Update user profile
app.put('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  const { email } = req.body;
  
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
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

app.listen(PORT, () => {
  console.log(`المتجر الإلكتروني يعمل على http://localhost:${PORT}`);
  console.log('تم إنشاء 100 منتج وقاعدة بيانات المستخدمين');
  console.log('اختبر مهاراتك في اكتشاف الثغرات الأمنية!');
});
