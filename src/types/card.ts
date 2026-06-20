export type Zone = "deck" | "hand" | "battle" | "mana" | "grave" | "shield";

export type CardInstance = {
  id: string;
  cardId: string | null;
  name: string;
  owner: "player1" | "player2";
  zone: Zone;
  faceUp: boolean;
  stackId: string | null;
  locked: boolean;
};
