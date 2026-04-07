import { getBestMove } from './chess-ai';

type Difficulty = 'easy' | 'medium' | 'hard';

type WorkerRequest = {
  id: number;
  fen: string;
  difficulty: Difficulty;
};

type WorkerResponse = {
  id: number;
  move: string | null;
  error?: string;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, fen, difficulty } = event.data;
  let response: WorkerResponse;
  try {
    const move = getBestMove(fen, difficulty);
    response = { id, move };
  } catch (err) {
    response = { id, move: null, error: err instanceof Error ? err.message : 'worker_error' };
  }
  self.postMessage(response);
};

