import type { Color, GameState, Order } from './rules';

export interface Seat { color: Color; name: string; connected: boolean; submitted: boolean }
export interface RoomView {
  id: string;
  hostColor: Color | null;
  seats: Seat[];
  game: GameState | null;
  you: Color | null;
}

export type ClientMsg =
  | { t: 'join'; room: string; name: string; token: string }
  | { t: 'start' }
  | { t: 'orders'; orders: Order[] }
  | { t: 'unsubmit' };

export type ServerMsg =
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string };
