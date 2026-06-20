import type { CardInstance, PlayerSide, RoomState, Zone } from "@/types/roomState";

type DeckCardRow = {
  slot_index?: number;
  card_id?: string | null;
  card_name: string;
  image_url?: string | null;
  imageUrl?: string | null;
  civilization?: string | null;
  cost?: number | null;
  type?: string | null;
  race?: string | null;
  power?: string | number | null;
  text?: string | null;
};

function shuffleDeckCards<T>(cards: T[]): T[] {
  const next = [...cards];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

type CreateInitialRoomStateParams = {
  roomId: string;
  player1DeckCards: DeckCardRow[];
  player2DeckCards: DeckCardRow[];
};

function createPlayerInitialBoard(params: {
  player: PlayerSide;
  deckCards: DeckCardRow[];
  cardInstances: RoomState["cardInstances"];
}) {
  const { player, deckCards, cardInstances } = params;
  const shuffledCards = shuffleDeckCards(deckCards);
  const shieldCards = shuffledCards.slice(0, 5);
  const handCards = shuffledCards.slice(5, 10);
  const remainingDeckCards = shuffleDeckCards(shuffledCards.slice(10));
  const orderedCards = [...shieldCards, ...handCards, ...remainingDeckCards];

  const deckOrder: string[] = [];
  const hand: string[] = [];
  const shields: string[][] = [];

  orderedCards.forEach((deckCard, index) => {
    const safeName = deckCard.card_name || `カード${index + 1}`;
    const cardInstanceId = `${player}_${index}_${deckCard.card_id ?? safeName}`;
    const imageUrl = deckCard.image_url ?? deckCard.imageUrl ?? null;

    let zone: Zone = "deck";

    if (index < 5) {
      shields.push([cardInstanceId]);
      zone = "shield";
    } else if (index < 10) {
      hand.push(cardInstanceId);
      zone = "hand";
    } else {
      deckOrder.push(cardInstanceId);
      zone = "deck";
    }

    cardInstances[cardInstanceId] = {
      id: cardInstanceId,
      cardId: deckCard.card_id ?? null,
      name: safeName,
      owner: player,
      zone,
      faceUp: false,
      tapped: false,
      reversed: false,
      stackId: null,
      imageUrl,
      image_url: imageUrl,
      civilization: deckCard.civilization ?? null,
      cost: deckCard.cost ?? null,
      type: deckCard.type ?? null,
      race: deckCard.race ?? null,
      power: deckCard.power ?? null,
      text: deckCard.text ?? null
    } as CardInstance & {
      cardId?: string | null;
      imageUrl?: string | null;
      image_url?: string | null;
      civilization?: string | null;
      cost?: number | null;
      type?: string | null;
      race?: string | null;
      power?: string | number | null;
      text?: string | null;
    };
  });

  return {
    deckOrder,
    hand,
    battle: [] as string[],
    mana: [] as string[],
    grave: [] as string[],
    shields
  };
}

export function createInitialRoomState({
  roomId,
  player1DeckCards,
  player2DeckCards
}: CreateInitialRoomStateParams): RoomState {
  const cardInstances: RoomState["cardInstances"] = {};

  const player1 = createPlayerInitialBoard({
    player: "player1",
    deckCards: player1DeckCards,
    cardInstances
  });

  const player2 = createPlayerInitialBoard({
    player: "player2",
    deckCards: player2DeckCards,
    cardInstances
  });

  return {
    roomId,
    players: {
      player1,
      player2
    },
    cardInstances,
    stacks: {}
  };
}
