const express = require('express');
const cors = require('cors'); // cors 불러오기
const app = express();
const port = 3001; // 프론트엔드 포트와 겹치지 않게 3001로 설정

// --- Middleware 설정 ---
// 1. CORS 설정: 다른 출처(프론트엔드)의 요청을 허용합니다.
app.use(cors()); 
// 2. JSON Parser 설정: JSON 형태의 요청 본문을 서버가 이해할 수 있게 해줍니다.
app.use(express.json()); 

// --- API 라우트(경로) 설정 ---
// 기본 GET 경로
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버에 오신 것을 환영합니다!');
});

// 문의하기(contact) API 경로
app.post('/api/contact', (req, res) => {
  // 프론트엔드에서 보낸 데이터를 req.body에서 추출합니다.
  const { name, email, message } = req.body;

  // 받은 데이터를 터미널에 출력해봅니다.
  console.log('클라이언트로부터 받은 데이터:', { name, email, message });

  // 간단한 데이터 검증
  if (!name || !email || !message) {
    // 필수 데이터가 없으면 400 에러와 메시지를 보냅니다.
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  // (실제 프로젝트에서는 여기서 이메일을 보내거나 DB에 저장하는 코드가 들어갑니다)

  // 모든 것이 정상이면, 성공 응답을 프론트엔드로 보냅니다.
  res.status(200).json({ success: true, message: '문의가 성공적으로 접수되었습니다.' });
});

// --- 서버 실행 ---
app.listen(port, () => {
  console.log(`백엔드 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});