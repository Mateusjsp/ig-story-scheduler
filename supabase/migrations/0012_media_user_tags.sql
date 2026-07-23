-- Marcação de pessoas (@menção) na mídia — enviada à Meta no container de publicação.
--   media.user_tags : array JSON de { username, x, y } (x/y em 0.0–1.0, fração da
--                     imagem). No FEED a Meta exige x/y; no STORY x/y são opcionais
--                     (menção sem sticker), mas guardamos mesmo pra reusar a posição.
--                     Não é renderizado no pixel — é metadata da Content Publishing API
--                     (user_tags), suportado pra feed e, desde jul/2025, pra stories.
--                     Default '[]' protege mídias antigas (sem marcação).

alter table media add column if not exists user_tags jsonb not null default '[]'::jsonb;
