// Set curado de emojis comuns (estilo teclado), por categoria, com palavras-chave
// pra busca. Renderizados via Noto PNG (notoUrl) — mesmo asset do server.
// Cada item: [emoji, "palavras chave"].

export type EmojiItem = [string, string];
export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  items: EmojiItem[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Rostos",
    icon: "😀",
    items: [
      ["😀", "sorriso feliz grin"], ["😁", "sorriso feliz"], ["😂", "chorando rindo lol"],
      ["🤣", "rolando rindo lol"], ["😊", "feliz fofo blush"], ["😍", "apaixonado amor coracao"],
      ["🥰", "amor coracoes fofo"], ["😘", "beijo amor"], ["😗", "beijo"], ["😎", "legal oculos cool"],
      ["🤩", "estrela uau"], ["😉", "piscada"], ["🙂", "sorriso leve"], ["🙃", "de cabeca pra baixo"],
      ["😇", "anjo inocente"], ["🥳", "festa comemora party"], ["😜", "lingua brincadeira"],
      ["😝", "lingua"], ["🤪", "maluco doido"], ["😏", "malicioso smirk"], ["😌", "aliviado calmo"],
      ["😴", "dormindo sono"], ["🤤", "baba"], ["😪", "sono cansado"], ["😷", "mascara doente"],
      ["🤒", "doente febre"], ["🤕", "machucado"], ["🥵", "calor quente"], ["🥶", "frio gelado"],
      ["😱", "susto medo grito"], ["😭", "chorando triste"], ["😢", "triste lagrima"],
      ["😤", "raiva bufando"], ["😡", "raiva bravo"], ["🤬", "xingando raiva"], ["🤔", "pensando duvida"],
      ["🤗", "abraco"], ["🤭", "risada timido"], ["🤫", "silencio shh"], ["😐", "neutro serio"],
      ["😶", "sem boca"], ["🙄", "revira olhos"], ["😬", "sem graca"], ["😳", "envergonhado"],
      ["🥺", "suplica fofo pidao"], ["😈", "diabo travesso"], ["🤠", "cowboy"], ["🤯", "explodindo mente"],
    ],
  },
  {
    id: "gestures",
    label: "Gestos",
    icon: "👍",
    items: [
      ["👍", "joia curtir like positivo"], ["👎", "descurtir negativo"], ["👏", "palmas aplauso"],
      ["🙌", "maos ceu comemora"], ["👋", "tchau oi aceno"], ["🤙", "liga shaka"], ["✌️", "paz vitoria"],
      ["🤞", "dedos cruzados sorte"], ["🤟", "amor rock"], ["🤘", "rock"], ["👌", "ok otimo"],
      ["🤌", "italiano gesto"], ["🤏", "pouco pequeno"], ["👈", "esquerda aponta"], ["👉", "direita aponta"],
      ["👆", "cima aponta"], ["👇", "baixo aponta"], ["☝️", "um dedo cima"], ["✋", "mao para"],
      ["🤚", "mao"], ["🖐️", "mao aberta"], ["🖖", "vulcano"], ["🙏", "reza obrigado por favor"],
      ["💪", "forca biceps musculo"], ["🤝", "aperto maos acordo"], ["✍️", "escrevendo"],
    ],
  },
  {
    id: "hearts",
    label: "Amor",
    icon: "❤️",
    items: [
      ["❤️", "coracao amor vermelho"], ["🧡", "coracao laranja"], ["💛", "coracao amarelo"],
      ["💚", "coracao verde"], ["💙", "coracao azul"], ["💜", "coracao roxo"], ["🖤", "coracao preto"],
      ["🤍", "coracao branco"], ["🤎", "coracao marrom"], ["💕", "coracoes amor"], ["💞", "coracoes girando"],
      ["💓", "coracao batendo"], ["💗", "coracao crescendo"], ["💖", "coracao brilhando"],
      ["💘", "coracao flecha"], ["💝", "coracao presente"], ["💔", "coracao partido"], ["❣️", "coracao exclamacao"],
      ["💯", "cem nota100 perfeito"], ["💥", "explosao boom"], ["💫", "estrela tontura"], ["⭐", "estrela"],
      ["🌟", "estrela brilho"], ["✨", "brilhos glitter"], ["🔥", "fogo top"], ["💦", "gotas suor agua"],
    ],
  },
  {
    id: "animals",
    label: "Animais",
    icon: "🐶",
    items: [
      ["🐶", "cachorro dog"], ["🐱", "gato cat"], ["🐭", "rato"], ["🐹", "hamster"], ["🐰", "coelho"],
      ["🦊", "raposa"], ["🐻", "urso"], ["🐼", "panda"], ["🐨", "coala"], ["🐯", "tigre"], ["🦁", "leao"],
      ["🐮", "vaca"], ["🐷", "porco"], ["🐸", "sapo"], ["🐵", "macaco"], ["🐔", "galinha"], ["🐧", "pinguim"],
      ["🐦", "passaro"], ["🦄", "unicornio"], ["🐝", "abelha"], ["🦋", "borboleta"], ["🐢", "tartaruga"],
      ["🐙", "polvo"], ["🐬", "golfinho"], ["🐳", "baleia"], ["🐠", "peixe"], ["🌸", "flor cerejeira"],
      ["🌹", "rosa flor"], ["🌻", "girassol"], ["🌷", "tulipa"], ["🌈", "arco iris"], ["🌴", "palmeira"],
    ],
  },
  {
    id: "food",
    label: "Comida",
    icon: "🍕",
    items: [
      ["🍕", "pizza"], ["🍔", "hamburguer"], ["🍟", "batata frita"], ["🌮", "taco"], ["🍿", "pipoca"],
      ["🍩", "rosquinha donut"], ["🍪", "cookie biscoito"], ["🎂", "bolo aniversario"], ["🍰", "bolo"],
      ["🍫", "chocolate"], ["🍬", "doce bala"], ["🍦", "sorvete"], ["🍉", "melancia"], ["🍓", "morango"],
      ["🍌", "banana"], ["🍎", "maca"], ["🍇", "uva"], ["🍑", "pessego bumbum"], ["🥑", "abacate"],
      ["☕", "cafe"], ["🍺", "cerveja"], ["🍷", "vinho"], ["🍸", "drink coquetel"], ["🥂", "brinde champanhe"],
      ["🍾", "champanhe comemora"],
    ],
  },
  {
    id: "activities",
    label: "Diversão",
    icon: "⚽",
    items: [
      ["⚽", "futebol bola"], ["🏀", "basquete"], ["🏈", "futebol americano"], ["🎾", "tenis"],
      ["🏐", "volei"], ["🎱", "sinuca"], ["🏆", "trofeu campeao"], ["🥇", "ouro medalha primeiro"],
      ["🎮", "game videogame"], ["🎧", "fone musica"], ["🎵", "musica nota"], ["🎶", "musica notas"],
      ["🎤", "microfone cantar"], ["🎸", "guitarra violao"], ["🎉", "festa comemora party"],
      ["🎊", "confete festa"], ["🎈", "balao"], ["🎁", "presente"], ["🏝️", "praia ilha"], ["✈️", "aviao viagem"],
      ["🚗", "carro"], ["📸", "foto camera"], ["🎬", "cinema filme"], ["💰", "dinheiro grana"],
      ["👑", "coroa rei rainha"], ["💎", "diamante joia"],
    ],
  },
  {
    id: "symbols",
    label: "Símbolos",
    icon: "✅",
    items: [
      ["✅", "check certo ok"], ["❌", "x errado nao"], ["❗", "exclamacao"], ["❓", "interrogacao duvida"],
      ["⚠️", "aviso atencao"], ["🔞", "18 adulto"], ["♻️", "reciclar"], ["✔️", "check"], ["➡️", "seta direita"],
      ["⬅️", "seta esquerda"], ["⬆️", "seta cima"], ["⬇️", "seta baixo"], ["🔝", "topo top"], ["🆕", "novo new"],
      ["🆗", "ok"], ["🔴", "bola vermelha"], ["🟢", "bola verde"], ["🔵", "bola azul"], ["🟡", "bola amarela"],
      ["⚫", "bola preta"], ["⚪", "bola branca"], ["💤", "sono zzz"], ["💬", "balao fala"], ["🗨️", "balao"],
      ["👀", "olhos olha"], ["🚀", "foguete decolar"],
    ],
  },
];

export function searchEmoji(query: string): EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: EmojiItem[] = [];
  for (const cat of EMOJI_CATEGORIES) {
    for (const it of cat.items) {
      if (it[1].includes(q)) out.push(it);
    }
  }
  return out;
}
