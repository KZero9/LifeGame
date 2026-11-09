# LifeGame

웹 브라우저용 인생 보드게임. 기획은 `GAME_DESIGN.md`, 구현 기준 규칙은 `DESIGN_PHASE3.md`를 따른다.

## 개발 명령

```bash
npm install
npm run dev        # 개발 서버
npm run typecheck  # 타입 검사
npm test           # 테스트 (Vitest)
npm run build      # 타입 검사 + 정적 빌드 (dist/)
```

## WSL에서 Windows 드라이브(/mnt/c)를 쓸 때

Node 18의 io_uring 파일 읽기가 /mnt/c에서 내용을 잘못 읽는 문제가 있다. 증상은 `npm install` 중 esbuild 설치 실패, 또는 빌드·테스트 시작 시 `SyntaxError: Missing initializer in const declaration`이다. 명령 전에 다음을 설정한다.

```bash
export UV_USE_IO_URING=0
```

셸 설정 파일(`~/.bashrc` 등)에 넣어 두면 매번 입력하지 않아도 된다. 이미 손상된 설치는 `node_modules`를 지우고 다시 설치한다.

## 구조

- `src/engine/` 규칙 엔진. React·브라우저 API에 의존하지 않는 순수 함수
  - `types.ts` 상태·행동·카드 타입 (15장)
  - `rng.ts` 용도별 시드 난수 (17.3)
  - `setup.ts` 게임 생성과 시작 상태 (1.2)
  - `validate.ts` 형식·맥락 검사와 거부 사유
  - `applyAction.ts` 엔진 진입점. 행동별 처리기는 구현 단계마다 등록
- `src/data/` 카드·수치 데이터(JSON, 4단계부터)
- `tests/` Vitest 테스트
