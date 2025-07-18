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
const bcrypt = require('bcrypt'); // [핵심 수정] 암호화 라이브러리 정상적으로 import

const app = express();

// --- CORS 설정 (이 부분을 수정 또는 추가해야 합니다) ---

// 허용할 프론트엔드 주소를 정확하게 명시합니다.
const corsOptions = {
  origin: 'https://yondentalclinic.vercel.app', // Vercel 프론트엔드 주소
  credentials: true, // 자격 증명(쿠키, 인증 헤더 등)을 포함한 요청을 허용
};

// 수정된 CORS 옵션을 Express 앱에 적용합니다.
app.use(cors(corsOptions));


app.set('trust proxy', true); // Render.com 프록시 환경에서 정확한 IP를 얻기 위해 필요
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const saltRounds = 10; // [핵심 수정] bcrypt의 saltRounds 설정

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
    const createNoticesTable = `CREATE TABLE IF NOT EXISTS notices (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const alterNoticesTable = `ALTER TABLE notices ADD COLUMN IF NOT EXISTS category VARCHAR(100);`;
    const createPostsTable = `CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createConsultationsTable = `CREATE TABLE IF NOT EXISTS consultations (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, is_secret BOOLEAN DEFAULT TRUE, is_answered BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createRepliesTable = `CREATE TABLE IF NOT EXISTS replies (id SERIAL PRIMARY KEY, consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createDoctorsTable = `CREATE TABLE IF NOT EXISTS doctors (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, position VARCHAR(100) NOT NULL, history TEXT, image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    
    // [핵심 추가] 병원소개 콘텐츠 테이블 생성
    const createAboutContentTable = `
      CREATE TABLE IF NOT EXISTS about_content (
        id INT PRIMARY KEY DEFAULT 1,
        title TEXT,
        subtitle TEXT,
        content TEXT,
        image_data TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    const insertDefaultAboutContent = `
      INSERT INTO about_content (id, title, subtitle, content)
      VALUES (1, '연세미치과 이야기', '환자 한 분 한 분의 건강한 미소를 위해, 저희는 보이지 않는 곳까지 정성을 다합니다.', '연세미치과는 단순히 아픈 곳을 치료하는 것을 넘어, 환자분들의 삶의 질을 높이는 것을 목표로 합니다.')
      ON CONFLICT (id) DO NOTHING;
    `;




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

    // [핵심 추가] 자유게시판 댓글 테이블 생성
    const createPostCommentsTable = `
      CREATE TABLE IF NOT EXISTS post_comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        tags TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // ALTER TABLE을 사용하여 기존 테이블에 컬럼이 없으면 추가
    const alterCommentsTableLikes = `ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;`;
    const alterCommentsTableTags = `ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS tags TEXT;`;
    
    // [핵심 추가] 예약 정보 테이블 생성
    const createReservationsTable = `
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        patient_name VARCHAR(100) NOT NULL,
        phone_number VARCHAR(100) NOT NULL,
        desired_date DATE NOT NULL,
        desired_time VARCHAR(50) NOT NULL,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, completed, cancelled
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;


    // [핵심 추가] 치료 전후 사진 갤러리 테이블 생성
    const createCasePhotosTable = `
      CREATE TABLE IF NOT EXISTS case_photos (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        before_image_data TEXT,
        after_image_data TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // [핵심 추가] FAQ 테이블 생성
    const createFaqsTable = `
      CREATE TABLE IF NOT EXISTS faqs (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

     // [핵심 추가] 예약 불가 시간 테이블 생성
    const createBlockedSlotsTable = `
      CREATE TABLE IF NOT EXISTS blocked_slots (
        id SERIAL PRIMARY KEY,
        slot_date DATE NOT NULL,
        slot_time VARCHAR(50) NOT NULL,
        UNIQUE(slot_date, slot_time)
      );
    `;


     // [핵심 추가] 사용자 후기 테이블 생성
    const createReviewsTable = `
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        patient_name VARCHAR(100) NOT NULL,
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        content TEXT NOT NULL,
        is_approved BOOLEAN DEFAULT FALSE,
        admin_reply TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

     // [핵심 추가] 관리자 접근 기록 테이블 생성
    const createAdminLogsTable = `
      CREATE TABLE IF NOT EXISTS admin_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        ip_address VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;




    await client.query(createNoticesTable);
    await client.query(alterNoticesTable);
    await client.query(createPostsTable);
    await client.query(createConsultationsTable);
    await client.query(createRepliesTable);
    await client.query(createDoctorsTable);
    await client.query(createAboutContentTable);
    await client.query(insertDefaultAboutContent);
    await client.query(createClinicPhotosTable);
    await client.query(createPostCommentsTable);
    await client.query(alterCommentsTableLikes);
    await client.query(alterCommentsTableTags);
    await client.query(createReservationsTable);
    await client.query(createBlockedSlotsTable);
    await client.query(createCasePhotosTable);
    await client.query(createFaqsTable);
    await client.query(createReviewsTable);
    await client.query(createAdminLogsTable);
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

// [핵심 수정] --- 관리자 로그인 API ---
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    try {
      // 로그인 성공 시 기록 남기기
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      await pool.query(
        'INSERT INTO admin_logs (action, ip_address) VALUES ($1, $2)',
        ['login_success', ip]
      );
      
      const user = { name: 'admin' };
      const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.json({ accessToken });

    } catch (logError) {
      console.error('로그인 기록 중 오류 발생:', logError);
      // 로그 기록에 실패해도 로그인은 성공시켜야 함
      const user = { name: 'admin' };
      const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.json({ accessToken });
    }
  } else {
    res.status(401).send('비밀번호가 올바르지 않습니다.');
  }
});

// [핵심 추가] --- 관리자 접근 기록 API ---
app.get('/api/admin/logs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100'); // 최근 100개만 조회
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error('접근 기록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// --- 대시보드 API ---
app.get('/api/admin/dashboard-summary', authenticateToken, async (req, res) => {
  try {
    const unansweredQuery = 'SELECT COUNT(*) FROM consultations WHERE is_answered = false';
    const todayQuery = "SELECT COUNT(*) FROM consultations WHERE created_at >= CURRENT_DATE";
    const postsQuery = 'SELECT COUNT(*) FROM posts';
    const noticesQuery = 'SELECT COUNT(*) FROM notices';
    const consultationsQuery = 'SELECT COUNT(*) FROM consultations';

    const [unanswered, today, posts, notices, consultations] = await Promise.all([
      pool.query(unansweredQuery),
      pool.query(todayQuery),
      pool.query(postsQuery),
      pool.query(noticesQuery),
      pool.query(consultationsQuery)
    ]);

    res.json({
      unansweredConsultations: parseInt(unanswered.rows[0].count, 10),
      todayConsultations: parseInt(today.rows[0].count, 10),
      totalPosts: parseInt(posts.rows[0].count, 10),
      totalNotices: parseInt(notices.rows[0].count, 10),
      totalConsultations: parseInt(consultations.rows[0].count, 10),
    });
  } catch (err) {
    console.error('대시보드 요약 정보 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// [핵심 추가] --- 대시보드 통계 API ---
app.get('/api/admin/dashboard-stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 오늘의 시작

    const totalNoticesPromise = pool.query('SELECT COUNT(*) FROM notices');
    const totalPostsPromise = pool.query('SELECT COUNT(*) FROM posts');
    const totalConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations');
    const unansweredConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations WHERE is_answered = false');
    const todayConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations WHERE created_at >= $1', [today]);

    const [
      totalNoticesResult,
      totalPostsResult,
      totalConsultationsResult,
      unansweredConsultationsResult,
      todayConsultationsResult
    ] = await Promise.all([
      totalNoticesPromise,
      totalPostsPromise,
      totalConsultationsPromise,
      unansweredConsultationsPromise,
      todayConsultationsPromise
    ]);

    res.json({
      totalNotices: parseInt(totalNoticesResult.rows[0].count, 10),
      totalPosts: parseInt(totalPostsResult.rows[0].count, 10),
      totalConsultations: parseInt(totalConsultationsResult.rows[0].count, 10),
      unansweredConsultations: parseInt(unansweredConsultationsResult.rows[0].count, 10),
      todayConsultations: parseInt(todayConsultationsResult.rows[0].count, 10),
    });

  } catch (err) {
    console.error('대시보드 통계 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});





// --- 기존 API 들 (생략 없이 모두 포함) ---
// 공지사항 API
// [핵심 수정] --- 공지사항 (Notices) API ---
app.get('/api/notices', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10; // 한 페이지에 10개씩
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  const category = req.query.category || '';


  try {
     let baseQuery = 'FROM notices';
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (searchTerm) {
      whereClauses.push(`(title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`);
      queryParams.push(`%${searchTerm}%`);
      paramIndex++;
    }
    if (category && category !== '전체') {
      whereClauses.push(`category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    const itemsQuery = `SELECT * ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);

    res.json({
      items: toCamelCase(itemsResult.rows),
      totalPages,
      currentPage: page,
      totalItems,
    });
  } catch (err) {
    console.error('공지사항 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});


app.get('/api/notices/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/admin/notices', authenticateToken, async (req, res) => {
    const { title, content, category } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO notices (title, content, category) VALUES ($1, $2, $3) RETURNING *',
            [title, content, category]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.put('/api/admin/notices/:id', authenticateToken, async (req, res) => {
    const { title, content, category } = req.body;
    try {
        const result = await pool.query(
            'UPDATE notices SET title = $1, content = $2, category = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
            [title, content, category, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});

app.delete('/api/admin/notices/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 자유게시판 API
 // [핵심 수정] --- 자유게시판 (Posts) API ---
app.get('/api/posts', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  try {
    let baseQuery = 'FROM posts';
    let whereClause = '';
    const queryParams = [];

    if (searchTerm) {
      whereClause = 'WHERE title ILIKE $1 OR content ILIKE $1 OR author ILIKE $1';
      queryParams.push(`%${searchTerm}%`);
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    const itemsQuery = `SELECT id, title, author, created_at, updated_at ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);

    res.json({
      items: toCamelCase(itemsResult.rows),
      totalPages,
      currentPage: page,
      totalItems,
    });
  } catch (err) {
    console.error('자유게시판 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
// --- 자유게시판 (Posts) API ---
app.get('/api/posts/:id', async (req, res) => { try { const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]); if (postResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); const commentsResult = await pool.query('SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.id]); const post = toCamelCase(postResult.rows)[0]; const comments = toCamelCase(commentsResult.rows); res.json({ ...post, comments }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); }});
app.post('/api/posts', async (req, res) => {
    const { author, password, title, content } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *', [author, hashedPassword, title, content]);
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.post('/api/posts/:id/verify', async (req, res) => {
    try {
        const { password } = req.body;
        const result = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
        const match = await bcrypt.compare(password, result.rows[0].password);
        res.json({ success: match });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: '서버 오류' }); }
});

// [핵심 추가] 댓글 좋아요 API
app.post('/api/posts/comments/:commentId/like', async (req, res) => {
    const { commentId } = req.params;
    try {
        const result = await pool.query(
            'UPDATE post_comments SET likes = likes + 1 WHERE id = $1 RETURNING likes',
            [commentId]
        );
        if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.');
        res.status(200).json(result.rows[0]);
    } catch (err) { console.error('좋아요 처리 중 오류:', err); res.status(500).send('서버 오류'); }
});

// [핵심 추가] 댓글 태그 추가 API
app.post('/api/posts/comments/:commentId/tags', async (req, res) => {
    const { tag } = req.body;
    const { commentId } = req.params;
    if (!tag || !tag.trim()) return res.status(400).send('태그 내용이 없습니다.');
    try {
        // 기존 태그를 불러와서 새 태그를 추가 (중복 방지)
        const currentTagsResult = await pool.query('SELECT tags FROM post_comments WHERE id = $1', [commentId]);
        if (currentTagsResult.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.');
        
        const currentTags = currentTagsResult.rows[0].tags ? currentTagsResult.rows[0].tags.split(',') : [];
        if (!currentTags.includes(tag.trim())) {
            currentTags.push(tag.trim());
        }
        
        const newTags = currentTags.join(',');
        const result = await pool.query(
            'UPDATE post_comments SET tags = $1 WHERE id = $2 RETURNING tags',
            [newTags, commentId]
        );
        res.status(200).json(result.rows[0]);
    } catch (err) { console.error('태그 추가 중 오류:', err); res.status(500).send('서버 오류'); }
});

app.delete('/api/posts/comments/:commentId', async (req, res) => {
    const { password } = req.body;
    const { commentId } = req.params;
    try {
        const result = await pool.query('SELECT password FROM post_comments WHERE id = $1', [commentId]);
        if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, result.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        await pool.query('DELETE FROM post_comments WHERE id = $1', [commentId]);
        res.status(204).send();
    } catch (err) { console.error('댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); }
});

app.delete('/api/admin/posts/comments/:commentId', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM post_comments WHERE id = $1', [req.params.commentId]);
        res.status(204).send();
    } catch (err) { console.error('관리자 댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); }
});


app.put('/api/posts/:id', async (req, res) => {
    const { title, content, password } = req.body;
    try {
        const verifyResult = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]);
        if (verifyResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, verifyResult.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]);
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
// [핵심 추가] 사용자 게시글 삭제
app.delete('/api/posts/:id', async (req, res) => {
    const { password } = req.body;
    try {
        const verifyResult = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]);
        if (verifyResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, verifyResult.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
// 댓글 작성
app.post('/api/posts/:id/comments', async (req, res) => {
    const { author, password, content } = req.body;
    const postId = req.params.id;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = await pool.query('INSERT INTO post_comments (post_id, author, password, content) VALUES ($1, $2, $3, $4) RETURNING *', [postId, author, hashedPassword, content]);
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('댓글 작성 중 오류:', err); res.status(500).send('서버 오류'); }
});

// 사용자 댓글 삭제

// 관리자 댓글 삭제
app.delete('/api/admin/posts/comments/:commentId', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM post_comments WHERE id = $1', [req.params.commentId]);
        res.status(204).send();
    } catch (err) {
        console.error('관리자 댓글 삭제 중 오류:', err);
        res.status(500).send('서버 오류');
    }
});
app.delete('/api/posts/comments/:commentId', async (req, res) => {
    const { password } = req.body;
    const { commentId } = req.params;
    try {
        const result = await pool.query('SELECT password FROM post_comments WHERE id = $1', [commentId]);
        if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, result.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        await pool.query('DELETE FROM post_comments WHERE id = $1', [commentId]);
        res.status(204).send();
    } catch (err) { console.error('댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); }
});

app.put('/api/admin/posts/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/posts/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// [핵심 수정] --- 온라인 상담 (Consultations) API ---
app.get('/api/consultations', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  try {
    let baseQuery = 'FROM consultations';
    let whereClause = 'WHERE is_secret = false'; // 비밀글이 아닌 것만 검색 대상
    const queryParams = [];
app
    if (searchTerm) {
      whereClause += ' AND (title ILIKE $1 OR content ILIKE $1 OR author ILIKE $1)';
      queryParams.push(`%${searchTerm}%`);
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    const itemsQuery = `SELECT id, title, author, created_at, is_secret, is_answered ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);

    res.json({
      items: toCamelCase(itemsResult.rows),
      totalPages,
      currentPage: page,
      totalItems,
    });
  } catch (err) {
    console.error('온라인상담 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
app.get('/api/consultations/:id', async (req, res) => { try { const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]); if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]); const consultation = toCamelCase(consultationResult.rows)[0]; const replies = toCamelCase(replyResult.rows); res.json({ ...consultation, replies }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/consultations', async (req, res) => {
    const { author, password, title, content, isSecret } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = await pool.query('INSERT INTO consultations (author, password, title, content, is_secret) VALUES ($1, $2, $3, $4, $5) RETURNING *', [author, hashedPassword, title, content, isSecret]);
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.post('/api/consultations/:id/verify', async (req, res) => {
    try {
        const { password } = req.body;
        const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '상담글을 찾을 수 없습니다.' });
        const match = await bcrypt.compare(password, result.rows[0].password);
        res.json({ success: match });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: '서버 오류' }); }
});
app.put('/api/consultations/:id', async (req, res) => {
    const { title, content, password } = req.body;
    try {
        const verifyResult = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]);
        if (verifyResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, verifyResult.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]);
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.delete('/api/consultations/:id', async (req, res) => {
    const { password } = req.body;
    try {
        const verifyResult = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]);
        if (verifyResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        const match = await bcrypt.compare(password, verifyResult.rows[0].password);
        if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.put('/api/admin/consultations/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
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

// [핵심 추가] --- 병원소개 (About) API ---
app.get('/api/about', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM about_content WHERE id = 1');
    res.json(toCamelCase(result.rows)[0] || {});
  } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
app.put('/api/admin/about', authenticateToken, async (req, res) => {
    const { title, subtitle, content, imageData } = req.body;
    try {
        const result = await pool.query(
            'UPDATE about_content SET title = $1, subtitle = $2, content = $3, image_data = $4, updated_at = NOW() WHERE id = 1 RETURNING *',
            [title, subtitle, content, imageData]
        );
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('병원소개 업데이트 중 DB 오류:', err); res.status(500).send('서버 오류'); }
});




// [핵심 추가] --- 병원 사진 갤러리 API ---
// GET (Public)
app.get('/api/clinic-photos', async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 8; // 한 페이지에 8장씩
  const offset = (page - 1) * limit;




  try {
     const photosPromise = pool.query('SELECT * FROM clinic_photos ORDER BY display_order ASC, id ASC LIMIT $1 OFFSET $2', [limit, offset]);
    const countPromise = pool.query('SELECT COUNT(*) FROM clinic_photos');
    
    const [photosResult, countResult] = await Promise.all([photosPromise, countPromise]);
    
    const totalPhotos = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalPhotos / limit);

    res.json({
      photos: toCamelCase(photosResult.rows),
      totalPages: totalPages,
      currentPage: page
    });
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

// [핵심 추가] --- 온라인 예약 (Reservations) API ---
// 예약 신청 (Public)
app.post('/api/reservations', async (req, res) => {
    const { patientName, phoneNumber, desiredDate, desiredTime, notes } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO reservations (patient_name, phone_number, desired_date, desired_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [patientName, phoneNumber, desiredDate, desiredTime, notes]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('예약 신청 중 오류:', err);
        res.status(500).send('서버 오류');
    }
});


// 예약 목록 조회 (Admin)
app.get('/api/admin/reservations', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM reservations ORDER BY desired_date DESC, created_at DESC');
        res.json(toCamelCase(result.rows));
    } catch (err) {
        console.error('예약 목록 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});


// 예약 상태 변경 (Admin)
app.put('/api/admin/reservations/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE reservations SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('예약 정보를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('예약 상태 변경 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// 예약 삭제 (Admin)
app.delete('/api/admin/reservations/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('예약 정보를 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error('예약 삭제 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// [핵심 추가] --- 치료 사례 (Case Photos) API ---
// GET (Public) - 카테고리별 필터링, 페이지네이션 포함
app.get('/api/cases', async (req, res) => {
  const category = req.query.category || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 9; // 3x3 그리드를 위해 9개씩
  const offset = (page - 1) * limit;

  try {
    let baseQuery = 'FROM case_photos';
    let whereClause = '';
    const queryParams = [];

    if (category) {
      whereClause = 'WHERE category = $1';
      queryParams.push(category);
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    const itemsQuery = `SELECT * ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);

    res.json({
      items: toCamelCase(itemsResult.rows),
      totalPages,
      currentPage: page,
    });
  } catch (err) {
    console.error('치료 사례 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// POST (Admin) - 전/후 사진을 함께 받음
app.post('/api/admin/cases', authenticateToken, upload.fields([{ name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]), async (req, res) => {
    const { title, category, description } = req.body;
    const beforeImageData = req.files['beforeImage'] ? `data:${req.files['beforeImage'][0].mimetype};base64,${req.files['beforeImage'][0].buffer.toString('base64')}` : null;
    const afterImageData = req.files['afterImage'] ? `data:${req.files['afterImage'][0].mimetype};base64,${req.files['afterImage'][0].buffer.toString('base64')}` : null;

    try {
        const result = await pool.query(
            'INSERT INTO case_photos (title, category, description, before_image_data, after_image_data) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, category, description, beforeImageData, afterImageData]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('치료 사례 추가 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// PUT (Admin)
app.put('/api/admin/cases/:id', authenticateToken, upload.fields([{ name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]), async (req, res) => {
    const { title, category, description, existingBeforeImage, existingAfterImage } = req.body;
    const beforeImageData = req.files['beforeImage'] ? `data:${req.files['beforeImage'][0].mimetype};base64,${req.files['beforeImage'][0].buffer.toString('base64')}` : existingBeforeImage;
    const afterImageData = req.files['afterImage'] ? `data:${req.files['afterImage'][0].mimetype};base64,${req.files['afterImage'][0].buffer.toString('base64')}` : existingAfterImage;

    try {
        const result = await pool.query(
            'UPDATE case_photos SET title = $1, category = $2, description = $3, before_image_data = $4, after_image_data = $5 WHERE id = $6 RETURNING *',
            [title, category, description, beforeImageData, afterImageData, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('치료 사례를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('치료 사례 수정 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// DELETE (Admin)
app.delete('/api/admin/cases/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM case_photos WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('치료 사례를 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error('치료 사례 삭제 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// [핵심 추가] --- FAQ API ---
// GET (Public)
app.get('/api/faqs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM faqs ORDER BY category, id ASC');
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error('FAQ 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// POST (Admin)
app.post('/api/admin/faqs', authenticateToken, async (req, res) => {
    const { category, question, answer } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO faqs (category, question, answer) VALUES ($1, $2, $3) RETURNING *',
            [category, question, answer]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('FAQ 추가 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// PUT (Admin)
app.put('/api/admin/faqs/:id', authenticateToken, async (req, res) => {
    const { category, question, answer } = req.body;
    try {
        const result = await pool.query(
            'UPDATE faqs SET category = $1, question = $2, answer = $3 WHERE id = $4 RETURNING *',
            [category, question, answer, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('FAQ를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('FAQ 수정 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// DELETE (Admin)
app.delete('/api/admin/faqs/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM faqs WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('FAQ를 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error('FAQ 삭제 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// [핵심 추가] --- 예약 스케줄 API ---
// 특정 월의 예약 현황 + 예약 불가 시간을 함께 조회 (Public)
app.get('/api/schedule', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).send('Year and month are required.');
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    try {
        // 모든 예약(대기, 확정 등)을 가져옵니다.
        const reservationsPromise = pool.query(
            "SELECT desired_date, desired_time, status FROM reservations WHERE desired_date >= $1 AND desired_date < $2",
            [startDate, endDate]
        );
        const blockedSlotsPromise = pool.query(
            "SELECT slot_date, slot_time FROM blocked_slots WHERE slot_date >= $1 AND slot_date < $2",
            [startDate, endDate]
        );

        const [reservationsResult, blockedSlotsResult] = await Promise.all([
            reservationsPromise,
            blockedSlotsPromise
        ]);
        
        const schedule = {};
        
        reservationsResult.rows.forEach(row => {
            const date = new Date(row.desired_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            // 한 시간에 여러 예약이 있을 수 있으므로, 상태별로 카운트합니다.
            if (!schedule[date][row.desired_time]) {
                schedule[date][row.desired_time] = { pending: 0, confirmed: 0, blocked: false };
            }
            if (row.status === 'pending') schedule[date][row.desired_time].pending++;
            if (row.status === 'confirmed') schedule[date][row.desired_time].confirmed++;
        });

        blockedSlotsResult.rows.forEach(row => {
            const date = new Date(row.slot_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            if (!schedule[date][row.slot_time]) {
                schedule[date][row.slot_time] = { pending: 0, confirmed: 0, blocked: false };
            }
            schedule[date][row.slot_time].blocked = true;
        });

        res.json(schedule);
    } catch (err) {
        console.error('스케줄 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// 예약 불가 시간 추가 (Admin)
app.post('/api/admin/blocked-slots', authenticateToken, async (req, res) => {
    const { slotDate, slotTime } = req.body;
    try {
        await pool.query(
            'INSERT INTO blocked_slots (slot_date, slot_time) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [slotDate, slotTime]
        );
        res.status(201).send();
    } catch (err) {
        console.error('예약 불가 시간 추가 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// 예약 불가 시간 삭제 (Admin)
app.delete('/api/admin/blocked-slots', authenticateToken, async (req, res) => {
    const { slotDate, slotTime } = req.body;
    try {
        await pool.query(
            'DELETE FROM blocked_slots WHERE slot_date = $1 AND slot_time = $2',
            [slotDate, slotTime]
        );
        res.status(204).send();
    } catch (err) {
        console.error('예약 불가 시간 삭제 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// [핵심 추가] --- 사용자 후기 (Reviews) API ---
// GET (Public) - 승인된 후기만, 페이지네이션 포함
app.get('/api/reviews', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 5;
  const offset = (page - 1) * limit;
  try {
    const itemsPromise = pool.query("SELECT * FROM reviews WHERE is_approved = TRUE ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const countPromise = pool.query('SELECT COUNT(*) FROM reviews WHERE is_approved = TRUE');
    const [itemsResult, countResult] = await Promise.all([itemsPromise, countPromise]);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page });
  } catch (err) { console.error('후기 조회 오류:', err); res.status(500).send('서버 오류'); }
});

// POST (Public) - 후기 작성
app.post('/api/reviews', async (req, res) => {
    const { patientName, rating, content } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO reviews (patient_name, rating, content) VALUES ($1, $2, $3) RETURNING *',
            [patientName, rating, content]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('후기 작성 중 오류:', err); res.status(500).send('서버 오류'); }
});

// GET (Admin) - 모든 후기 조회
app.get('/api/admin/reviews', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC');
        res.json(toCamelCase(result.rows));
    } catch (err) { console.error('관리자 후기 조회 오류:', err); res.status(500).send('서버 오류'); }
});

// PUT (Admin) - 후기 승인/비승인 토글
app.put('/api/admin/reviews/:id/approve', authenticateToken, async (req, res) => {
    const { isApproved } = req.body;
    try {
        const result = await pool.query(
            'UPDATE reviews SET is_approved = $1 WHERE id = $2 RETURNING *',
            [isApproved, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('후기를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('후기 승인 오류:', err); res.status(500).send('서버 오류'); }
});

// POST (Admin) - 관리자 답글 추가/수정
app.post('/api/admin/reviews/:id/reply', authenticateToken, async (req, res) => {
    const { reply } = req.body;
    try {
        const result = await pool.query(
            'UPDATE reviews SET admin_reply = $1 WHERE id = $2 RETURNING *',
            [reply, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('후기를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('답글 작성 오류:', err); res.status(500).send('서버 오류'); }
});

// DELETE (Admin) - 후기 삭제
app.delete('/api/admin/reviews/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM reviews WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('후기를 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) { console.error('후기 삭제 오류:', err); res.status(500).send('서버 오류'); }
});







// 서버 실행
const PORT = process.env.PORT || 3001;
initializeDatabase().then(() => { app.listen(PORT, () => { console.log(`백엔드 서버가 포트 ${PORT}에서 성공적으로 실행되었습니다.`); }); }).catch(err => { console.error('서버 시작 실패:', err); });
