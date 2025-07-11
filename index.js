const express = require('express');
const cors = require('cors'); // 1. cors 라이브러리를 불러옵니다.
const app = express();
// Render는 process.env.PORT를 사용합니다. 로컬 테스트를 위해 3001도 추가합니다.
const port = process.env.PORT || 3001;

// --- Middleware 설정 ---
// Vercel 프론트엔드 주소의 요청을 허용하도록 설정합니다.
// 실제 운영 환경에서는 보안을 위해 특정 주소만 허용하는 것이 좋습니다.
app.use(cors()); 

// JSON 형태의 요청 본문을 서버가 해석할 수 있도록 설정합니다.
app.use(express.json()); 

// --- API 라우트(경로) 설정 ---

// 기본 경로: 서버가 살아있는지 확인하는 용도
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 동작 중입니다.');
});

// '/api/contact' 주소로 POST 요청이 오면 실행될 부분
app.post('/api/contact', (req, res) => {
  // 프론트엔드에서 보낸 데이터를 req.body에서 추출합니다.
  const { name, email, message } = req.body;
  
  // Render 서버의 로그에서 이 데이터를 확인할 수 있습니다.
  console.log('클라이언트로부터 받은 데이터:', { name, email, message });

  // 간단한 데이터 유효성 검사
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
  console.log(`백엔드 서버가 ${port}번 포트에서 실행 중입니다.`);
});
