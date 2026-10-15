// Promise-based numeric prompt (rendered by PromptModal).
import { create } from 'zustand';

export interface PromptRequest {
  title: string;
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  integer?: boolean;
  resolve: (v: number | null) => void;
}

export const usePrompt = create<{ req: PromptRequest | null }>(() => ({ req: null }));

export function prompt(opts: Omit<PromptRequest, 'resolve'>): Promise<number | null> {
  return new Promise((resolve) => {
    usePrompt.setState({
      req: {
        ...opts,
        resolve: (v) => {
          usePrompt.setState({ req: null });
          resolve(v);
        },
      },
    });
  });
}
