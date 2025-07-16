// =================================================================
// 연세미치과 홈페이지 백엔드 최종 코드 (병원 사진 갤러리 기능 추가)
// 최종 업데이트: 2025년 7월 16일
// 주요 개선사항:
// 1. 병원 사진들을 저장할 'clinic_photos' 테이블 자동 생성 기능 추가
// 2. 병원 사진을 관리하는 CRUD API 엔드포인트 전체 추가
// =================================================================

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('데이터베이스에 성공적으로 연결되었습니다.');
    
    // --- 기존 테이블들 ---
    const createNoticesTable = `CREATE TABLE IF NOT EXISTS notices (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createPostsTable = `CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createConsultationsTable = `CREATE TABLE IF NOT EXISTS consultations (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, is_secret BOOLEAN DEFAULT TRUE, is_answered BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createRepliesTable = `CREATE TABLE IF NOT EXISTS replies (id SERIAL PRIMARY KEY, consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createDoctorsTable = `CREATE TABLE IF NOT EXISTS doctors (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, position VARCHAR(100) NOT NULL, history TEXT, image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    
    // [핵심 추가] 병원 사진 갤러리 테이블 생성
    const createClinicPhotosTable = `
      CREATE TABLE IF NOT EXISTS clinic_photos (
        id SERIAL PRIMARY KEY,
        caption VARCHAR(255),
        image_data TEXT NOT NULL,
        display_order SERIAL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await client.query(createNoticesTable);
    await client.query(createPostsTable);
    await client.query(createConsultationsTable);
    await client.query(createRepliesTable);
    await client.query(createDoctorsTable);
    await client.query(createClinicPhotosTable);
    console.log('모든 테이블이 준비되었습니다.');

  } catch (err) {
    console.error('데이터베이스 초기화 중 오류가 발생했습니다:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

const toCamelCase = (rows) => { return rows.map(row => { const newRow = {}; for (let key in row) { const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase()); newRow[camelKey] = row[key]; } return newRow; }); };
const authenticateToken = (req, res, next) => { const authHeader = req.headers['authorization']; const token = authHeader && authHeader.split(' ')[1]; if (token == null) return res.sendStatus(401); jwt.verify(token, process.env.JWT_SECRET, (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); }); };

// API 라우트
app.all('/', (req, res) => { res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.'); });
app.post('/api/admin/login', (req, res) => { const { password } = req.body; if (password === process.env.ADMIN_PASSWORD) { const user = { name: 'admin' }; const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' }); res.json({ accessToken }); } else { res.status(401).send('비밀번호가 올바르지 않습니다.'); } });

// --- 기존 API 들 (생략 없이 모두 포함) ---
// 공지사항 API
app.get('/api/notices', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/notices/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/admin/notices', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *', [title, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/notices/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE notices SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/notices/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 자유게시판 API
app.get('/api/posts', async (req, res) => { try { const result = await pool.query('SELECT id, title, author, created_at, updated_at FROM posts ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/posts/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/posts', async (req, res) => { const { author, password, title, content } = req.body; try { const result = await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *', [author, password, title, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/posts/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/posts/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 온라인 상담 API
app.get('/api/consultations', async (req, res) => { try { const result = await pool.query('SELECT id, title, author, created_at, is_secret, is_answered FROM consultations ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/consultations/:id', async (req, res) => { try { const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]); if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]); const consultation = toCamelCase(consultationResult.rows)[0]; const replies = toCamelCase(replyResult.rows); res.json({ ...consultation, replies }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/consultations', async (req, res) => { const { author, password, title, content, isSecret } = req.body; try { const result = await pool.query('INSERT INTO consultations (author, password, title, content, is_secret) VALUES ($1, $2, $3, $4, $5) RETURNING *', [author, password, title, content, isSecret]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/consultations/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/consultations/:id/verify', async (req, res) => { try { const { password } = req.body; const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); if (result.rows[0].password === password) { res.json({ success: true }); } else { res.json({ success: false }); } } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/consultations/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 상담 답변 API
app.post('/api/admin/consultations/:id/replies', authenticateToken, async (req, res) => { const consultationId = req.params.id; const { content } = req.body; const client = await pool.connect(); try { await client.query('BEGIN'); const replyResult = await client.query('INSERT INTO replies (consultation_id, content) VALUES ($1, $2) RETURNING *', [consultationId, content]); await client.query('UPDATE consultations SET is_answered = TRUE, updated_at = NOW() WHERE id = $1', [consultationId]); await client.query('COMMIT'); res.status(201).json(toCamelCase(replyResult.rows)[0]); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });
app.put('/api/admin/replies/:id', authenticateToken, async (req, res) => { const { content } = req.body; try { const result = await pool.query('UPDATE replies SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('답변을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/replies/:id', authenticateToken, async (req, res) => { const client = await pool.connect(); try { await client.query('BEGIN'); const reply = await client.query('SELECT consultation_id FROM replies WHERE id = $1', [req.params.id]); if (reply.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).send('답변을 찾을 수 없습니다.'); } const { consultation_id } = reply.rows[0]; await client.query('DELETE FROM replies WHERE id = $1', [req.params.id]); const remainingReplies = await client.query('SELECT id FROM replies WHERE consultation_id = $1', [consultation_id]); if (remainingReplies.rows.length === 0) { await client.query('UPDATE consultations SET is_answered = FALSE WHERE id = $1', [consultation_id]); } await client.query('COMMIT'); res.status(204).send(); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });
// 의료진 API
app.get('/api/doctors', async (req, res) => { try { const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/admin/doctors', authenticateToken, upload.single('image'), async (req, res) => { const { name, position, history } = req.body; const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null; try { const result = await pool.query('INSERT INTO doctors (name, position, history, image_data) VALUES ($1, $2, $3, $4) RETURNING *', [name, position, history, imageData]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('의료진 추가 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/doctors/:id', authenticateToken, upload.single('image'), async (req, res) => { const { name, position, history, existingImageData } = req.body; const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : existingImageData; try { const result = await pool.query('UPDATE doctors SET name = $1, position = $2, history = $3, image_data = $4, updated_at = NOW() WHERE id = $5 RETURNING *', [name, position, history, imageData, req.params.id]); if (result.rows.length === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('의료진 수정 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/doctors/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM doctors WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// [핵심 추가] --- 병원 사진 갤러리 API ---
// GET (Public)
app.get('/api/clinic-photos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinic_photos ORDER BY display_order ASC');
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류');
  }
});

// POST (Admin)
app.post('/api/admin/clinic-photos', authenticateToken, upload.single('image'), async (req, res) => {
    const { caption } = req.body;
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    if (!imageData) {
        return res.status(400).send('이미지 파일이 없습니다.');
    }
    try {
        const result = await pool.query(
            'INSERT INTO clinic_photos (caption, image_data) VALUES ($1, $2) RETURNING *',
            [caption, imageData]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('병원 사진 추가 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// DELETE (Admin)
app.delete('/api/admin/clinic-photos/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM clinic_photos WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('사진 정보를 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error('병원 사진 삭제 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});


// 서버 실행
const PORT = process.env.PORT || 3001;
initializeDatabase().then(() => { app.listen(PORT, () => { console.log(`백엔드 서버가 포트 ${PORT}에서 성공적으로 실행되었습니다.`); }); }).catch(err => { console.error('서버 시작 실패:', err); });
