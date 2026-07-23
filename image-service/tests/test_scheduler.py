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


def _wire_publish_one(sb, *, ig_media_id=None, media=None, account=None):
    """Configura os selects de _publish_one: fresh-read de posts, media, conta."""
    media = media or {"processed_url": "http://img", "feed_caption": None}
    account = account or {"ig_user_id": "1", "access_token_enc": "enc", "graph_host": None}
    sb.table("posts").select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "ig_media_id": ig_media_id
    }
    sb.table("media").select.return_value.eq.return_value.single.return_value.execute.return_value.data = media
    sb.table("ig_accounts").select.return_value.eq.return_value.single.return_value.execute.return_value.data = account


def test_publish_one_scrubs_token_from_error():
    sb, tables = _sb_with_tables()
    _wire_publish_one(sb)

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


def test_publish_one_skips_when_already_published():
    sb, tables = _sb_with_tables()
    _wire_publish_one(sb, ig_media_id="m1")

    with patch.object(scheduler, "decrypt_token") as dec, patch.object(
        scheduler, "GraphApiPublisher"
    ) as Pub:
        scheduler._publish_one(
            sb, {"id": "p1", "media_id": "m1", "account_id": "a1", "attempts": 1}
        )

    Pub.assert_not_called()  # não republica
    dec.assert_not_called()
    assert tables["posts"].update.call_args[0][0]["status"] == "published"


def test_published_but_not_recorded_goes_failed_not_queued():
    sb, tables = _sb_with_tables()
    _wire_publish_one(sb)
    # heartbeat (updated_at) passa; os 3 updates de 'published' em _mark_published
    # falham; o update final de 'failed' passa.
    tables["posts"].update.return_value.eq.return_value.execute.side_effect = [
        MagicMock(),  # heartbeat
        RuntimeError("db down"),
        RuntimeError("db down"),
        RuntimeError("db down"),
        MagicMock(),  # 'failed'
    ]

    with patch.object(scheduler, "decrypt_token", return_value="tok"), patch.object(
        scheduler, "GraphApiPublisher"
    ) as Pub, patch.object(scheduler.time, "sleep"):
        Pub.return_value.publish_story.return_value = "MID99"
        scheduler._publish_one(
            sb, {"id": "p1", "media_id": "m1", "account_id": "a1", "attempts": 1}
        )

    statuses = [c[0][0].get("status") for c in tables["posts"].update.call_args_list]
    assert "queued" not in statuses  # nunca reenfileira um post publicado
    assert statuses[-1] == "failed"
    assert "MID99" in tables["posts"].update.call_args[0][0]["error"]


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


def _refresh_sb(account):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.lte.return_value.execute.return_value.data = [
        account
    ]
    return sb


def test_refresh_transient_error_keeps_active():
    sb = _refresh_sb({"id": "a1", "access_token_enc": "enc", "graph_host": None})
    with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
        scheduler, "decrypt_token", return_value="tok"
    ), patch.object(scheduler.requests, "get", side_effect=requests.ConnectionError()):
        scheduler.refresh_tokens()

    statuses = [
        c[0][0].get("status")
        for c in sb.table.return_value.update.call_args_list
    ]
    assert "token_expired" not in statuses  # blip de rede não demove


def test_refresh_4xx_demotes_account():
    sb = _refresh_sb({"id": "a1", "access_token_enc": "enc", "graph_host": None})
    err = requests.HTTPError()
    err.response = MagicMock(status_code=400)
    resp = MagicMock()
    resp.raise_for_status.side_effect = err
    with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
        scheduler, "decrypt_token", return_value="tok"
    ), patch.object(scheduler.requests, "get", return_value=resp):
        scheduler.refresh_tokens()

    statuses = [
        c[0][0].get("status")
        for c in sb.table.return_value.update.call_args_list
    ]
    assert "token_expired" in statuses  # token rejeitado de verdade


def test_refresh_5xx_keeps_active():
    sb = _refresh_sb({"id": "a1", "access_token_enc": "enc", "graph_host": None})
    err = requests.HTTPError()
    err.response = MagicMock(status_code=500)
    resp = MagicMock()
    resp.raise_for_status.side_effect = err
    with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
        scheduler, "decrypt_token", return_value="tok"
    ), patch.object(scheduler.requests, "get", return_value=resp):
        scheduler.refresh_tokens()

    statuses = [
        c[0][0].get("status")
        for c in sb.table.return_value.update.call_args_list
    ]
    assert "token_expired" not in statuses


def test_publish_due_uses_atomic_claim():
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = []

    with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
        scheduler, "requeue_stuck"
    ):
        scheduler.publish_due()

    sb.rpc.assert_called_with("claim_due_posts", {"lim": 20})


def test_publish_due_skips_when_locked():
    sb = MagicMock()
    scheduler._publish_lock.acquire()
    try:
        with patch.object(scheduler, "get_supabase", return_value=sb), patch.object(
            scheduler, "requeue_stuck"
        ):
            scheduler.publish_due()
        sb.rpc.assert_not_called()  # não claima enquanto outra passada roda
    finally:
        scheduler._publish_lock.release()


def test_publish_one_heartbeats_updated_at():
    sb, tables = _sb_with_tables()
    _wire_publish_one(sb)

    with patch.object(scheduler, "decrypt_token", return_value="tok"), patch.object(
        scheduler, "GraphApiPublisher"
    ) as Pub:
        Pub.return_value.publish_story.return_value = "MID1"
        scheduler._publish_one(
            sb, {"id": "p1", "media_id": "m1", "account_id": "a1", "attempts": 1}
        )

    updates = [c[0][0] for c in tables["posts"].update.call_args_list]
    assert {"updated_at"} in [set(u.keys()) for u in updates]  # heartbeat só com updated_at
