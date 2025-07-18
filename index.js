// /index.js (리팩토링 최종본)

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./config/db');

// 라우터 파일들을 불러옵니다.
const adminRoutes = require('./routes/adminRoutes');
const publicRoutes = require('./routes/publicRoutes');

const app = express();

// --- 미들웨어 설정 ---
const corsOptions = {
  origin: 'https://yondentalclinic.vercel.app',
  credentials: true,
};
app.use(cors(corsOptions));
app.set('trust proxy', true);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- 라우터 연결 ---
// '/api/admin'으로 시작하는 요청은 adminRoutes.js 파일이 처리합니다.
app.use('/api/admin', adminRoutes);
// 그 외 '/api'로 시작하는 요청은 publicRoutes.js 파일이 처리합니다.
app.use('/api', publicRoutes);

// 기본 경로
app.all('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다. (리팩토링 버전)');
});

// --- 서버 실행 ---
const PORT = process.env.PORT || 3001;
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`백엔드 서버가 포트 ${PORT}에서 성공적으로 실행되었습니다.`);
  });
}).catch(err => {
  console.error('서버 시작 실패:', err);
});
