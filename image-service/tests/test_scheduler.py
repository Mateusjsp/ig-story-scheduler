"""Testes do scheduler (sem rede; Supabase mockado)."""
from unittest.mock import MagicMock, patch

import app.scheduler as scheduler


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
