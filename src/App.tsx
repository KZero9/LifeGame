import { useState } from 'react';
import { GameScreen } from './ui/components/GameScreen';
import { SetupScreen } from './ui/components/SetupScreen';
import { newSession, type Session } from './ui/session';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  if (!session) {
    return <SetupScreen onStart={(state) => setSession(newSession(state))} />;
  }
  return <GameScreen session={session} setSession={setSession} onExit={() => setSession(null)} />;
}
