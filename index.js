// 필요한 모듈들을 가져옵니다.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Express 앱을 생성합니다.
const app = express();
const saltRounds = 10;

// 미들웨어를 설정합니다.
app.use(cors());
app.use(express.json());

// 데이터베이스 연결 풀(Pool)을 생성합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ====================================================================
// (가장 중요) 서버 시작 시 데이터베이스 테이블을 자동으로 생성하는 함수
// ====================================================================
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    // 1. notices 테이블 생성 (없을 경우에만)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "notices" is ready.');

    // 2. posts 테이블 생성 (없을 경우에만)
    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "posts" is ready.');
    
    // 3. consultations 테이블 생성 (없을 경우에만)
    await client.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        is_secret BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "consultations" is ready.');

    // 4. replies 테이블 생성 (없을 경우에만)
    await client.query(`
      CREATE TABLE IF NOT EXISTS replies (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "replies" is ready.');

  } catch (err) {
    console.error('Error initializing database:', err.stack);
  } finally {
    client.release();
  }
};


// JWT 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API 라우트 ---

// 서버 상태 확인
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.');
});

// --- 관리자 API ---
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (password === adminPassword) {
    const accessToken = jwt.sign({ username: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ accessToken });
  } else {
    res.status(401).send('비밀번호가 일치하지 않습니다.');
  }
});

app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
  try {
    const noticeResult = await pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 5');
    const consultationResult = await pool.query('SELECT id, title, author, created_at FROM consultations ORDER BY created_at DESC LIMIT 5');
    
    // DB의 snake_case 컬럼명을 프론트엔드의 camelCase로 변환
    const notices = noticeResult.rows.map(n => ({ ...n, createdAt: n.created_at }));
    const consultations = consultationResult.rows.map(c => ({ ...c, createdAt: c.created_at }));

    res.json({ notices, consultations });
  } catch (err) {
    console.error('Error fetching dashboard data:', err.stack);
    res.status(500).json({ error: 'Server error while fetching dashboard data' });
  }
});

// --- 공지사항 API ---
app.get('/api/notices', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM notices');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const notices = result.rows.map(n => ({ ...n, createdAt: n.created_at }));
        res.json({ notices, totalPages });
    } catch (err) {
        console.error('Error fetching notices:', err.stack);
        res.status(500).json({ error: 'Server error while fetching notices' });
    }
});
app.get('/api/notices/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, content, created_at, updated_at FROM notices WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notice not found' });
    const notice = { ...result.rows[0], createdAt: result.rows[0].created_at, updatedAt: result.rows[0].updated_at };
    res.json(notice);
  } catch (err) {
    console.error(`Error fetching notice ${req.params.id}:`, err.stack);
    res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/notices', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query('INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *', [title, content]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating notice:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.put('/api/notices/:id', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query('UPDATE notices SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating notice ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/notices/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting notice ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 온라인 상담 API ---
app.get('/api/consultations', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM consultations');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query(`
            SELECT 
                c.id, c.title, c.author, c.is_secret, c.created_at, 
                EXISTS(SELECT 1 FROM replies r WHERE r.consultation_id = c.id) AS has_reply
            FROM consultations c
            ORDER BY c.created_at DESC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const consultations = result.rows.map(c => ({ 
            id: c.id,
            title: c.title,
            author: c.author,
            isSecret: c.is_secret, 
            createdAt: c.created_at, 
            replyId: c.has_reply ? c.id : null 
        }));
        res.json({ consultations, totalPages });
    } catch (err) {
        console.error('Error fetching consultations:', err.stack);
        res.status(500).json({ error: 'Server error while fetching consultations' });
    }
});
app.post('/api/consultations', async (req, res) => {
    const { title, author, password, content, isSecret } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    try {
        await pool.query('INSERT INTO consultations (title, author, password, content, is_secret) VALUES ($1, $2, $3, $4, $5)', [title, author, hashedPassword, content, isSecret]);
        res.status(201).send('Consultation created');
    } catch (err) {
        console.error('Error creating consultation:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.get('/api/consultations/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.author, c.content, c.created_at, c.is_secret, r.id as reply_id, r.content as reply_content, r.created_at as reply_created_at
            FROM consultations c
            LEFT JOIN replies r ON c.id = r.consultation_id
            WHERE c.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Consultation not found' });
        const data = result.rows[0];
        const consultation = { 
            id: data.id, title: data.title, author: data.author, content: data.content,
            createdAt: data.created_at, isSecret: data.is_secret, 
            replyId: data.reply_id, replyContent: data.reply_content, replyCreatedAt: data.reply_created_at 
        };
        res.json(consultation);
    } catch (err) {
        console.error(`Error fetching consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/consultations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM replies WHERE consultation_id = $1', [req.params.id]);
        await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/api/consultations/:id/reply', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query('INSERT INTO replies (content, consultation_id) VALUES ($1, $2)', [content, req.params.id]);
        res.status(201).send('Reply created');
    } catch (err) {
        console.error(`Error creating reply for consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.put('/api/consultations/replies/:replyId', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query('UPDATE replies SET content = $1, updated_at = NOW() WHERE id = $2', [content, req.params.replyId]);
        res.send('Reply updated');
    } catch (err) {
        console.error(`Error updating reply ${req.params.replyId}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});


// --- 자유게시판 API ---
app.get('/api/posts', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM posts');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, author, created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const posts = result.rows.map(p => ({ ...p, createdAt: p.created_at }));
        res.json({ posts, totalPages });
    } catch (err) {
        console.error('Error fetching posts:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.get('/api/admin/posts', authenticateToken, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM posts');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, author, created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const posts = result.rows.map(p => ({ ...p, createdAt: p.created_at }));
        res.json({ posts, totalPages });
    } catch (err) {
        console.error('Error fetching posts for admin:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting post ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});


// 서버를 시작합니다.
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
  
  // 서버가 시작된 후, 데이터베이스 초기화 함수를 실행합니다.
  await initializeDatabase();
});

