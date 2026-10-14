import type { Color, GameState, Order } from './rules';

export type SeatOrders = Partial<Record<Color, Order[]>>;
export interface Options { timerMin: number; limitMin: number } // 0 = no limit
export interface SeatView { name: string; bot: boolean; connected: boolean; submitted: boolean; pauseUsed: boolean }
export interface RoomView {
  id: string;
  seats: SeatView[];
  you: number | null;          // your seat index
  options: Options;
  game: GameState | null;
  deadline: number | null;     // end of the order-writing time, epoch ms
  gameEndsAt: number | null;
  now: number;
  draft: SeatOrders | null;    // your own saved orders, for reconnects
}

export type ClientMsg =
  | { t: 'join'; room: string; name: string; token: string }
  | { t: 'options'; options: Options }
  | { t: 'start' }
  | { t: 'addBot' }
  | { t: 'removeBot'; seat: number }
  | { t: 'orders'; orders: SeatOrders; final: boolean }
  | { t: 'pause' };

export type ServerMsg =
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string };
