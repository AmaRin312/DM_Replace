export type PlayerSide = "player1" | "player2";

export type Zone =
  | "deck"
  | "hand"
  | "battle"
  | "mana"
  | "grave"
  | "shield";

export type CardInstance = {
  id: string;
  cardId: string | null;
  name: string;
  owner: PlayerSide;
  zone: Zone;
  faceUp: boolean;

  tapped: boolean;
  reversed: boolean;

  stackId: string | null;
  locked: boolean;
};

export type PlayerBoardState = {
  deckOrder: string[];
  hand: string[];
  battle: string[];
  mana: string[];
  grave: string[];
  shields: string[][];
};

export type RoomState = {
  roomId: string;
  players: {
    player1: PlayerBoardState;
    player2: PlayerBoardState;
  };
  cardInstances: Record<string, CardInstance>;
  stacks: Record<string, string[]>;
};