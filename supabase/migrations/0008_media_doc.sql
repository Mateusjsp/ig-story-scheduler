-- Documento de camadas do editor de Story (múltiplos textos/stickers).
-- doc = { version, elements: [...] } (image-service/app/imaging/document.py).
-- Precedência no render: doc > caption+style (legado). Posts sem doc seguem legado.

alter table media add column if not exists doc jsonb;
