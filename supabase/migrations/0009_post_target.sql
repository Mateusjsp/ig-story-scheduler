-- Destino da publicação: Story (9:16, some em 24h) ou Feed (permanente).
-- Reusa toda a fila/scheduler existente; só o container da Meta muda (media_type).
--   posts.target       : 'story' (default, protege posts antigos) | 'feed'
--   media.feed_caption : legenda de TEXTO real do feed (hashtag/@/quebra de linha).
--                        Diferente de media.caption, que é o texto concatenado dos
--                        overlays do doc (usado em listagens/busca). No story a
--                        legenda é queimada no pixel; no feed é campo da API.
--   media.aspect       : proporção da saída — '9:16' | '4:5' | '1:1'. Informativo
--                        pra UI/listagens (o render real usa width/height do media).

create type post_target as enum ('story', 'feed');

alter table posts add column if not exists target post_target not null default 'story';
alter table media add column if not exists feed_caption text;
alter table media add column if not exists aspect text;
