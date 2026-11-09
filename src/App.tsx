// 1단계 임시 화면: 엔진이 브라우저 번들에서 동작하는지만 확인한다. 실제 UI는 17.2 9단계.
import { createGame } from './engine';

export function App() {
  const result = createGame({
    seed: 20261109,
    players: [
      { name: '플레이어 1', controller: 'human' },
      { name: 'AI 1', controller: 'ai' },
      { name: 'AI 2', controller: 'ai' },
    ],
  });
  if (!result.ok) return <p>게임 생성 실패: {result.reason}</p>;
  const { state } = result;
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>LifeGame</h1>
      <p>개발 중 (구현 1단계: 엔진 골격)</p>
      <p>시드 {state.seed} · 턴 순서: {state.turnOrder.map(nameOf).join(' → ')}</p>
    </main>
  );
}
