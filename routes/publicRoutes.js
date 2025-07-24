// /routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { toCamelCase } = require('../utils/helpers');
const upload = require('../middleware/upload');
const saltRounds = 10;

// --- 사용자 인증 미들웨어 ---
const authenticateUserToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const softAuthenticateUserToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return next();

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (!err) req.user = user;
    next();
  });
};

const authenticateReservationToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, reservation) => {
    if (err) return res.sendStatus(403);
    if (reservation.id !== parseInt(req.params.id, 10)) {
      return res.sendStatus(403);
    }
    req.reservation = reservation;
    next();
  });
};


// --- 공지사항 ---
router.get('/notices', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
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
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('공지사항 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/notices/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// --- 자유게시판 ---
router.get('/posts', async (req, res) => {
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
    // [수정된 부분] SELECT 절에서 user_id를 제거하여 에러를 해결합니다.
    const itemsQuery = `SELECT id, title, author, created_at, updated_at ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('자유게시판 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/posts/:id', async (req, res) => { try { const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]); if (postResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); const commentsResult = await pool.query('SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.id]); const post = toCamelCase(postResult.rows)[0]; const comments = toCamelCase(commentsResult.rows); res.json({ ...post, comments }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); }});
router.post('/posts/:id/verify', async (req, res) => { try { const { password } = req.body; const result = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' }); const match = await bcrypt.compare(password, result.rows[0].password); res.json({ success: match }); } catch (err) { console.error(err); res.status(500).json({ success: false, message: '서버 오류' }); } });
router.post('/posts', upload.single('image'), softAuthenticateUserToken, async (req, res) => { 
    const { author, password, title, content } = req.body; 
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    const userId = req.user ? req.user.id : null;
    const finalAuthor = req.user ? req.user.username : author;
    try { 
        const hashedPassword = await bcrypt.hash(password || '', saltRounds); 
        const result = await pool.query(
            'INSERT INTO posts (author, password, title, content, image_data, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', 
            [finalAuthor, hashedPassword, title, content, imageData, userId]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error(err); res.status(500).send('서버 오류'); 
    } 
});
router.put('/posts/:id', softAuthenticateUserToken, async (req, res) => {
    const { title, content, password } = req.body;
    const { id } = req.params;
    try {
        const postResult = await pool.query('SELECT password, user_id FROM posts WHERE id = $1', [id]);
        if (postResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        const post = postResult.rows[0];
        if (req.user && req.user.id === post.user_id) {
            // 통과
        } else {
            if (!password) return res.status(400).send('비밀번호를 입력해주세요.');
            const match = await bcrypt.compare(password, post.password);
            if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        }
        const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, id]);
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
router.delete('/posts/:id', softAuthenticateUserToken, async (req, res) => {
    const { password } = req.body;
    const { id } = req.params;
    try {
        const postResult = await pool.query('SELECT password, user_id FROM posts WHERE id = $1', [id]);
        if (postResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        const post = postResult.rows[0];
        if (req.user && req.user.id === post.user_id) {
            // 통과
        } else {
            if (!password) return res.status(400).send('비밀번호를 입력해주세요.');
            const match = await bcrypt.compare(password, post.password);
            if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        }
        await pool.query('DELETE FROM posts WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});

// --- 자유게시판 댓글 ---
router.post('/posts/:id/comments', async (req, res) => { const { author, password, content } = req.body; const postId = req.params.id; try { const hashedPassword = await bcrypt.hash(password, saltRounds); const result = await pool.query('INSERT INTO post_comments (post_id, author, password, content) VALUES ($1, $2, $3, $4) RETURNING *', [postId, author, hashedPassword, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('댓글 작성 중 오류:', err); res.status(500).send('서버 오류'); } });
router.post('/posts/comments/:commentId/like', async (req, res) => { const { commentId } = req.params; try { const result = await pool.query('UPDATE post_comments SET likes = likes + 1 WHERE id = $1 RETURNING likes', [commentId]); if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); res.status(200).json(result.rows[0]); } catch (err) { console.error('좋아요 처리 중 오류:', err); res.status(500).send('서버 오류'); } });
router.post('/posts/comments/:commentId/tags', async (req, res) => { const { tag } = req.body; const { commentId } = req.params; if (!tag || !tag.trim()) return res.status(400).send('태그 내용이 없습니다.'); try { const currentTagsResult = await pool.query('SELECT tags FROM post_comments WHERE id = $1', [commentId]); if (currentTagsResult.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); const currentTags = currentTagsResult.rows[0].tags ? currentTagsResult.rows[0].tags.split(',') : []; if (!currentTags.includes(tag.trim())) { currentTags.push(tag.trim()); } const newTags = currentTags.join(','); const result = await pool.query('UPDATE post_comments SET tags = $1 WHERE id = $2 RETURNING tags', [newTags, commentId]); res.status(200).json(result.rows[0]); } catch (err) { console.error('태그 추가 중 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/posts/comments/:commentId', async (req, res) => { const { password } = req.body; const { commentId } = req.params; try { const result = await pool.query('SELECT password FROM post_comments WHERE id = $1', [commentId]); if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, result.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); await pool.query('DELETE FROM post_comments WHERE id = $1', [commentId]); res.status(204).send(); } catch (err) { console.error('댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); } });

// --- 온라인 상담 ---
router.get('/consultations', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  try {
    let baseQuery = 'FROM consultations';
    let whereClause = 'WHERE is_secret = false';
    const queryParams = [];
    if (searchTerm) {
      whereClause += ' AND (title ILIKE $1 OR content ILIKE $1 OR author ILIKE $1)';
      queryParams.push(`%${searchTerm}%`);
    }
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const itemsQuery = `SELECT id, title, author, created_at, is_secret, is_answered, user_id ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('온라인상담 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/consultations/:id', async (req, res) => { try { const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]); if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]); const consultation = toCamelCase(consultationResult.rows)[0]; const replies = toCamelCase(replyResult.rows); res.json({ ...consultation, replies }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.post('/consultations/:id/verify', async (req, res) => { try { const { password } = req.body; const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).json({ success: false, message: '상담글을 찾을 수 없습니다.' }); const match = await bcrypt.compare(password, result.rows[0].password); res.json({ success: match }); } catch (err) { console.error(err); res.status(500).json({ success: false, message: '서버 오류' }); } });
router.post('/consultations', upload.single('image'), softAuthenticateUserToken, async (req, res) => {
    const { author, password, title, content, isSecret } = req.body; 
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    const userId = req.user ? req.user.id : null;
    const finalAuthor = req.user ? req.user.username : author;
    try { 
        const hashedPassword = await bcrypt.hash(password || '', saltRounds); 
        const result = await pool.query(
            'INSERT INTO consultations (author, password, title, content, is_secret, image_data, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', 
            [finalAuthor, hashedPassword, title, content, isSecret, imageData, userId]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error(err); res.status(500).send('서버 오류'); 
    } 
});
router.put('/consultations/:id', softAuthenticateUserToken, async (req, res) => {
    const { title, content, password } = req.body;
    const { id } = req.params;
    try {
        const consultResult = await pool.query('SELECT password, user_id FROM consultations WHERE id = $1', [id]);
        if (consultResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        const consultation = consultResult.rows[0];
        if (req.user && req.user.id === consultation.user_id) {
            // 통과
        } else {
            if (!password) return res.status(400).send('비밀번호를 입력해주세요.');
            const match = await bcrypt.compare(password, consultation.password);
            if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        }
        const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, id]);
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
router.delete('/consultations/:id', softAuthenticateUserToken, async (req, res) => {
    const { password } = req.body;
    const { id } = req.params;
    try {
        const consultResult = await pool.query('SELECT password, user_id FROM consultations WHERE id = $1', [id]);
        if (consultResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        const consultation = consultResult.rows[0];
        if (req.user && req.user.id === consultation.user_id) {
            // 통과
        } else {
            if (!password) return res.status(400).send('비밀번호를 입력해주세요.');
            const match = await bcrypt.compare(password, consultation.password);
            if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.');
        }
        await pool.query('DELETE FROM consultations WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});

// --- 기타 공개 정보 ---
router.get('/doctors', async (req, res) => { try { const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/about', async (req, res) => { try { const result = await pool.query('SELECT * FROM about_content WHERE id = 1'); res.json(toCamelCase(result.rows)[0] || {}); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/clinic-photos', async (req, res) => { const page = parseInt(req.query.page, 10) || 1; const limit = parseInt(req.query.limit, 10) || 8; const offset = (page - 1) * limit; try { const photosPromise = pool.query('SELECT * FROM clinic_photos ORDER BY display_order ASC, id ASC LIMIT $1 OFFSET $2', [limit, offset]); const countPromise = pool.query('SELECT COUNT(*) FROM clinic_photos'); const [photosResult, countResult] = await Promise.all([photosPromise, countPromise]); const totalPhotos = parseInt(countResult.rows[0].count, 10); const totalPages = Math.ceil(totalPhotos / limit); res.json({ photos: toCamelCase(photosResult.rows), totalPages: totalPages, currentPage: page }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/cases', async (req, res) => {
  const category = req.query.category || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 9;
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
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page });
  } catch (err) {
    console.error('치료 사례 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/faqs', async (req, res) => {
  const searchTerm = req.query.search || '';
  try {
    let query = 'SELECT * FROM faqs';
    const queryParams = [];
    if (searchTerm) {
      query += ' WHERE (question ILIKE $1 OR answer ILIKE $1)';
      queryParams.push(`%${searchTerm}%`);
    }
    query += ' ORDER BY category, id ASC';
    const result = await pool.query(query, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error('FAQ 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/schedule', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).send('Year and month are required.');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    try {
        const reservationsPromise = pool.query("SELECT desired_date, desired_time, status FROM reservations WHERE desired_date >= $1 AND desired_date < $2", [startDate, endDate]);
        const blockedSlotsPromise = pool.query("SELECT slot_date, slot_time FROM blocked_slots WHERE slot_date >= $1 AND slot_date < $2", [startDate, endDate]);
        const [reservationsResult, blockedSlotsResult] = await Promise.all([reservationsPromise, blockedSlotsPromise]);
        const schedule = {};
        reservationsResult.rows.forEach(row => {
            const date = new Date(row.desired_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            if (!schedule[date][row.desired_time]) { schedule[date][row.desired_time] = { pending: 0, confirmed: 0, blocked: false }; }
            if (row.status === 'pending') schedule[date][row.desired_time].pending++;
            if (row.status === 'confirmed') schedule[date][row.desired_time].confirmed++;
        });
        blockedSlotsResult.rows.forEach(row => {
            const date = new Date(row.slot_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            if (!schedule[date][row.slot_time]) { schedule[date][row.desired_time] = { pending: 0, confirmed: 0, blocked: false }; }
            schedule[date][row.slot_time].blocked = true;
        });
        res.json(schedule);
    } catch (err) {
        console.error('스케줄 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// --- 예약 및 후기 작성 ---
router.post('/reservations', softAuthenticateUserToken, async (req, res) => { 
    const { patientName, phoneNumber, desiredDate, desiredTime, notes } = req.body; 
    const userId = req.user ? req.user.id : null;
    const finalPatientName = req.user ? req.user.username : patientName;
    try { 
        const result = await pool.query(
            'INSERT INTO reservations (patient_name, phone_number, desired_date, desired_time, notes, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', 
            [finalPatientName, phoneNumber, desiredDate, desiredTime, notes, userId]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error('예약 신청 중 오류:', err); 
        res.status(500).send('서버 오류'); 
    } 
});
router.get('/reviews', async (req, res) => {
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
router.post('/reviews', upload.single('image'), async (req, res) => { 
    const { patientName, rating, content } = req.body; 
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    try { 
        const result = await pool.query(
            'INSERT INTO reviews (patient_name, rating, content, image_data) VALUES ($1, $2, $3, $4) RETURNING *', 
            [patientName, rating, content, imageData]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error('후기 작성 중 오류:', err); 
        res.status(500).send('서버 오류'); 
    } 
});

// --- 메인 페이지 동적 데이터 ---
router.get('/home-summary', async (req, res) => {
  try {
    const noticesPromise = pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 3');
    const casesPromise = pool.query('SELECT id, title, category, before_image_data FROM case_photos ORDER BY created_at DESC LIMIT 3');
    const reviewsPromise = pool.query('SELECT patient_name, rating, content FROM reviews WHERE is_approved = TRUE ORDER BY created_at DESC LIMIT 3');

    const [noticesResult, casesResult, reviewsResult] = await Promise.all([
      noticesPromise,
      casesPromise,
      reviewsPromise
    ]);

    res.json({
      notices: toCamelCase(noticesResult.rows),
      cases: toCamelCase(casesResult.rows),
      reviews: toCamelCase(reviewsResult.rows),
    });
  } catch (err) {
    console.error('메인 페이지 데이터 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// --- 회원가입, 로그인, 마이페이지 API ---
router.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );
    res.status(201).json(toCamelCase(newUser.rows)[0]);
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.status(500).json({ message: '이미 사용 중인 이메일이거나 서버 오류가 발생했습니다.' });
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const accessToken = jwt.sign({ id: user.id, username: user.username, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ accessToken });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.get('/auth/me', authenticateUserToken, (req, res) => {
  res.json(req.user);
});

router.get('/auth/me/consultations', authenticateUserToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM consultations WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(toCamelCase(result.rows));
  } catch (err) {
    res.status(500).send('내 상담 내역 조회 오류');
  }
});

router.get('/auth/me/reservations', authenticateUserToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reservations WHERE user_id = $1 ORDER BY desired_date DESC', [req.user.id]);
    res.json(toCamelCase(result.rows));
  } catch (err) {
    res.status(500).send('내 예약 내역 조회 오류');
  }
});

router.get('/auth/me/posts', authenticateUserToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, created_at FROM posts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(toCamelCase(result.rows));
  } catch (err) {
    res.status(500).send('내 게시글 내역 조회 오류');
  }
});

router.put('/auth/me/update', authenticateUserToken, async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: '비밀번호를 변경하려면 현재 비밀번호를 입력해야 합니다.' });
      }
      const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
      const user = userResult.rows[0];
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        return res.status(403).json({ message: '현재 비밀번호가 일치하지 않습니다.' });
      }
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
      await pool.query('UPDATE users SET username = $1, password = $2 WHERE id = $3', [username, hashedNewPassword, userId]);
    } else {
      await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId]);
    }
    res.status(200).send('회원 정보가 성공적으로 수정되었습니다.');
  } catch (err) {
    console.error('회원 정보 수정 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// --- 예약 확인 및 관리 ---
router.post('/reservations/verify', async (req, res) => {
  const { patientName, phoneNumber } = req.body;
  try {
    const result = await pool.query(
      'SELECT id FROM reservations WHERE patient_name = $1 AND phone_number = $2 ORDER BY created_at DESC LIMIT 1',
      [patientName, phoneNumber]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('일치하는 예약 정보를 찾을 수 없습니다.');
    }
    const reservation = result.rows[0];
    const accessToken = jwt.sign({ id: reservation.id, name: patientName }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ accessToken, reservationId: reservation.id });
  } catch (err) {
    console.error('예약 확인 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.get('/reservations/:id', authenticateReservationToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('예약 정보를 찾을 수 없습니다.');
    }
    res.json(toCamelCase(result.rows)[0]);
  } catch (err) {
    console.error('예약 상세 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.put('/reservations/:id', authenticateReservationToken, async (req, res) => {
  const { desiredDate, desiredTime, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE reservations SET desired_date = $1, desired_time = $2, notes = $3, status = $4 WHERE id = $5 RETURNING *',
      [desiredDate, desiredTime, notes, 'pending', req.params.id]
    );
    res.json(toCamelCase(result.rows)[0]);
  } catch (err) {
    console.error('예약 변경 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.delete('/reservations/:id', authenticateReservationToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error('예약 취소 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});

module.exports = router;
