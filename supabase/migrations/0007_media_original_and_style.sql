-- Guardar o original e o estilo escolhido no media, pra permitir editar um post
-- da fila (legenda/estilo) reprocessando a imagem sem o usuário reenviar a foto.
--   original_url : URL pública do arquivo original (original_path já existe)
--   style        : StyleConfig usado (image-service/app/imaging/style.py); null = 'classic'
-- Posts antigos ficam com original_path/style nulos -> edição de legenda pede reenvio.

alter table media add column if not exists original_url text;
alter table media add column if not exists style jsonb;
