"""Testes do scheduler (sem rede; Supabase mockado)."""
from unittest.mock import MagicMock, patch

import requests

import app.scheduler as scheduler


def _sb_with_tables():
    """MagicMock de Supabase que retorna o MESMO mock por nome de tabela."""
    sb = MagicMock()
    tables: dict[str, MagicMock] = {}
    sb.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    return sb, tables


def test_publish_one_scrubs_token_from_error():
    sb, tables = _sb_with_tables()
    media = {"processed_url": "http://img", "feed_caption": None}
    account = {"ig_user_id": "1", "access_token_enc": "enc", "graph_host": None}
    tables_media = sb.table("media")
    tables_media.select.return_value.eq.return_value.single.return_value.execute.return_value.data = media
    sb.table("ig_accounts").select.return_value.eq.return_value.single.return_value.execute.return_value.data = account

    with patch.object(scheduler, "decrypt_token", return_value="tok"), patch.object(
        scheduler, "GraphApiPublisher"
    ) as Pub:
        Pub.return_value.publish_story.side_effect = requests.ConnectTimeout(
            "HTTPSConnectionPool(host='x'): url with access_token=SUPERSECRET failed"
        )
        scheduler._publish_one(
            sb, {"id": "p1", "media_id": "m1", "account_id": "a1", "attempts": 1}
        )

    err = tables["posts"].update.call_args[0][0]["error"]
    assert "SUPERSECRET" not in err
    assert tables["posts"].update.call_args[0][0]["status"] == "queued"


def test_requeue_stuck_filters_publishing_and_old():
    sb = MagicMock()
    chain = sb.table.return_value.update.return_value.eq.return_value.lt.return_value
    chain.execute.return_value.data = [{"id": "x"}]

    with patch.object(scheduler, "get_supabase", return_value=sb):
        scheduler.requeue_stuck()

    sb.table.assert_called_with("posts")
    sb.table.return_value.update.assert_called_once()
    update_arg = sb.table.return_value.update.call_args[0][0]
    assert update_arg["status"] == "queued"
    sb.table.return_value.update.return_value.eq.assert_called_with(
        "status", "publishing"
    )


def test_publish_due_uses_atomic_claim():
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = []

    with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
        scheduler, "requeue_stuck"
    ):
        scheduler.publish_due()

    sb.rpc.assert_called_with("claim_due_posts", {"lim": 20})
